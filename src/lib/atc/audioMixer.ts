// Mixer de áudio do ATC — Web Audio API com dois canais de ganho independentes:
//   liveAtcGain → feed real do Broadcastify (via proxy same-origin)
//   simAtcGain  → canal do ATC do jogo (TTS)
//
// Nota técnica honesta: a SpeechSynthesis API do navegador NÃO permite rotear a
// fala sintetizada para dentro do Web Audio. O canal simAtcGain é a autoridade
// de volume do TTS: cada utterance recebe `simEffectiveVolume()` e o ducking do
// modo prioridade reduz o volume das próximas falas enquanto o feed real fala.
// Qualquer áudio do simulador baseado em buffer pode ser conectado a simAtcGain.

export type AtcPlayState = "idle" | "connecting" | "playing" | "paused" | "reconnecting" | "error";

export interface MixerEvents {
  onState?: (s: AtcPlayState, detail?: string) => void;
  onActivity?: (active: boolean) => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export class AtcAudioMixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private liveAtcGain: GainNode | null = null;
  private simAtcGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;

  private el: HTMLAudioElement | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private url = "";
  private attempts = 0;
  private reconnectTimer = 0;
  private activityTimer = 0;
  private activeUntil = 0;
  private lastActive = false;
  private stopped = true;

  maxReconnect = 5;
  liveVolume = 0.9;
  simVolume = 1;
  muteLive = false;
  muteSim = false;
  priority = false;
  muted = false;
  state: AtcPlayState = "idle";
  events: MixerEvents = {};

  /** Cria o grafo de áudio (chamar a partir de um gesto do usuário). */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.liveAtcGain = this.ctx.createGain();
    this.simAtcGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Uint8Array(this.analyser.fftSize);
    this.liveAtcGain.connect(this.analyser);
    this.analyser.connect(this.master);
    this.simAtcGain.connect(this.master);
    this.applyLive();
    this.applySim();
    this.activityTimer = window.setInterval(() => this.tickActivity(), 250);
  }

  private setState(s: AtcPlayState, detail?: string) {
    this.state = s;
    this.events.onState?.(s, detail);
  }

  private applyLive() {
    if (!this.ctx || !this.liveAtcGain) return;
    this.liveAtcGain.gain.setTargetAtTime(this.muteLive ? 0 : this.liveVolume, this.ctx.currentTime, 0.05);
  }

  private applySim() {
    if (!this.ctx || !this.simAtcGain) return;
    const ducked = this.priority && performance.now() < this.activeUntil;
    const v = this.muteSim ? 0 : this.simVolume * (ducked ? 0.25 : 1);
    this.simAtcGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
  }

  private tickActivity() {
    if (!this.analyser || !this.buf || this.stopped || this.state === "paused") {
      if (this.lastActive) {
        this.lastActive = false;
        this.events.onActivity?.(false);
      }
      return;
    }
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const d = (this.buf[i] - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    if (rms > 0.012) this.activeUntil = performance.now() + 1200;
    const active = performance.now() < this.activeUntil;
    if (active !== this.lastActive) {
      this.lastActive = active;
      this.events.onActivity?.(active);
    }
    if (this.priority) this.applySim();
  }

  /** Volume efetivo do canal do jogo (0..1) — aplicado a cada utterance TTS. */
  simEffectiveVolume(): number {
    const ducked = this.priority && performance.now() < this.activeUntil;
    return clamp01(this.muteSim ? 0 : this.simVolume * (ducked ? 0.25 : 1));
  }

  /** Mute global do simulador: zera o barramento mestre do mixer */
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  get isMuted() {
    return this.muted;
  }

  setLiveVolume(v: number) { this.liveVolume = clamp01(v); this.applyLive(); }
  setSimVolume(v: number) { this.simVolume = clamp01(v); this.applySim(); }
  setMuteLive(m: boolean) { this.muteLive = m; this.applyLive(); }
  setMuteSim(m: boolean) { this.muteSim = m; this.applySim(); }
  setPriority(p: boolean) { this.priority = p; this.applySim(); }

  /** Toca um stream ao vivo (encerra qualquer stream anterior). */
  play(url: string) {
    this.ensure();
    this.teardownElement();
    this.url = url;
    this.attempts = 0;
    this.stopped = false;
    this.connect();
  }

  private connect() {
    if (this.stopped || !this.ctx || !this.liveAtcGain) return;
    this.setState(this.attempts > 0 ? "reconnecting" : "connecting", this.attempts > 0 ? `tentativa ${this.attempts}/${this.maxReconnect}` : undefined);
    const el = new Audio();
    el.preload = "none";
    // cache-buster só em reconexões, para reabrir o stream do ponto ao vivo
    el.src = this.attempts > 0 ? `${this.url}${this.url.includes("?") ? "&" : "?"}_r=${Date.now()}` : this.url;
    this.el = el;
    try {
      this.srcNode = this.ctx.createMediaElementSource(el);
      this.srcNode.connect(this.liveAtcGain);
    } catch {
      this.setState("error", "Web Audio indisponível");
      return;
    }
    const onPlaying = () => { this.attempts = 0; this.setState("playing"); };
    const onFail = () => this.scheduleReconnect("queda do stream");
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onFail);
    el.addEventListener("ended", onFail);
    el.addEventListener("stalled", () => {
      // stalls curtos são normais em streams; só reconecta se não voltar a tocar
      window.setTimeout(() => {
        if (this.el === el && !this.stopped && el.readyState < 3) this.scheduleReconnect("stream travado");
      }, 6000);
    });
    void el.play().catch(() => {
      if (!this.stopped) this.scheduleReconnect("falha ao iniciar");
    });
  }

  private scheduleReconnect(why: string) {
    if (this.stopped) return;
    this.teardownElement();
    if (this.attempts >= this.maxReconnect) {
      this.setState("error", `${why} — limite de ${this.maxReconnect} reconexões atingido`);
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** this.attempts) + Math.random() * 400;
    this.attempts++;
    this.setState("reconnecting", `${why} — reconectando em ${Math.round(delay / 1000)}s (${this.attempts}/${this.maxReconnect})`);
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  pause() {
    if (this.el && !this.el.paused) {
      this.el.pause();
      this.setState("paused");
    }
  }

  resume() {
    if (this.el && this.state === "paused") {
      this.setState("connecting");
      void this.el.play().catch(() => this.scheduleReconnect("falha ao retomar"));
    } else if (this.url && this.stopped) {
      this.play(this.url);
    }
  }

  /** Encerra de verdade o stream (troca de voo/aeroporto, fechar painel). */
  stop() {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    this.teardownElement();
    this.url = "";
    this.attempts = 0;
    this.activeUntil = 0;
    this.setState("idle");
  }

  private teardownElement() {
    const el = this.el;
    this.el = null;
    if (this.srcNode) {
      try { this.srcNode.disconnect(); } catch { /* noop */ }
      this.srcNode = null;
    }
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load(); // aborta a conexão de rede do stream
    }
  }

  get currentUrl() { return this.url; }

  dispose() {
    this.stop();
    window.clearInterval(this.activityTimer);
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}