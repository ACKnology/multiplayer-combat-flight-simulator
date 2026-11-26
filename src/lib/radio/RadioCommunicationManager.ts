/**
 * RadioCommunicationManager — ponte entre o TTS existente, as configurações do rádio
 * e o RadioAudioProcessor.
 *
 * Regras de segurança (PRD §2/§7):
 *  - Com os efeitos DESLIGADOS nada é processado e o TTS nativo é usado como sempre foi.
 *  - Com os efeitos LIGADOS, a fala NÃO é duplicada: ou sai processada, ou cai para o
 *    TTS nativo UMA única vez (fallback), nunca as duas.
 *  - Nenhuma falha de rede/áudio lança exceção para o chamador: vira `{ ok:false, reason }`.
 */
import type { RadioFxSettings, RadioTxOptions, RadioTxResult, RadioTxStatus } from "./types";
import { chunkText } from "./text";
import { DEFAULT_RADIO_FX, normalizeRadioFx } from "./settings";

type Source = ArrayBuffer | AudioBuffer | Blob | string;

export interface RadioProcessorLike {
  transmit(parts: Source[], opts: RadioTxOptions): Promise<void>;
  stopAll(): void;
  ensureRunning?(timeoutMs?: number): Promise<boolean>;
}

export interface RadioManagerDeps {
  fetchAudio?: (text: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
  processor?: RadioProcessorLike;
  maxQueue?: number;
}

interface QueueItem {
  opts: RadioTxOptions;
  resolve: (r: RadioTxResult) => void;
}

const defaultFetchAudio = async (text: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
  const r = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!r.ok) throw new Error(`tts HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 512) throw new Error("tts vazio");
  return buf;
};

export class RadioCommunicationManager {
  private settings: RadioFxSettings = { ...DEFAULT_RADIO_FX };
  private deps: Required<Pick<RadioManagerDeps, "fetchAudio" | "maxQueue">> & { processor?: RadioProcessorLike };
  private queue: QueueItem[] = [];
  private running = false;
  private disposed = false;
  /** epoch incrementado a cada stop/configure: invalida transmissões em andamento */
  private epoch = 0;
  private lastResult: RadioTxResult = { ok: true };
  status: RadioTxStatus = "idle";
  /** chamado quando o status muda (para o HUD do rádio) */
  onStatus?: (s: RadioTxStatus) => void;
  /** contadores úteis para diagnóstico sem expor segredos */
  stats = { attempts: 0, ok: 0, failed: 0, fallbacks: 0 };

  constructor(deps: RadioManagerDeps = {}) {
    this.deps = {
      fetchAudio: deps.fetchAudio ?? defaultFetchAudio,
      maxQueue: deps.maxQueue ?? 8,
      processor: deps.processor,
    };
  }

  configure(settings: RadioFxSettings) {
    const next = normalizeRadioFx(settings);
    const changed = next.enabled !== this.settings.enabled || next.profile !== this.settings.profile;
    this.settings = next;
    if (changed) this.epoch++;
    if (!this.settings.enabled) {
      // desligar interrompe o processamento imediatamente e libera recursos
      this.stopAll();
      this.setStatus("disabled");
    } else if (this.status === "disabled") {
      this.setStatus("idle");
    }
  }

  getSettings(): RadioFxSettings {
    return this.settings;
  }

  private setStatus(s: RadioTxStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  /** Transmite o texto (ou cai para o TTS nativo no chamador quando retorna ok:false). */
  transmit(opts: RadioTxOptions): Promise<RadioTxResult> {
    if (!this.settings.enabled) {
      this.lastResult = { ok: false, reason: "disabled" };
      return Promise.resolve(this.lastResult);
    }
    if (!opts.text || !opts.text.trim()) {
      this.lastResult = { ok: false, reason: "empty" };
      return Promise.resolve(this.lastResult);
    }
    return new Promise<RadioTxResult>((resolve) => {
      // fila com descarte do mais antigo para nunca crescer sem limite
      if (this.queue.length >= this.deps.maxQueue) {
        const dropped = this.queue.shift();
        dropped?.resolve({ ok: false, reason: "aborted", message: "fila cheia" });
      }
      this.queue.push({ opts, resolve });
      void this.drain();
    });
  }

  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const item = this.queue.shift()!;
        if (!this.settings.enabled) {
          item.resolve({ ok: false, reason: "disabled" });
          continue;
        }
        const result = await this.process(item.opts);
        item.resolve(result);
      }
    } finally {
      this.running = false;
      // preserva o estado de erro (visível ao usuário) e de desligado
      if (!this.disposed && this.settings.enabled && this.status !== "error") this.setStatus("idle");
    }
  }

  private async process(opts: RadioTxOptions): Promise<RadioTxResult> {
    this.stats.attempts++;
    const epoch = this.epoch;
    this.setStatus("loading");
    try {
      const chunks = chunkText(opts.text);
      if (!chunks.length) {
        this.stats.failed++;
        return { ok: false, reason: "empty" };
      }
      const proc = this.deps.processor;
      if (!proc) return this.fail("audio-unavailable", "processador de áudio indisponível");
      if (proc.ensureRunning && !(await proc.ensureRunning())) {
        return this.fail("audio-unavailable", "AudioContext bloqueado pelo navegador");
      }
      const parts = await Promise.all(chunks.map((c) => this.deps.fetchAudio(c)));
      await proc.transmit(parts, { ...opts, chunks });
      // usuário desligou os efeitos ou interrompeu durante a fala → não conta como sucesso
      if (epoch !== this.epoch || !this.settings.enabled) return { ok: false, reason: "aborted" };
      this.stats.ok++;
      this.setStatus("idle");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const reason = /decode|nenhum áudio/i.test(msg) ? "decode-failed" : /tts HTTP|tts vazio|fetch|network/i.test(msg) ? "fetch-failed" : "audio-unavailable";
      return this.fail(reason, msg);
    }
  }

  private fail(reason: NonNullable<RadioTxResult["reason"]>, message: string): RadioTxResult {
    this.stats.failed++;
    // motivos que levam o chamador a usar o TTS nativo (fallback único)
    if (reason !== "aborted" && reason !== "disabled" && reason !== "empty") this.stats.fallbacks++;
    this.setStatus("error");
    console.warn(`[radio-fx] ${reason}: ${message}`);
    return { ok: false, reason, message };
  }

  /** Interrompe fala atual e limpa a fila (troca de painel/voo, desligar efeitos). */
  stopAll() {
    this.epoch++;
    const pending = this.queue.splice(0);
    for (const p of pending) p.resolve({ ok: false, reason: "aborted" });
    this.deps.processor?.stopAll();
    if (this.settings.enabled) this.setStatus("idle");
  }

  dispose() {
    this.disposed = true;
    this.stopAll();
  }
}
