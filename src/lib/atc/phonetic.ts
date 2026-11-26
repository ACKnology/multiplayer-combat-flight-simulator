// Alfabeto fonético aeronáutico ICAO (pt-BR) + leitura de números.
// Usado pelo controlador (torre/solo/aproximação) e pela leitura de voz do TTS.

export const ICAO_ALPHABET: Record<string, string> = {
  A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Eco", F: "Foxtrot",
  G: "Golf", H: "Hotel", I: "India", J: "Juliett", K: "Kilo", L: "Lima",
  M: "Mike", N: "November", O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo",
  S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey",
  X: "X-ray", Y: "Yankee", Z: "Zulu",
};

/** Dígitos lidos como palavras (convenção usada pelos controladores brasileiros) */
export const ICAO_DIGITS = ["Zero", "Um", "Dois", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove"];

const DIGIT_WORD = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];

/** "49" → "quatro nove" · "27" → "dois sete" */
export function digitsToWords(num: string): string {
  return num
    .split("")
    .map((d) => DIGIT_WORD[Number(d)] ?? d)
    .join(" ");
}

/** Letras isoladas em sequências: "TAM" → "Tango Alfa Mike" */
export function lettersToPhonetic(seq: string): string {
  return seq
    .split("")
    .map((c) => ICAO_ALPHABET[c.toUpperCase()] ?? c)
    .join(" ");
}

const MIL = 1000;
const numberToWords = (n: number): string => {
  if (n >= MIL && n % MIL === 0) {
    const mil = n / MIL;
    const prefix = mil === 1 ? "mil" : mil === 2 ? "dois mil" : mil === 3 ? "três mil" : `${digitsToWords(String(mil))} mil`;
    return prefix;
  }
  if (n >= 100 && n % 100 === 0) return `${digitsToWords(String(n / 100))} centos`;
  return digitsToWords(String(n));
};

/**
 * Converte um texto em fala aeronáutica:
 *  - QNH 1013 → "Q N H um zero um três"
 *  - 118.10   → "um um oito ponto um zero"
 *  - 3000     → "três mil"
 *  - TAM3589  → "Tango Alfa Mike três cinco oito nove"
 *  - FALCÃO 49 → "Falcão quatro nove"
 */
export function icaoSpeech(text: string): string {
  if (!text) return "";
  let out = text;

  // QNH / pressão com dígitos
  out = out.replace(/\bQ\s?N\s?H\s+(\d{3,4})\b/gi, (_m, d: string) => `Q N H ${digitsToWords(d)}`);

  // frequências (118.10 / 121.90 / 132.75)
  out = out.replace(/\b(\d{2,3})\.(\d{2})\b/g, (_m, a: string, b: string) => `${digitsToWords(a)} ponto ${digitsToWords(b)}`);

  // altitudes e números de milhar (3000 ft, FL250)
  out = out.replace(/\bFL\s?(\d{3})\b/gi, (_m, d: string) => `F L ${digitsToWords(d)}`);
  out = out.replace(/\b(\d{4})\b/g, (m, d: string) => {
    const n = Number(d);
    if (n >= MIL && n % MIL === 0) return numberToWords(n);
    if (n >= 1000) return digitsToWords(d);
    return m;
  });
  // números de 3 dígitos isolados (QNH já tratado; ex.: "FL" não cai aqui)
  out = out.replace(/\b(\d{3})\b/g, (_m, d: string) => digitsToWords(d));
  // números de 1–2 dígitos (pista 27, ALT 49)
  out = out.replace(/\b(\d{1,2})\b/g, (_m, d: string) => digitsToWords(d));

  // palavras já em fonética → forma canônica (TANGO ALFA MIKE → Tango Alfa Mike)
  out = out.replace(/[A-Za-zÀ-ÿ-]+/g, (w) => {
    const canon = CANON.get(w.toLowerCase());
    return canon ?? w;
  });

  // sequências de letras em caixa alta (códigos de companhia): TAM, GOL, LATAM…
  out = out.replace(/\b([A-Z]{2,4})\b/g, (m) => {
    if (CANON.has(m.toLowerCase())) return m;
    return lettersToPhonetic(m);
  });

  return out.replace(/\s{2,}/g, " ").trim();
}

/** mapa canônico (minúsculo → palavra ICAO padronizada) */
const CANON = new Map(Object.values(ICAO_ALPHABET).map((w) => [w.toLowerCase(), w]));

/** Indicativo falado: "FALCÃO 49" → "Falcão quatro nove" · "TAM3589" → "Tango Alfa Mike três cinco oito nove" */
export function icaoCallsign(callsign: string): string {
  const cs = callsign.trim();
  if (!cs) return "";
  return cs
    .split(/\s+/)
    .map((part) => {
      if (/^\d{1,3}$/.test(part)) return digitsToWords(part);
      // sequências mistas de letras e dígitos (TAM3589) → fonética + dígitos
      const mixed = part.match(/^([A-Za-z]{3,4})(\d{1,4})$/);
      if (mixed) return `${lettersToPhonetic(mixed[1])} ${digitsToWords(mixed[2])}`;
      if (/^[A-Z]{3,4}$/.test(part)) return lettersToPhonetic(part);
      // palavra comum (com acento ou não) → capitalização natural para a leitura
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}
