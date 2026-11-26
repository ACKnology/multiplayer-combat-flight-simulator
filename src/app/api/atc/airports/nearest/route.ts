import { NextRequest, NextResponse } from "next/server";
import { findNearestAirport } from "@/lib/atc/airports";
import { publicConfig, readAtcEnv } from "@/lib/atc/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const env = readAtcEnv();
  const radiusNm = Math.min(500, Math.max(1, Number(sp.get("radiusNm")) || env.radiusNm));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "lat/lon inválidos" }, { status: 400 });
  }
  const hit = findNearestAirport(lat, lon, radiusNm, {
    destination: sp.get("destination") ?? undefined,
    origin: sp.get("origin") ?? undefined,
  });
  return NextResponse.json({
    airport: hit?.airport ?? null,
    distanceNm: hit ? Math.round(hit.distanceNm * 10) / 10 : null,
    radiusNm,
    config: publicConfig(env),
  });
}