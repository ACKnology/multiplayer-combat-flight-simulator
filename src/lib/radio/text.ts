// Utilidades de texto para o TTS (limpeza e fatiamento) — puras e testáveis.

/** Mesma limpeza aplicada hoje, centralizada para os dois caminhos (nativo e processado). */
export function cleanForTts(text: string): string {
  return text
    .replace(/[✈💥◈◇📻🎯👏🔧⚠ℹ★]/gu, "")
    .replace(/(\d{3})°\/(\d{2})kt/g, "$1 graus, $2 nós")
    .replace(/\bQNH\b/g, "Q N H")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Divide o texto em blocos aceitos pelo provedor de áudio (limite ~200 caracteres),
 * preferindo quebras de frase para manter a prosódia natural.
 */
export function chunkText(text: string, maxLen = 180): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const sentences = t.match(/[^.!?;]+[.!?;]*\s*/g) ?? [t];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (sentence.length > maxLen) {
      if (cur) {
        out.push(cur.trim());
        cur = "";
      }
      // quebra por palavras
      const words = sentence.split(/\s+/);
      let line = "";
      for (const w of words) {
        if ((line + " " + w).trim().length > maxLen) {
          if (line) out.push(line.trim());
          line = w;
        } else {
          line = `${line} ${w}`.trim();
        }
      }
      if (line) out.push(line.trim());
      continue;
    }
    if ((cur + " " + sentence).trim().length > maxLen) {
      if (cur) out.push(cur.trim());
      cur = sentence;
    } else {
      cur = `${cur} ${sentence}`.trim();
    }
  }
  if (cur) out.push(cur.trim());
  return out;
}

/** Rótulo curto para o HUD de status do rádio. */
export function txStatusLabel(status: string, profileLabel?: string): string {
  switch (status) {
    case "loading":
      return "SINTONIZANDO…";
    case "transmitting":
      return `TX${profileLabel ? ` · ${profileLabel}` : ""}`;
    case "error":
      return "FALHA — VOZ NATIVA";
    case "unsupported":
      return "AUDIO CTX INDISPONÍVEL";
    case "disabled":
      return "EFEITOS OFF";
    default:
      return "PRONTO";
  }
}

/**
 * Duração estimada de fala natural para o texto (base ~2,55 palavras/s + pausas).
 * Usada para normalizar a cadência do áudio do provedor TTS (que pode vir lento).
 */
export function estimateSpeechSeconds(text: string): number {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return 0;
  const words = clean.split(" ").filter(Boolean).length;
  const pauses = (clean.match(/[,.;:!?]/g) ?? []).length;
  const digits = (clean.match(/\d/g) ?? []).length;
  return Math.max(0.9, words / 2.55 + pauses * 0.12 + digits * 0.02);
}
