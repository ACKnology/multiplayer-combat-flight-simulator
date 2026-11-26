// Consulta + cache de feeds ATC (Broadcastify Live Audio Feed Catalog API).
// Puro o suficiente para testes: fetch e relógio são injetáveis.
import type { AtcAirport, AtcFeed, FeedType, FeedsResult, FlightPhase } from "./types";
import { preferredFeedTypes } from "./phase";
import { airportByIcao } from "./airports";
import { publicConfig, readAtcEnv, type AtcEnv } from "./config";

// ---------------------------------------------------------------- classificação
export function classifyFeedType(name: string): FeedType {
  const n = name.toLowerCase();
  if (/\batis\b|d-atis/.test(n)) return "atis";
  if (/ground|gnd|\bsolo\b|clr|clearance/.test(n)) return "ground";
  if (/tower|twr|torre/.test(n)) return "tower";
  if (/approach|aproxima|\bapp\b/.test(n)) return "approach";
  if (/departure|depart|\bdep\b|partida/.test(n)) return "departure";
  if (/center|centre|centro|artcc/.test(n)) return "center";
  return "other";
}

export function extractFrequency(text: string): string | undefined {
  const m = text.match(/\b(1[123]\d\.\d{1,3})\b/);
  return m ? m[1] : undefined;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/**
 * Normaliza respostas do catálogo. Aceita formatos comuns
 * ({feeds:[...]}, {audio:{feeds:[...]}}, array puro, {feed:{...}}).
 */
export function parseCatalog(json: unknown, airport: AtcAirport | null, streamBase: string): AtcFeed[] {
  const root = (json ?? {}) as Json;
  let list: unknown[] = [];
  if (Array.isArray(root)) list = root;
  else if (Array.isArray(root.feeds)) list = root.feeds;
  else if (root.audio && Array.isArray((root.audio as Json).feeds)) list = (root.audio as Json).feeds as unknown[];
  else if (root.feed) list = [root.feed];
  const out: AtcFeed[] = [];
  for (const item of list) {
    const f = item as Json;
    const id = str(f.feedId ?? f.id);
    if (!id) continue;
    const name = str(f.feedName ?? f.name) || `Feed ${id}`;
    const desc = str(f.description ?? f.feedDescription);
    const explicitUrl = str(f.streamUrl ?? f.url);
    const mount = str(f.mount ?? f.mountpoint);
    const upstream = explicitUrl.startsWith("http")
      ? explicitUrl
      : mount
        ? `${streamBase.replace(/\/$/, "")}/${mount.replace(/^\//, "")}`
        : `${streamBase.replace(/\/$/, "")}/${id}`;
    out.push({
      id,
      name,
      airportIcao: airport?.icao,
      frequency: extractFrequency(`${name} ${desc}`),
      type: classifyFeedType(`${name} ${str(f.genre)}`),
      streamUrl: upstream,
      latitude: typeof f.latitude === "number" ? f.latitude : airport?.lat,
      longitude: typeof f.longitude === "number" ? f.longitude : airport?.lon,
      listeners: typeof f.listeners === "number" ? f.listeners : undefined,
      status: str(f.status) || undefined,
      description: desc || [str(f.countyName), str(f.stateName), str(f.countryCode)].filter(Boolean).join(", ") || undefined,
    });
  }
  // remove duplicados por id
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

// ---------------------------------------------------------------- recomendação
export function recommendFeed(phase: FlightPhase, feeds: AtcFeed[]): AtcFeed | null {
  const usable = feeds.filter((f) => f.type !== "atis" && (f.status ?? "").toLowerCase() !== "offline");
  for (const t of preferredFeedTypes(phase)) {
    const hit = usable.find((f) => f.type === t);
    if (hit) return hit;
  }
  return usable.find((f) => f.type === "other") ?? usable[0] ?? null;
}

// ---------------------------------------------------------------- cache TTL
export class FeedCache {
  private map = new Map<string, { t: number; feeds: AtcFeed[] }>();
  get(key: string, now: number, ttlMs: number): AtcFeed[] | null {
    const hit = this.map.get(key.toUpperCase());
    if (!hit) return null;
    if (now - hit.t > ttlMs) {
      this.map.delete(key.toUpperCase());
      return null;
    }
    return hit.feeds;
  }
  set(key: string, feeds: AtcFeed[], now: number) {
    this.map.set(key.toUpperCase(), { t: now, feeds });
  }
  cachedAt(key: string): number | undefined {
    return this.map.get(key.toUpperCase())?.t;
  }
  /** upstream original por feedId — usado pelo proxy de stream sem expor a URL ao cliente */
  upstreamOf(feedId: string): string | null {
    for (const { feeds } of this.map.values()) {
      const f = feeds.find((x) => x.id === feedId);
      if (f) return f.streamUrl;
    }
    return null;
  }
  clear() {
    this.map.clear();
  }
}

// ---------------------------------------------------------------- consulta
export interface FetchOpts {
  env?: AtcEnv;
  cache?: FeedCache;
  fetchImpl?: typeof fetch;
  now?: number;
  refresh?: boolean;
  timeoutMs?: number;
}

export const serverFeedCache = new FeedCache();

const sanitize = (msg: string) => msg.replace(/key=[^&\s]+/gi, "key=***").slice(0, 200);

/**
 * Busca feeds do aeroporto com cache TTL. Nunca lança: qualquer falha vira
 * resultado vazio com `reason`, para o simulador jamais bloquear.
 */
export async function getFeedsForAirport(icao: string, opts: FetchOpts = {}): Promise<FeedsResult> {
  const env = opts.env ?? readAtcEnv();
  const cache = opts.cache ?? serverFeedCache;
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const config = publicConfig(env);
  const key = icao.trim().toUpperCase();
  const airport = airportByIcao(key);
  const base = { icao: key, source: "broadcastify", config };

  if (!airport) return { ...base, feeds: [], reason: "unknown-airport", message: `Aeroporto ${key} não está na base local.` };

  const ttlMs = env.cacheTtlHours * 3600000;
  if (!opts.refresh) {
    const hit = cache.get(key, now, ttlMs);
    if (hit) {
      return { ...base, feeds: toClientFeeds(hit), cachedAt: cache.cachedAt(key), reason: hit.length ? undefined : "no-feeds" };
    }
  }
  if (!env.apiKey) {
    return {
      ...base, feeds: [], reason: "no-api-key",
      message: "ATC ao vivo indisponível para este aeroporto. Configure BROADCASTIFY_API_KEY no servidor para habilitar os feeds do Broadcastify.",
    };
  }

  // Tentativas: busca geográfica → busca pelo ICAO → busca pela cidade.
  const q = (params: Record<string, string>) => {
    const u = new URL(env.apiBase);
    for (const [k, v] of Object.entries({ type: "json", key: env.apiKey, ...params })) u.searchParams.set(k, v);
    return u.toString();
  };
  const attempts: string[] = [
    q({ a: env.geoAction, lat: String(airport.lat), lon: String(airport.lon), radius: "30" }),
    q({ a: "search", term: airport.icao }),
    q({ a: "search", term: `${airport.city} ${airport.iata}` }),
  ];
  let lastError = "";
  for (const url of attempts) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000), cache: "no-store" });
      if (!r.ok) {
        lastError = `HTTP ${r.status}`;
        console.warn(`[atc] catálogo ${airport.icao}: ${lastError}`);
        continue;
      }
      const json = await r.json();
      const feeds = parseCatalog(json, airport, env.streamBase);
      if (feeds.length) {
        cache.set(key, feeds, now);
        console.info(`[atc] ${airport.icao}: ${feeds.length} feeds em cache (TTL ${env.cacheTtlHours}h)`);
        return { ...base, feeds: toClientFeeds(feeds), cachedAt: now };
      }
      lastError = "resposta sem feeds";
    } catch (e) {
      lastError = sanitize(e instanceof Error ? e.message : String(e));
      console.warn(`[atc] catálogo ${airport.icao}: ${lastError}`);
    }
  }
  // cacheia o vazio por um TTL curto (10 min) para não martelar a API em cliques repetidos
  cache.set(key, [], now - ttlMs + Math.min(ttlMs, 600000));
  return {
    ...base, feeds: [], cachedAt: cache.cachedAt(key),
    reason: lastError === "resposta sem feeds" ? "no-feeds" : "upstream-error",
    message: lastError === "resposta sem feeds"
      ? "ATC ao vivo indisponível para este aeroporto."
      : `Falha ao consultar o Broadcastify (${lastError}). O TTS do simulador continua funcionando.`,
  };
}

/** O player sempre recebe URL same-origin (proxy); a URL real fica no servidor. */
export function toClientFeeds(feeds: AtcFeed[]): AtcFeed[] {
  return feeds.map((f) => ({ ...f, streamUrl: `/api/atc/stream?id=${encodeURIComponent(f.id)}` }));
}