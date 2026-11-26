/**
 * RadioAudioProcessor — cadeia de áudio de rádio aeronáutico VHF (100% cliente, Web Audio API).
 *
 * Só atua sobre ÁUDIO já produzido por um TTS (ArrayBuffer/MP3/WAV/AudioBuffer/Blob/URL).
 * Não substitui, altera ou remove o mecanismo TTS: quando desabilitado, nada é processado.
 *
 * Cadeia: fonte → HP 300 Hz → LP 3 kHz → compressor → waveshaper (saturação) → gain → saída
 *         + ruído de fundo (estática), interferências, PTT/squelch, beeps de encerramento.
 *
 * Recursos: um único AudioContext compartilhado, buffers de ruído reutilizados,
 * nós desconectados ao fim de cada transmissão (sem vazamentos).
 */
import type { RadioDspParams, RadioTxOptions, RadioTxStatus } from "./types";
import { resolveRadioParams } from "./profiles";
import { estimateSpeechSeconds } from "./text";

type Source = ArrayBuffer | AudioBuffer | Blob | string;

interface ActiveTx {
  id: number;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  timers: number[];
  output: GainNode;
  finished: boolean;
  resolve: () => void;
  voiceGain: GainNode;
  el: HTMLAudioElement | null;
  urls: string[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export class RadioAudioProcessor {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private seq = 0;
  private active: ActiveTx | null = null;
  onStatus?: (s: RadioTxStatus) => void;

  /** Cria (uma única vez) o AudioContext e o barramento mestre. */
  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      return null;
    }
  }

