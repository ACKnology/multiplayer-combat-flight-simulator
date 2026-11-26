import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Aeronave ADS-B normalizada (posições reais, estilo FlightRadar24)
export interface AdsbAircraft {
  hex: string;
  flight: string; // callsign
  reg: string; // matrícula
  type: string; // código ICAO do modelo (A320, B738…)
  desc: string;
  lat: number;
  lon: number;
  altFt: number; // altitude MSL (geométrica quando disponível)
  gsKt: number;
  trackDeg: number;
  vsFpm: number;
  onGround: boolean;
  category: string;
  squawk: string;
}

interface CacheEntry { t: number; aircraft: AdsbAircraft[]; source: string; total: number }
const cache = new Map<string, CacheEntry>();
const UA = "SBVS-FlightSim/1.0 (educational flight simulator; contact: local)";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** adsb.fi / airplanes.live — dados comunitários abertos */
async function fromAdsbFi(lat: number, lon: number, distNm: number): Promise<AdsbAircraft[]> {
  const r = await fetch(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${distNm}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`adsb.fi ${r.status}`);
  const j = await r.json();
  const list: AdsbAircraft[] = [];
  for (const a of j.aircraft ?? []) {
    if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    const ground = a.alt_baro === "ground";
    const altFt = num(a.alt_geom, ground ? 0 : num(a.alt_baro, 0));
    list.push({
      hex: str(a.hex), flight: str(a.flight), reg: str(a.r), type: str(a.t), desc: str(a.desc),
      lat: a.lat, lon: a.lon, altFt, gsKt: num(a.gs), trackDeg: num(a.track),
      vsFpm: num(a.baro_rate, num(a.geom_rate)), onGround: ground, category: str(a.category), squawk: str(a.squawk),
    });
  }
  return list;
}

/** OpenSky Network — fallback anônimo */
async function fromOpenSky(lat: number, lon: number, distNm: number): Promise<AdsbAircraft[]> {
  const dLat = distNm / 60;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const url = `https://opensky-network.org/api/states/all?lamin=${lat - dLat}&lomin=${lon - dLon}&lamax=${lat + dLat}&lomax=${lon + dLon}`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000), cache: "no-store" });
  if (!r.ok) throw new Error(`opensky ${r.status}`);
  const j = await r.json();
  const list: AdsbAircraft[] = [];
  for (const s of j.states ?? []) {
    if (typeof s[6] !== "number" || typeof s[5] !== "number") continue;
    const altM = num(s[13], num(s[7]));
    list.push({
      hex: str(s[0]), flight: str(s[1]), reg: "", type: "", desc: str(s[2]),
      lat: s[6], lon: s[5], altFt: altM * 3.28084, gsKt: num(s[9]) * 1.94384,
      trackDeg: num(s[10]), vsFpm: num(s[11]) * 196.85, onGround: Boolean(s[8]),
      category: "", squawk: str(s[14]),
    });
  }
  return list;
}

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const distNm = Math.min(60, Math.max(5, Number(req.nextUrl.searchParams.get("dist")) || 30));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "coords" }, { status: 400 });
  }
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${distNm}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 5000) {
    return NextResponse.json({ ...hit, ageMs: Date.now() - hit.t });
  }
  let aircraft: AdsbAircraft[] | null = null;
  let source = "";
  try {
    aircraft = await fromAdsbFi(lat, lon, distNm);
    source = "adsb.fi";
  } catch {
    try {
      aircraft = await fromOpenSky(lat, lon, distNm);
      source = "OpenSky";
    } catch {
      /* ambas indisponíveis */
    }
  }
  if (aircraft) {
    const entry: CacheEntry = { t: Date.now(), aircraft, source, total: aircraft.length };
    cache.set(key, entry);
    return NextResponse.json({ ...entry, ageMs: 0 });
  }
  if (hit) return NextResponse.json({ ...hit, ageMs: Date.now() - hit.t, stale: true });
  return NextResponse.json({ t: Date.now(), aircraft: [], source: "offline", total: 0, ageMs: 0 });
}