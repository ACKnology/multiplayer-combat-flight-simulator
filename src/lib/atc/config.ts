// Configuração do ATC ao vivo — tudo via variáveis de ambiente, nada de segredos no código.
import type { AtcConfig } from "./types";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
};
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export interface AtcEnv extends AtcConfig {
  apiKey: string;
  apiBase: string;
  streamBase: string;
  geoAction: string;
  premiumUser: string;
  premiumPass: string;
}

/** Somente servidor. Nunca envie apiKey/premium* ao front-end. */
export function readAtcEnv(env: NodeJS.ProcessEnv = process.env): AtcEnv {
  return {
    apiKey: env.BROADCASTIFY_API_KEY ?? "",
    apiBase: (env.BROADCASTIFY_API_BASE ?? "https://api.broadcastify.com/audio/").replace(/\/?$/, "/"),
    streamBase: (env.BROADCASTIFY_STREAM_BASE ?? "https://broadcastify.cdnstream1.com").replace(/\/$/, ""),
    geoAction: env.BROADCASTIFY_GEO_ACTION ?? "geo",
    premiumUser: env.BROADCASTIFY_USERNAME ?? "",
    premiumPass: env.BROADCASTIFY_PASSWORD ?? "",
    radiusNm: clamp(num(env.ATC_SEARCH_RADIUS_NM, 100), 5, 500),
    cacheTtlHours: clamp(num(env.ATC_FEED_CACHE_TTL_HOURS, 12), 0.1, 168),
    maxReconnect: clamp(Math.round(num(env.ATC_MAX_RECONNECT_ATTEMPTS, 5)), 0, 20),
    liveVolume: clamp(num(env.LIVE_ATC_DEFAULT_VOLUME, 0.9), 0, 1),
    simVolume: clamp(num(env.SIM_ATC_DEFAULT_VOLUME, 1), 0, 1),
    providerConfigured: Boolean(env.BROADCASTIFY_API_KEY),
  };
}

/** Subconjunto seguro para o cliente. */
export function publicConfig(e: AtcEnv): AtcConfig {
  return {
    radiusNm: e.radiusNm,
    cacheTtlHours: e.cacheTtlHours,
    maxReconnect: e.maxReconnect,
    liveVolume: e.liveVolume,
    simVolume: e.simVolume,
    providerConfigured: e.providerConfigured,
  };
}