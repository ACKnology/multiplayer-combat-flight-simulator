// Configurações do radio-fx com persistência retrocompatível (puro, testável).
import type { RadioFxSettings } from "./types";
import { isRadioProfile } from "./profiles";

/** Habilitado por padrão (decisão de produto): o rádio já inicia com efeitos. */
export const DEFAULT_RADIO_FX: RadioFxSettings = {
  enabled: true,
  profile: "tower",
  volume: 1,
  staticIntensity: 0.5,
  interference: true,
  pttSound: true,
  endSound: true,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const clamp01 = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
};

/** Normaliza qualquer objeto vindo do localStorage (inclui versões antigas sem radioFx). */
export function normalizeRadioFx(raw: unknown): RadioFxSettings {
  const r = (raw ?? {}) as Partial<RadioFxSettings>;
  return {
    enabled: bool(r.enabled, DEFAULT_RADIO_FX.enabled),
    profile: isRadioProfile(r.profile) ? r.profile : DEFAULT_RADIO_FX.profile,
    volume: clamp01(r.volume, DEFAULT_RADIO_FX.volume),
    staticIntensity: clamp01(r.staticIntensity, DEFAULT_RADIO_FX.staticIntensity),
    interference: bool(r.interference, DEFAULT_RADIO_FX.interference),
    pttSound: bool(r.pttSound, DEFAULT_RADIO_FX.pttSound),
    endSound: bool(r.endSound, DEFAULT_RADIO_FX.endSound),
  };
}

/** Merge de preferências antigas (VoiceSettings sem radioFx) sem perder o que já existia. */
export function mergeStoredVoice<T extends Record<string, unknown>>(stored: unknown, defaults: T): T {
  const s = (stored ?? {}) as Record<string, unknown>;
  return { ...defaults, ...s } as T;
}
