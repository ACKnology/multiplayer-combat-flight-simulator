// Testes do sistema de áudio de rádio. Executar: node scripts/test-radio.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RADIO_FX, normalizeRadioFx } from "../settings";
import { RADIO_PROFILES, isRadioProfile, profileForMessage, resolveRadioParams } from "../profiles";
import { chunkText, cleanForTts, estimateSpeechSeconds, txStatusLabel } from "../text";
import { RadioCommunicationManager, type RadioProcessorLike } from "../RadioCommunicationManager";
import type { RadioTxOptions } from "../types";

const opts = (over: Partial<RadioTxOptions> = {}): RadioTxOptions => ({
  text: "Falcão um, torre, autorizado pousar pista dois sete.",
  profile: "tower",
  gain: 0.9,
  staticIntensity: 0.5,
  interference: true,
  pttSound: true,
  endSound: true,
  ...over,
});

/** Processador falso: registra chamadas e controla a simultaneidade. */
function fakeProcessor(behaviour: { fail?: boolean; delayMs?: number } = {}) {
  const calls: { parts: number; opts: RadioTxOptions }[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let stopped = 0;
  const proc: RadioProcessorLike & { calls: typeof calls; maxConcurrent: () => number; stopped: () => number } = {
    calls,
    async transmit(parts, o) {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls.push({ parts: parts.length, opts: o });
      await new Promise((r) => setTimeout(r, behaviour.delayMs ?? 5));
      concurrent--;
      if (behaviour.fail) throw new Error("decode falhou");
    },
    stopAll() {
      stopped++;
    },
    async ensureRunning() {
      return true;
    },
    maxConcurrent: () => maxConcurrent,
    stopped: () => stopped,
  };
  return proc;
}

function fakeFetch(behaviour: { fail?: boolean } = {}) {
  let n = 0;
  const fn = async (text: string) => {
    n++;
    if (behaviour.fail) throw new Error("tts HTTP 502");
    const buf = new ArrayBuffer(Math.max(1024, text.length * 8));
    return buf;
  };
  return { fn, count: () => n };
}

// ---------------------------------------------------------------- configurações
test("efeitos HABILITADOS por padrão (decisão de produto); OFF continua possível", () => {
  assert.equal(DEFAULT_RADIO_FX.enabled, true);
  assert.equal(normalizeRadioFx(undefined).enabled, true);
  assert.equal(normalizeRadioFx({ enabled: false }).enabled, false, "usuário pode desligar");
  assert.equal(normalizeRadioFx({}).profile, "tower");
});

test("normalizeRadioFx valida perfil, clampa volumes e mantém booleanos", () => {
  const n = normalizeRadioFx({ enabled: true, profile: "alien" as never, volume: 7, staticIntensity: -3, interference: "sim", pttSound: false, endSound: undefined });
  assert.equal(n.enabled, true);
  assert.equal(n.profile, "tower");
  assert.equal(n.volume, 1);
  assert.equal(n.staticIntensity, 0);
  assert.equal(n.interference, true); // default
  assert.equal(n.pttSound, false);
  assert.equal(n.endSound, true); // default
});

// ---------------------------------------------------------------- perfis
test("perfis produzem parâmetros distintos e ordenados por degradação", () => {
  const t = resolveRadioParams("tower", 0.5);
  const a = resolveRadioParams("aircraft", 0.5);
  const w = resolveRadioParams("weak", 0.5);
  assert.ok(t.staticLevel < a.staticLevel && a.staticLevel < w.staticLevel);
  assert.ok(t.interferenceChance < a.interferenceChance && a.interferenceChance < w.interferenceChance);
  assert.ok(t.drive < a.drive && a.drive < w.drive);
  assert.ok(t.lowpassHz > a.lowpassHz && a.lowpassHz > w.lowpassHz);
  assert.equal(t.highpassHz, 300);
  assert.equal(t.lowpassHz, 3000);
  assert.equal(t.compRatio, 4);
  assert.equal(t.compThresholdDb, -24);
  assert.equal(w.dropoutChance > 0, true);
  assert.equal(t.dropoutChance, 0);
});

test("intensidade de estática escala o ruído e é clampada", () => {
  const low = resolveRadioParams("tower", 0);
  const mid = resolveRadioParams("tower", 0.5);
  const high = resolveRadioParams("tower", 1);
  assert.ok(low.staticLevel < mid.staticLevel && mid.staticLevel < high.staticLevel);
  assert.ok(normalizeRadioFx({ staticIntensity: 99 }).staticIntensity === 1);
  assert.ok(isRadioProfile("weak") && !isRadioProfile("ground"));
});

test("mensagens de ATC usam o perfil escolhido; pilotos usam AIRCRAFT", () => {
  assert.equal(profileForMessage("atc", "tower"), "tower");
  assert.equal(profileForMessage("atc", "weak"), "weak");
  assert.equal(profileForMessage("pilot", "tower"), "aircraft");
  assert.equal(profileForMessage("system", "tower"), "aircraft");
  assert.ok(RADIO_PROFILES.weak.description.length > 0);
});

// ---------------------------------------------------------------- texto
test("cleanForTts remove emojis e expande rádio-fonia", () => {
  const out = cleanForTts("⚠ ✈ Falcão, vento 090°/08kt, QNH 1013 💥");
  assert.ok(!out.includes("⚠") && !out.includes("✈") && !out.includes("💥"));
  assert.ok(out.includes("090 graus"));
  assert.ok(out.includes("08 nós"));
  assert.ok(out.includes("Q N H"));
});

test("chunkText respeita o limite do provedor sem quebrar palavras", () => {
  const long = "Falcão um, torre vale do sol. Autorizado pouso pista dois sete. Vento zero nove zero graus, oito nós. Q N H um zero um três. Reporte trem baixado e travado. Tráfego um sete três sete na final. Reduza para cento e oitenta nós. ";
  const text = long.repeat(3).trim();
  const chunks = chunkText(text, 180);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 180, `chunk com ${c.length} caracteres`);
    assert.ok(!/^\s|\s$/.test(c), "chunk não deve começar/terminar com espaço");
  }
  const joined = chunks.join(" ").replace(/\s+/g, " ").trim();
  assert.equal(joined, text.replace(/\s+/g, " ").trim());
  assert.deepEqual(chunkText("   "), []);
  assert.deepEqual(chunkText("curto"), ["curto"]);
});

