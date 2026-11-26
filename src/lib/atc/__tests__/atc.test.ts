import "./phonetic.test.ts";
// Testes unitários do subsystema Live ATC (node:test).
// Executar: node scripts/test-atc.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearestAirport, distanceNm, airportByIcao } from "../airports";
import { classifyPhase, preferredFeedTypes, inferRoute } from "../phase";
import { FeedCache, classifyFeedType, extractFrequency, getFeedsForAirport, parseCatalog, recommendFeed } from "../feeds";
import { readAtcEnv, publicConfig } from "../config";
import type { AtcAircraft, AtcFeed } from "../types";

const ac = (o: Partial<AtcAircraft> = {}): AtcAircraft => ({
  callsign: "TST123", latitude: 0, longitude: 0, ...o,
});
const feed = (id: string, type: AtcFeed["type"], status?: string): AtcFeed => ({
  id, name: `${type} feed`, type, streamUrl: `/api/atc/stream?id=${id}`, status,
});

// ---------------------------------------------------------------- aeroporto mais próximo
test("distância haversine: GRU→LAS ≈ 5200 nm (ordem de grandeza)", () => {
  const d = distanceNm(-23.43, -46.47, 36.08, -115.15);
  assert.ok(d > 5000 && d < 5600, `distância=${d}`);
});

test("nearest: sobre Las Vegas encontra KLAS", () => {
  const hit = findNearestAirport(36.08, -115.15, 100);
  assert.ok(hit);
  assert.equal(hit!.airport.icao, "KLAS");
  assert.ok(hit!.distanceNm < 1);
});

test("nearest: reutiliza a base do simulador (SBGR)", () => {
  const hit = findNearestAirport(-23.43, -46.47, 30);
  assert.equal(hit?.airport.icao, "SBGR");
});

test("nearest: fora do raio retorna null", () => {
  assert.equal(findNearestAirport(0, -30, 100), null); // meio do Atlântico
});

test("nearest: prioridade destino > origem > mais próximo", () => {
  // Perto deCongonhas (SBSP), com Guarulhos (SBGR) também no raio
  const lat = -23.6277, lon = -46.6546;
  const semPrefs = findNearestAirport(lat, lon, 60);
  assert.equal(semPrefs?.airport.icao, "SBSP");
  const comDestino = findNearestAirport(lat, lon, 60, { destination: "SBGR", origin: "SBSP" });
  assert.equal(comDestino?.airport.icao, "SBGR");
  const comOrigem = findNearestAirport(lat, lon, 60, { origin: "SBGR" });
  assert.equal(comOrigem?.airport.icao, "SBGR");
  // destino fora do raio é ignorado
  const destinoLonge = findNearestAirport(lat, lon, 60, { destination: "KLAS" });
  assert.equal(destinoLonge?.airport.icao, "SBSP");
});

test("nearest: aceita IATA como preferência e coordenadas inválidas retornam null", () => {
  const hit = findNearestAirport(-23.6277, -46.6546, 60, { destination: "GRU" });
  assert.equal(hit?.airport.icao, "SBGR");
  assert.equal(findNearestAirport(NaN, 0, 100), null);
});

// ---------------------------------------------------------------- fase de voo
const klas = airportByIcao("KLAS")!;

test("fase: táxi e corrida de decolagem no solo", () => {
  assert.equal(classifyPhase(ac({ onGround: true, groundSpeedKts: 12 }), klas), "taxi");
  assert.equal(classifyPhase(ac({ onGround: true, groundSpeedKts: 120 }), klas), "takeoff");
});

test("fase: subida, cruzeiro, descida, aproximação e pouso", () => {
  assert.equal(classifyPhase(ac({ altitudeFt: klas.elevFt + 900, verticalFpm: 1800, groundSpeedKts: 160 }), klas), "takeoff");
  assert.equal(classifyPhase(ac({ altitudeFt: 8000, verticalFpm: 1500, groundSpeedKts: 280 }), klas), "climb");
  assert.equal(classifyPhase(ac({ altitudeFt: 35000, verticalFpm: 0, groundSpeedKts: 450 }), klas), "cruise");
  assert.equal(classifyPhase(ac({ altitudeFt: 20000, verticalFpm: -1800, groundSpeedKts: 400 }), klas), "descent");
  assert.equal(classifyPhase(ac({ altitudeFt: klas.elevFt + 1500, verticalFpm: -700, groundSpeedKts: 150 }), klas), "approach");
  assert.equal(classifyPhase(ac({ altitudeFt: klas.elevFt + 120, verticalFpm: -650, groundSpeedKts: 140 }), klas), "landing");
});