  /** Garante que o contexto está rodando (política de autoplay). */
  async ensureRunning(timeoutMs = 1200): Promise<boolean> {
    const ctx = this.ensureCtx();
    if (!ctx) return false;
    // leitura via função: evita narrowing do TS sobre AudioContextState
    const running = () => ctx.state === "running";
    if (running()) return true;
    try {
      await ctx.resume();
    } catch {
      /* segue para a espera */
    }
    const t0 = Date.now();
    while (!running() && Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 60));
    }
    return running();
  }

  get supported() {
    return Boolean(this.ensureCtx());
  }

  get busy() {
    return Boolean(this.active);
  }

  /** Mute global: zera o barramento mestre do processador de rádio */
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  get isMuted() {
    return this.muted;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    // 2 s de ruído "branco filtrado" com leve coloração — base para estática e estalos
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.72 + w * 0.28;
      d[i] = w * 0.65 + last * 0.55;
    }
    this.noiseBuf = buf;
    return buf;
  }

  private saturationCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = Math.max(1, drive);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // saturação suave preservando inteligibilidade
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /** Converte MP3/WAV/AudioBuffer/Blob/URL em AudioBuffer decodificado. */
  private async toAudioBuffer(src: Source, ctx: AudioContext): Promise<AudioBuffer> {
    if (typeof src === "string") {
      const r = await fetch(src, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return this.toAudioBuffer(await r.arrayBuffer(), ctx);
    }
    if (typeof Blob !== "undefined" && src instanceof Blob) {
      return this.toAudioBuffer(await src.arrayBuffer(), ctx);
    }
    if (typeof AudioBuffer !== "undefined" && src instanceof AudioBuffer) return src;
    // ArrayBuffer: decodeAudioData detacha o buffer, então copiamos
    const bytes = (src as ArrayBuffer).slice(0);
    return await new Promise<AudioBuffer>((resolve, reject) => {
      // callback e promise: cobre Safari antigo e Chrome moderno
      let settled = false;
      const done = (b: AudioBuffer) => {
        if (settled) return;
        settled = true;
        resolve(b);
      };
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error("decode falhou"));
      };
      try {
        const p = ctx.decodeAudioData(bytes, done, fail);
        if (p && typeof p.then === "function") p.then(done).catch(fail);
      } catch (e) {
        fail(e);
      }
    });
  }

  /**
   * Reproduz uma transmissão processada.
   * `parts` pode conter vários pedaços de áudio (chunks do TTS) tocados em sequência.
   *
   * Estratégia de cadência: o áudio do provedor TTS pode vir mais lento que a fala natural.
   * Usamos HTMLAudioElement com `preservesPitch` (ligado por padrão), o que permite acelerar
   * a cadência sem alterar o tom da voz, e injetamos o elemento na cadeia via
   * createMediaElementSource. AudioBuffer puro (já decodificado) usa BufferSource.
   */
  async transmit(parts: Source[], opts: RadioTxOptions): Promise<void> {
    if (!parts.length) {
      this.onStatus?.("idle");
      return;
    }
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) throw new Error("Web Audio indisponível");
    this.stopAll();

    const params = resolveRadioParams(opts.profile, opts.staticIntensity);
    const gain = clamp01(opts.gain);
    this.onStatus?.("loading");

    // --- cadeia de voz (uma por transmissão, desconectada ao final)
    const id = ++this.seq;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const urls: string[] = [];
    const output = ctx.createGain();
    output.gain.value = gain;
    nodes.push(output);
    output.connect(this.master);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = params.highpassHz;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = params.lowpassHz;
    lp.Q.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = params.compThresholdDb;
    comp.ratio.value = params.compRatio;
    comp.attack.value = params.compAttack;
    comp.release.value = params.compRelease;
    comp.knee.value = 8;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.saturationCurve(params.drive);
    shaper.oversample = "2x";
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 1;
    hp.connect(lp).connect(comp).connect(shaper).connect(voiceGain).connect(output);
    nodes.push(hp, lp, comp, shaper, voiceGain);

    if (params.lfoDepth > 0.001) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.27;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = params.lfoDepth;
      lfo.connect(lfoGain).connect(voiceGain.gain);
      lfo.start();
      sources.push(lfo);
      nodes.push(lfoGain);
    }

    // --- estática de fundo (squelch aberto)
    const staticSrc = ctx.createBufferSource();
    staticSrc.buffer = this.noise(ctx);
    staticSrc.loop = true;
    const staticFilter = ctx.createBiquadFilter();
    staticFilter.type = "bandpass";
    staticFilter.frequency.value = 1900;
    staticFilter.Q.value = 0.55;
    const staticGain = ctx.createGain();
    staticGain.gain.value = 0;
    staticSrc.connect(staticFilter).connect(staticGain).connect(output);
    nodes.push(staticFilter, staticGain);

    const tx: ActiveTx = { id, nodes, sources, timers, output, finished: false, resolve: () => undefined, voiceGain, el: null, urls };
    this.active = tx;
    const finished = new Promise<void>((resolve) => {
      tx.resolve = resolve;
    });

    const sLevel = params.staticLevel * clamp01(opts.staticIntensity * 1.4 + 0.3) * 2.2;
    const openStatic = (when: number) => {
      staticGain.gain.setValueAtTime(0.0001, when);
      staticGain.gain.linearRampToValueAtTime(sLevel, when + 0.09);
      staticSrc.start(when);
    };
    const closeStatic = (when: number) => {
      staticGain.gain.setValueAtTime(Math.max(0.0002, sLevel), Math.max(when - 0.02, ctx.currentTime + 0.02));
      staticGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
      try {
        staticSrc.stop(when + 0.3);
      } catch {
        /* noop */
      }
    };

    // --- PTT: beep + hiss de abertura de squelch
    if (opts.pttSound) {
      const now = ctx.currentTime;
      const beep = ctx.createOscillator();
      beep.type = "square";
      beep.frequency.value = 1180;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, now);
      bg.gain.linearRampToValueAtTime(0.05, now + 0.008);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      beep.connect(bg).connect(output);
      beep.start(now);
      beep.stop(now + 0.09);
      sources.push(beep);
      nodes.push(bg);
      this.burst(ctx, output, now + 0.02, 0.13, 0.05, 3200, nodes, sources);
    }

    // --- preparo: preferimos elemento de mídia (permite acelerar sem mudar o tom)
    type Item = { url: string; buffer?: undefined } | { buffer: AudioBuffer; url?: undefined };
    const items: Item[] = [];
    for (const part of parts) {
      if (typeof AudioBuffer !== "undefined" && part instanceof AudioBuffer) {
        items.push({ buffer: part });
        continue;
      }
      let blob: Blob;
      if (typeof part === "string") {
        items.push({ url: part });
        continue;
      }
      if (typeof Blob !== "undefined" && part instanceof Blob) blob = part;
      else blob = new Blob([part as ArrayBuffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      items.push({ url });
    }
    if (!items.length) throw new Error("nenhum áudio válido");

    const chunks = opts.chunks ?? [opts.text];
    let playedAny = false;
    let totalVoice = 0;

    const runElement = async (url: string, est: number) => {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.src = url;
      tx.el = el;
      let node: MediaElementAudioSourceNode;
      try {
        node = ctx.createMediaElementSource(el);
      } catch {
        throw new Error("media element indisponível");
      }
      node.connect(hp);
      nodes.push(node);
      // acelera a cadência para a fala natural, preservando o tom (padrão do navegador)
      await new Promise<void>((resolve, reject) => {
        const fail = () => reject(new Error("decodificação do áudio falhou"));
        el.addEventListener("error", fail, { once: true });
        const ready = () => {
          el.removeEventListener("error", fail);
          const real = Number.isFinite(el.duration) && el.duration > 0.1 ? el.duration : est;
          const rate = Math.min(2.4, Math.max(1, real / Math.max(0.9, est)));
          try {
            el.preservesPitch = true;
          } catch {
            /* navegadores antigos: segue com o tom original */
          }
          el.defaultPlaybackRate = rate;
          el.playbackRate = rate;
          resolve();
        };
        if (el.readyState >= 1) ready();
        else el.addEventListener("loadedmetadata", ready, { once: true });
      });
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        el.addEventListener("ended", done, { once: true });
        el.addEventListener("error", done, { once: true });
        if (this.active?.id === id) openStatic(ctx.currentTime);
        playedAny = true;
        void el.play().catch(() => resolve());
      });
      const dur = Number.isFinite(el.duration) ? el.duration / Math.max(1, el.playbackRate) : est;
      totalVoice += dur;
      try {
        node.disconnect();
      } catch {
        /* noop */
      }
      el.pause();
      el.removeAttribute("src");
      el.load();
    };

    const runBuffer = async (buf: AudioBuffer, est: number) => {
      const rate = Math.min(2.4, Math.max(1, buf.duration / Math.max(0.9, est)));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(hp);
      if (!playedAny) openStatic(ctx.currentTime);
      playedAny = true;
      src.start();
      sources.push(src);
      await new Promise<void>((resolve) => {
        src.onended = () => resolve();
        tx.timers.push(window.setTimeout(resolve, (buf.duration / rate + 4) * 1000));
      });
      totalVoice += buf.duration / rate;
    };

    // --- interferências: agendadas ao longo da fala
    const scheduleInterference = (span: number) => {
      if (!opts.interference || params.interferenceChance <= 0) return;
      const attempts = Math.max(1, Math.round(span * params.interferenceChance * 1.1));
      for (let i = 0; i < attempts; i++) {
        const delay = 150 + Math.random() * Math.max(400, span * 1000);
        const t = window.setTimeout(() => {
          if (this.active?.id !== id) return;
          this.burst(ctx, output, ctx.currentTime, 0.02 + Math.random() * 0.06, 0.03 + Math.random() * 0.05, 1800 + Math.random() * 2200, nodes, sources);
          if (Math.random() < params.dropoutChance) {
            const now2 = ctx.currentTime;
            voiceGain.gain.cancelScheduledValues(now2);
            voiceGain.gain.setValueAtTime(0.25, now2);
            voiceGain.gain.linearRampToValueAtTime(1, now2 + 0.18);
          }
        }, delay);
        tx.timers.push(t);
      }
    };

    // agenda interferências pela duração estimada da fala (antes de tocar)
    const estTotal = items.reduce((acc, _it, i) => acc + estimateSpeechSeconds(chunks[Math.min(i, chunks.length - 1)] ?? opts.text), 0);
    scheduleInterference(estTotal);

    this.onStatus?.("transmitting");
    // guarda de segurança: nunca deixa a transmissão presa
    const guard = window.setTimeout(() => this.finalize(tx), 90000);
    tx.timers.push(guard);

    try {
      for (let i = 0; i < items.length; i++) {
        if (this.active?.id !== id || tx.finished) break;
        const est = estimateSpeechSeconds(chunks[Math.min(i, chunks.length - 1)] ?? opts.text);
        const it = items[i];
        if (it.url) await runElement(it.url, est);
        else if (it.buffer) await runBuffer(it.buffer, est);
        if (i < items.length - 1) await new Promise((r) => tx.timers.push(window.setTimeout(r, 130)));
      }
      if (playedAny) {
        // encerramento: beep descendente + ruído final + fechamento do squelch
        const now = ctx.currentTime;
        if (opts.endSound) {
          const beep = ctx.createOscillator();
          beep.type = "sine";
          beep.frequency.setValueAtTime(900, now);
          beep.frequency.exponentialRampToValueAtTime(640, now + 0.14);
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0.0001, now);
          bg.gain.linearRampToValueAtTime(0.04, now + 0.01);
          bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
          beep.connect(bg).connect(output);
          beep.start(now);
          beep.stop(now + 0.17);
          sources.push(beep);
          nodes.push(bg);
        }
        this.burst(ctx, output, now, 0.1, 0.035, 2600, nodes, sources);
        closeStatic(now + 0.05);
        await new Promise((r) => tx.timers.push(window.setTimeout(r, 380)));
      }
    } catch (e) {
      this.finalize(tx);
      throw e;
    }

    this.finalize(tx);
    await finished;
  }

  /** Rajada curta de estática/estalo. */
  private burst(
    ctx: AudioContext,
    dest: AudioNode,
    when: number,
    dur: number,
    vol: number,
    freq: number,
    nodes: AudioNode[],
    sources: AudioScheduledSourceNode[]
  ) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(dest);
    const offset = Math.random() * 1.6;
    src.start(when, offset, dur + 0.02);
    nodes.push(f, g);
    sources.push(src);
    nodes.push(src);
  }

  private finalize(tx: ActiveTx) {
    if (tx.finished) return;
    tx.finished = true;
    for (const t of tx.timers) window.clearTimeout(t);
    for (const s of tx.sources) {
      try {
        s.stop();
      } catch {
        /* já parado */
      }
      try {
        s.disconnect();
      } catch {
        /* noop */
      }
    }
    if (tx.el) {
      try {
        tx.el.pause();
        tx.el.removeAttribute("src");
        tx.el.load();
      } catch {
        /* noop */
      }
    }
    for (const u of tx.urls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* noop */
      }
    }
    for (const n of tx.nodes) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.active?.id === tx.id) {
      this.active = null;
      this.onStatus?.("idle");
    }
    tx.resolve();
  }

  /** Interrompe a transmissão atual (troca de mensagem/desligamento). */
  stopAll() {
    if (this.active) this.finalize(this.active);
  }

  dispose() {
    this.stopAll();
    this.onStatus?.("idle");
    try {
      this.master?.disconnect();
    } catch {
      /* noop */
    }
    this.master = null;
    this.noiseBuf = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

/** Conveniência: quem chama pode inspecionar os parâmetros aplicados (usado em testes/diagnóstico). */
export function previewParams(profile: RadioTxOptions["profile"], staticIntensity: number): RadioDspParams {
  return resolveRadioParams(profile, staticIntensity);
}