test("rótulo de status do HUD", () => {
  assert.equal(txStatusLabel("transmitting", "TOWER"), "TX · TOWER");
  assert.equal(txStatusLabel("disabled"), "EFEITOS OFF");
  assert.equal(txStatusLabel("error"), "FALHA — VOZ NATIVA");
  assert.equal(txStatusLabel("idle"), "PRONTO");
});

// ---------------------------------------------------------------- manager
test("efeitos OFF: não chama áudio nem processador", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: false });
  const r = await mgr.transmit(opts());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "disabled");
  assert.equal(fetchAud.count(), 0);
  assert.equal(proc.calls.length, 0);
});

test("efeitos ON: busca o áudio uma vez por bloco e transmite uma única vez", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const r = await mgr.transmit(opts({ text: "Torre, Falcão um, decolagem." }));
  assert.equal(r.ok, true);
  assert.equal(fetchAud.count(), 1);
  assert.equal(proc.calls.length, 1);
  assert.equal(proc.calls[0].parts, 1);
  assert.equal(mgr.status, "idle");
  assert.equal(mgr.stats.ok, 1);
});

test("texto longo é fatiado e todos os blocos são enviados juntos ao processador", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const long = ("Autorizado subida inicial três mil pés, curva à esquerda rumo um oito zero. ".repeat(4)).trim();
  const r = await mgr.transmit(opts({ text: long }));
  assert.equal(r.ok, true);
  assert.ok(fetchAud.count() > 1);
  assert.equal(proc.calls[0].parts, fetchAud.count());
});

test("falha do provedor TTS: não lança, retorna fetch-failed (chamador cai para o TTS nativo)", async () => {
  const fetchAud = fakeFetch({ fail: true });
  const proc = fakeProcessor();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const r = await mgr.transmit(opts());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "fetch-failed");
  assert.equal(proc.calls.length, 0);
  assert.equal(mgr.stats.failed, 1);
  assert.equal(mgr.status, "error");
});

test("falha de decodificação do processador → decode-failed", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor({ fail: true });
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const r = await mgr.transmit(opts());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "decode-failed");
});

test("AudioContext bloqueado → audio-unavailable, sem tentar tocar", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor();
  proc.ensureRunning = async () => false;
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const r = await mgr.transmit(opts());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "audio-unavailable");
});