test("fase: sem aeroporto próximo usa o perfil vertical (em rota)", () => {
  assert.equal(classifyPhase(ac({ altitudeFt: 36000, verticalFpm: 0 }), null), "enroute");
  assert.equal(classifyPhase(ac({ altitudeFt: 36000, verticalFpm: 900 }), null), "climb");
});

test("rota inferida: subindo → origem; descendo → destino", () => {
  assert.equal(inferRoute("climb", "KLAS").origin, "KLAS");
  assert.equal(inferRoute("approach", "KLAS").destination, "KLAS");
  assert.deepEqual(inferRoute("cruise", "KLAS", { origin: "KJFK" }), { origin: "KJFK", destination: undefined });
});

// ---------------------------------------------------------------- recomendação de feed
test("recomendação por fase segue a regra de produto", () => {
  const feeds = [feed("1", "ground"), feed("2", "tower"), feed("3", "approach"), feed("4", "departure"), feed("5", "center")];
  assert.equal(recommendFeed("taxi", feeds)?.id, "1");
  assert.equal(recommendFeed("takeoff", feeds)?.id, "2");
  assert.equal(recommendFeed("climb", feeds)?.id, "4");
  assert.equal(recommendFeed("descent", feeds)?.id, "3");
  assert.equal(recommendFeed("approach", feeds)?.id, "3");
  assert.equal(recommendFeed("landing", feeds)?.id, "2");
  assert.equal(recommendFeed("enroute", feeds)?.id, "5");
});

test("recomendação: fallbacks e exclusões", () => {
  assert.equal(recommendFeed("taxi", [feed("t", "tower")])?.id, "t"); // sem ground → tower
  assert.equal(recommendFeed("enroute", [feed("a", "atis"), feed("t", "tower")])?.id, "t"); // nunca ATIS
  assert.equal(recommendFeed("taxi", [feed("g", "ground", "offline"), feed("t", "tower")])?.id, "t"); // offline ignorado
  assert.equal(recommendFeed("taxi", []), null);
  assert.deepEqual(preferredFeedTypes("landing"), ["tower", "ground"]);
});

test("classificação de tipo e extração de frequência", () => {
  assert.equal(classifyFeedType("KLAS McCarran Tower 118.1"), "tower");
  assert.equal(classifyFeedType("Las Vegas Ground/ Clearance"), "ground");
  assert.equal(classifyFeedType("LAS Approach (Nellis RAPCON)"), "approach");
  assert.equal(classifyFeedType("LAS Departure"), "departure");
  assert.equal(classifyFeedType("Los Angeles ARTCC Center"), "center");
  assert.equal(classifyFeedType("KLAS ATIS"), "atis");
  assert.equal(extractFrequency("Tower 125.65 / 118.1"), "125.65");
  assert.equal(extractFrequency("sem frequência"), undefined);
});

// ---------------------------------------------------------------- parser do catálogo
test("parser aceita formatos variados do catálogo e gera URL de upstream", () => {
  const a = airportByIcao("KLAS");
  const f1 = parseCatalog({ feeds: [{ feedId: 123, feedName: "KLAS Tower 118.1", status: "Online", listeners: 42 }] }, a, "https://cdn.example");
  assert.equal(f1.length, 1);
  assert.equal(f1[0].id, "123");
  assert.equal(f1[0].type, "tower");
  assert.equal(f1[0].frequency, "118.1");
  assert.equal(f1[0].streamUrl, "https://cdn.example/123");
  const f2 = parseCatalog([{ id: "9", name: "LAS Ground", mount: "/lasgnd", streamUrl: "https://signed.example/x?token=abc" }], a, "https://cdn.example");
  assert.equal(f2[0].streamUrl, "https://signed.example/x?token=abc"); // URL assinada preservada
  assert.deepEqual(parseCatalog({ nada: true }, a, "https://cdn"), []);
});

// ---------------------------------------------------------------- cache TTL
test("cache: hit dentro do TTL, expiração e chave por ICAO", () => {
  const c = new FeedCache();
  const f = [feed("1", "tower")];
  c.set("klas", f, 1000);
  assert.deepEqual(c.get("KLAS", 1000 + 3600000, 6 * 3600000), f);
  assert.equal(c.get("KLAS", 1000 + 7 * 3600000, 6 * 3600000), null); // expirou
  c.set("KLAS", f, 5000);
  assert.equal(c.get("KJFK", 5000, 3600000), null); // outra chave
  assert.equal(c.upstreamOf("1"), "/api/atc/stream?id=1");
});

