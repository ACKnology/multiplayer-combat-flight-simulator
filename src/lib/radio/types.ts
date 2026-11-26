// Tipos do sistema de áudio de rádio aeronáutico (efeitos sobre o TTS existente).

export type RadioProfileId = "tower" | "aircraft" | "weak";

export interface RadioFxSettings {
  /** Liga/desliga TODO o processamento. Desligado = TTS original, sem efeitos. */
  enabled: boolean;
  profile: RadioProfileId;
  /** Volume da comunicação processada (0..1) */
  volume: number;
  /** Intensidade do ruído de rádio (0..1) */
  staticIntensity: number;
  interference: boolean;
  pttSound: boolean;
  endSound: boolean;
}

export interface RadioDspParams {
  highpassHz: number;
  lowpassHz: number;
  compThresholdDb: number;
  compRatio: number;
  compAttack: number;
  compRelease: number;
  drive: number;
  staticLevel: number;
  interferenceChance: number;
  dropoutChance: number;
  lfoDepth: number;
  label: string;
  description: string;
}

export type RadioTxStatus =
  | "idle"
  | "loading"
  | "transmitting"
  | "error"
  | "unsupported"
  | "disabled";

export interface RadioTxResult {
  ok: boolean;
  reason?: "disabled" | "empty" | "fetch-failed" | "decode-failed" | "audio-unavailable" | "aborted";
  message?: string;
}

export interface RadioTxOptions {
  /** Texto já limpo para fala (o mesmo que iria ao TTS). */
  text: string;
  /** Blocos exatos enviados ao provedor (para estimar a cadência de cada parte). */
  chunks?: string[];
  profile: RadioProfileId;
  /** Ganho final (volume do usuário × volume do ATC do jogo/ducking). */
  gain: number;
  staticIntensity: number;
  interference: boolean;
  pttSound: boolean;
  endSound: boolean;
  label?: string;
}
