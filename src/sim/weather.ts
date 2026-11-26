// Meteorologia, relógio e posição solar — módulo puro (sem three.js), usado no cliente e no servidor.

export interface Weather {
  tempC: number;
  pressureHpa: number; // QNH aproximado (pressão ao nível do mar)
  humidity: number;
  cloud: number; // 0..1
  precip: number; // mm/h
  snow: number; // cm/h
  code: number; // WMO
  windMs: number;
  windDir: number; // de onde sopra (graus verdadeiros)
  gustMs: number;
  visM: number;
  thunder: boolean;
  summary: string;
  source: "live" | "offline";
  observed: string;
}

export const DEFAULT_WX: Weather = {
  tempC: 22, pressureHpa: 1013, humidity: 55, cloud: 0.15, precip: 0, snow: 0, code: 0, windMs: 3, windDir: 90,
  gustMs: 4, visM: 24000, thunder: false, summary: "Céu limpo", source: "offline", observed: "",
};

const KT = 1.94384;

export function describeWx(code: number, cloud: number): string {
  if (code >= 95) return code === 95 ? "Trovoada" : "Trovoada com granizo";
  if (code >= 85) return "Pancadas de neve";
  if (code >= 80) return code === 80 ? "Pancadas de chuva fracas" : code === 81 ? "Pancadas de chuva" : "Pancadas de chuva fortes";
  if (code >= 71 && code <= 77) return code <= 71 ? "Neve fraca" : code === 73 ? "Neve moderada" : code === 75 ? "Neve forte" : "Grãos de neve";
  if (code >= 66 && code <= 67) return "Chuva congelante";
  if (code >= 61) return code === 61 ? "Chuva fraca" : code === 63 ? "Chuva moderada" : "Chuva forte";
  if (code >= 56 && code <= 57) return "Garoa congelante";
  if (code >= 51) return "Garoa";
  if (code === 45 || code === 48) return "Nevoeiro";
  if (code === 3 || cloud > 0.85) return "Nublado";
  if (code === 2 || cloud > 0.4) return "Parcialmente nublado";
  if (code === 1 || cloud > 0.12) return "Predominantemente limpo";
  return "Céu limpo";
}

export const windKt = (w: Weather) => Math.round(w.windMs * KT);

export function windText(w: Weather): string {
  const d = Math.round(w.windDir) % 360 || 360;
  return `${String(d).padStart(3, "0")}°/${String(Math.min(99, windKt(w))).padStart(2, "0")}kt`;
}

/** densidade do ar, velocidade do som e temperatura em altitude (ISA ajustada por QNH e temperatura real) */
export function airDensity(hMsl: number, elevM: number, w: Weather) {
  const h = Math.max(-300, Math.min(19000, hMsl));
  const delta = Math.pow(1 - 2.25577e-5 * h, 5.25588) * (w.pressureHpa / 1013.25);
  const tGround = w.tempC + 273.15;
  const tK = Math.max(216, tGround - 0.0065 * Math.max(0, h - elevM));
  const rho = 1.225 * delta * (288.15 / tK);
  return { rho, sigma: rho / 1.225, tK, a: 20.05 * Math.sqrt(tK) };
}

// ---------------------------------------------------------------- sol
const D2R = Math.PI / 180;

/** elevação e azimute (graus, do norte para leste) do Sol — NOAA simplificado */
export function solarPosition(date: Date, lat: number, lon: number): { elev: number; az: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 4e-7 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = (((gmst * 15 + lon) * D2R - ra) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  const la = lat * D2R;
  const sinE = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinE))) / D2R;
  const azS = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la));
  return { elev, az: ((azS / D2R + 180) % 360 + 360) % 360 };
}

/** vetor unitário no mundo da simulação (x = leste, y = cima, z = sul) */
export function sunVec(elev: number, az: number): [number, number, number] {
  const e = elev * D2R, a = az * D2R;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

// ---------------------------------------------------------------- relógio
export function localHours(tz: string, ms: number): number {
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return (g("hour") % 24) + g("minute") / 60 + g("second") / 3600;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

export function fmtLocal(tz: string, ms: number, seconds = true): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12: false }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, seconds ? 19 : 16);
  }
}

export function fmtDate(tz: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function startEpoch(tz: string, mode: "real" | "custom", hour: number): number {
  const now = Date.now();
  if (mode === "real") return now;
  let delta = hour - localHours(tz, now);
  if (delta > 12) delta -= 24;
  if (delta < -12) delta += 24;
  return now + delta * 3600000;
}

export function phaseOfDay(elev: number): string {
  if (elev > 20) return "Dia";
  if (elev > 6) return "Manhã / tarde";
  if (elev > -0.8) return "Nascer / pôr do sol";
  if (elev > -6) return "Crepúsculo civil";
  if (elev > -12) return "Crepúsculo náutico";
  return "Noite";
}

// ---------------------------------------------------------------- pista x vento
export const runwayHeading = (ident: string) => ((parseInt(ident, 10) || 0) * 10) % 360;

export function windComponents(w: Weather, ident: string) {
  const rel = (w.windDir - runwayHeading(ident)) * D2R;
  const kt = w.windMs * KT;
  return { head: kt * Math.cos(rel), cross: kt * Math.sin(rel) };
}

export function bestRunway(idents: string[], w: Weather): string {
  let best = idents[0], score = -1e9;
  for (const id of idents) {
    const c = windComponents(w, id);
    const s = c.head - Math.abs(c.cross) * 0.35;
    if (s > score) {
      score = s;
      best = id;
    }
  }
  return best;
}

export async function fetchWeather(lat: number, lon: number, timeoutMs = 6000): Promise<Weather> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`/api/weather?lat=${lat}&lon=${lon}`, { signal: ctl.signal });
    if (!r.ok) throw new Error("wx");
    return (await r.json()) as Weather;
  } catch {
    return { ...DEFAULT_WX };
  } finally {
    clearTimeout(t);
  }
}