// ---------------------------------------------------------------- consulta com falhas
const env = (over: Record<string, string> = {}) => readAtcEnv({
  NODE_ENV: "test",
  BROADCASTIFY_API_KEY: "test-key-123", ATC_FEED_CACHE_TTL_HOURS: "6", ATC_SEARCH_RADIUS_NM: "100",
  ATC_MAX_RECONNECT_ATTEMPTS: "4", LIVE_ATC_DEFAULT_VOLUME: "0.8", SIM_ATC_DEFAULT_VOLUME: "0.9", ...over,
} as NodeJS.ProcessEnv);

test("sem chave: retorna no-api-key sem chamar a rede e sem vazar segredo", async () => {
  let calls = 0;
  const r = await getFeedsForAirport("KLAS", {
    env: env({ BROADCASTIFY_API_KEY: "" }), cache: new FeedCache(),
    fetchImpl: (async () => { calls++; throw new Error("não deveria chamar"); }) as typeof fetch,
  });
  assert.equal(r.reason, "no-api-key");
  assert.deepEqual(r.feeds, []);
  assert.equal(calls, 0);
  assert.equal(r.config.providerConfigured, false);
  assert.ok(!JSON.stringify(r).includes("test-key"));
});

test("consulta: sucesso popula cache e segundo clique não chama a API", async () => {
  let calls = 0;
  const ok = (async () => {
    calls++;
    return new Response(JSON.stringify({ feeds: [{ feedId: 77, feedName: "KLAS Tower" }] }), { status: 200 });
  }) as typeof fetch;
  const cache = new FeedCache();
  const e = env();
  const r1 = await getFeedsForAirport("KLAS", { env: e, cache, fetchImpl: ok, now: 1000 });
  assert.equal(r1.feeds.length, 1);
  assert.equal(r1.feeds[0].streamUrl, "/api/atc/stream?id=77"); // cliente recebe só o proxy
  const r2 = await getFeedsForAirport("KLAS", { env: e, cache, fetchImpl: ok, now: 1000 + 3600000 });
  assert.equal(r2.feeds.length, 1);
  assert.equal(calls, 1); // cache válido → nenhuma chamada extra
  const r3 = await getFeedsForAirport("KLAS", { env: e, cache, fetchImpl: ok, now: 1000, refresh: true });
  assert.equal(calls, 2); // refresh força
  assert.equal(r3.feeds.length, 1);
});

test("falha da API: nunca lança, retorna upstream-error e sanitiza a chave nos logs/mensagem", async () => {
  const boom = (async () => { throw new Error("timeout key=test-key-123"); }) as typeof fetch;
  const r = await getFeedsForAirport("KLAS", { env: env(), cache: new FeedCache(), fetchImpl: boom });
  assert.deepEqual(r.feeds, []);
  assert.equal(r.reason, "upstream-error");
  assert.ok(r.message && !r.message.includes("test-key-123"), "mensagem não pode conter a chave");
});

test("HTTP 500 em todas as tentativas → upstream-error; catálogo vazio → no-feeds", async () => {
  const fail = (async () => new Response("err", { status: 500 })) as typeof fetch;
  const r1 = await getFeedsForAirport("KLAS", { env: env(), cache: new FeedCache(), fetchImpl: fail });
  assert.equal(r1.reason, "upstream-error");
  const empty = (async () => new Response(JSON.stringify({ feeds: [] }), { status: 200 })) as typeof fetch;
  const r2 = await getFeedsForAirport("KLAS", { env: env(), cache: new FeedCache(), fetchImpl: empty });
  assert.equal(r2.reason, "no-feeds");
});

test("aeroporto desconhecido → unknown-airport; config pública não expõe credenciais", () => {
  const e = env();
  const pub = publicConfig(e);
  assert.equal(pub.providerConfigured, true);
  assert.equal(pub.maxReconnect, 4);
  assert.equal(pub.liveVolume, 0.8);
  assert.ok(!("apiKey" in pub));
});

test("aeroporto desconhecido retorna razão dedicada", async () => {
  const r = await getFeedsForAirport("ZZZZ", { env: env(), cache: new FeedCache() });
  assert.equal(r.reason, "unknown-airport");
});