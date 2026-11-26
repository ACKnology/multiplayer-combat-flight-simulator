// Perfis de transmissão (puros, testáveis): parâmetros de DSP por perfil.
import type { RadioDspParams, RadioFxSettings, RadioProfileId } from "./types";

export const RADIO_PROFILES: Record<RadioProfileId, RadioDspParams> = {
  tower: {
    label: "TOWER",
    description: "Torre / ATC — voz limpa, estática baixa, distorção discreta",
    highpassHz: 300,
    lowpassHz: 3000,
    compThresholdDb: -24,
    compRatio: 4,
    compAttack: 0.005,
    compRelease: 0.12,
    drive: 1.7,
    staticLevel: 0.018,
    interferenceChance: 0.12,
    dropoutChance: 0,
    lfoDepth: 0,
  },
  aircraft: {
    label: "AIRCRAFT",
    description: "Aeronave ↔ aeronave — estática moderada, compressão e distorção médias",
    highpassHz: 320,
    lowpassHz: 2800,
    compThresholdDb: -28,
    compRatio: 5.5,
    compAttack: 0.004,
    compRelease: 0.14,
    drive: 2.9,
    staticLevel: 0.042,
    interferenceChance: 0.38,
    dropoutChance: 0.05,
    lfoDepth: 0.05,
  },
  weak: {
    label: "WEAK SIGNAL",
    description: "Sinal fraco — estática intensa, falhas e queda de intensidade",
    highpassHz: 380,
    lowpassHz: 2350,
    compThresholdDb: -32,
    compRatio: 8,
    compAttack: 0.003,
    compRelease: 0.18,
    drive: 4.6,
    staticLevel: 0.085,
    interferenceChance: 0.85,
    dropoutChance: 0.22,
    lfoDepth: 0.16,
  },
};

export const RADIO_PROFILE_IDS: RadioProfileId[] = ["tower", "aircraft", "weak"];

export function isRadioProfile(v: unknown): v is RadioProfileId {
  return typeof v === "string" && (RADIO_PROFILE_IDS as string[]).includes(v);
}

/** Parâmetros finais do perfil, modulados pela intensidade de estática escolhida. */
export function resolveRadioParams(profile: RadioProfileId, staticIntensity: number): RadioDspParams {
  const base = RADIO_PROFILES[profile] ?? RADIO_PROFILES.tower;
  const si = Math.min(1, Math.max(0, Number.isFinite(staticIntensity) ? staticIntensity : 0.5));
  // intensidade 0.5 = valor do perfil; 0 = metade; 1 = 1,6×
  const scale = 0.5 + si * 1.1;
  return {
    ...base,
    staticLevel: Math.min(0.22, base.staticLevel * scale),
    interferenceChance: Math.min(1, base.interferenceChance * (0.5 + si)),
    dropoutChance: Math.min(0.6, base.dropoutChance * (0.5 + si)),
  };
}

/**
 * Perfil usado por mensagem: ATC usa o perfil escolhido pelo usuário;
 * transmissões de outros pilotos usam AIRCRAFT (voz ao ar, mais degradada).
 */
export function profileForMessage(kind: "pilot" | "atc" | "system", selected: RadioFxSettings["profile"]): RadioProfileId {
  if (kind === "atc") return isRadioProfile(selected) ? selected : "tower";
  return "aircraft";
}