test("fila serializa transmissões (nunca duas vozes ao mesmo tempo)", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor({ delayMs: 30 });
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const [a, b, c] = await Promise.all([
    mgr.transmit(opts({ text: "primeira" })),
    mgr.transmit(opts({ text: "segunda" })),
    mgr.transmit(opts({ text: "terceira" })),
  ]);
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.equal(proc.calls.length, 3);
  assert.equal(proc.maxConcurrent(), 1);
  assert.equal(proc.calls[0].opts.text, "primeira");
  assert.equal(proc.calls[2].opts.text, "terceira");
});

test("fila cheia descarta a mensagem mais antiga sem travar", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor({ delayMs: 20 });
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc, maxQueue: 2 });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const first = mgr.transmit(opts({ text: "um" }));
  const second = mgr.transmit(opts({ text: "dois" }));
  const third = mgr.transmit(opts({ text: "tres" }));
  const fourth = mgr.transmit(opts({ text: "quatro" }));
  const results = await Promise.all([first, second, third, fourth]);
  assert.equal(results.filter((r) => r.reason === "aborted").length, 1);
  assert.equal(proc.calls.length, 3);
});

test("stopAll descarta pendentes e interrompe o processador", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor({ delayMs: 10 });
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const p = mgr.transmit(opts());
  mgr.stopAll();
  const r = await p;
  assert.equal(r.ok || r.reason === "aborted", true);
  assert.ok(proc.stopped() >= 1);
});

test("desligar os efeitos durante a fila interrompe e devolve disabled/aborted", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor({ delayMs: 10 });
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const p = mgr.transmit(opts());
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: false });
  const r = await p;
  assert.equal(r.ok, false);
  assert.ok(r.reason === "aborted" || r.reason === "disabled");
  assert.equal(mgr.status, "disabled");
});

test("texto vazio não dispara rede", async () => {
  const fetchAud = fakeFetch();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: fakeProcessor() });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const r = await mgr.transmit(opts({ text: "   " }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
  assert.equal(fetchAud.count(), 0);
});

// ---------------------------------------------------------------- cadência
test("estimateSpeechSeconds aproxima a fala natural (2,5 palavras/s) e respeita pausas", () => {
  const short = estimateSpeechSeconds("Torre, Falcão um.");
  const long = estimateSpeechSeconds("Torre, Falcão um, autorizado pouso pista dois sete, vento zero nove zero graus, oito nós, Q N H um zero um três.");
  assert.ok(short > 0.8 && short < 2.5, `curto=${short}`);
  assert.ok(long > short && long < 12, `longo=${long}`);
  assert.equal(estimateSpeechSeconds("   "), 0);
  // texto com mais pontuação/palavras tende a durar mais
  assert.ok(estimateSpeechSeconds("a b c d e f g h, i j; k l.") > estimateSpeechSeconds("a b c d e f g h i j k l"));
});

test("áudio do provedor mais lento é acelerado até 2,4× (tom preservado pelo elemento)", () => {
  const est = estimateSpeechSeconds("Falcão 88, Torre Santos Dumont, teste de voz. Vento 190 graus, 08 nós, pista 20 L, autorizado decolar.");
  const realDuration = 17.06; // medido no provedor
  const rate = Math.min(2.4, Math.max(1, realDuration / Math.max(0.9, est)));
  assert.ok(rate > 1.5 && rate <= 2.4, `rate=${rate}`);
  assert.ok(realDuration / rate < realDuration * 0.6, 'duração final reduzida em >40%');
  // áudio já na cadência natural não é desacelerado
  assert.equal(Math.min(2.4, Math.max(1, 5 / Math.max(0.9, est))), 1);
});

test("manager envia os blocos de texto ao processador (para calibrar cadência)", async () => {
  const fetchAud = fakeFetch();
  const proc = fakeProcessor();
  const mgr = new RadioCommunicationManager({ fetchAudio: fetchAud.fn, processor: proc });
  mgr.configure({ ...DEFAULT_RADIO_FX, enabled: true });
  const long = ("Autorizado subida inicial três mil pés, curva à esquerda rumo um oito zero. ".repeat(4)).trim();
  await mgr.transmit(opts({ text: long }));
  assert.ok(proc.calls[0].opts.chunks && proc.calls[0].opts.chunks.length > 1);
  assert.equal(proc.calls[0].opts.chunks!.join(" ").replace(/\s+/g, " ").trim(), long);
});
