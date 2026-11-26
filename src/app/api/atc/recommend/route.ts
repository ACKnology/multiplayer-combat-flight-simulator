import { NextRequest, NextResponse } from "next/server";
import { findNearestAirport } from "@/lib/atc/airports";
import { classifyPhase, inferRoute, PHASE_LABEL } from "@/lib/atc/phase";
import { getFeedsForAirport, recommendFeed } from "@/lib/atc/feeds";
import { publicConfig, readAtcEnv } from "@/lib/atc/config";
import type { AtcAircraft } from "@/lib/atc/types";

export const dynamic = "force-dynamic";

const num = (v: string | null) => {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : undefined;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "lat/lon inválidos" }, { status: 400 });
  }
  const env = readAtcEnv();
  const aircraft: AtcAircraft = {
    callsign: (sp.get("callsign") ?? "").trim().toUpperCase() || "N/A",
    icao24: sp.get("icao24") ?? undefined,
    latitude: lat,
    longitude: lon,
    altitudeFt: num(sp.get("altFt")),
    groundSpeedKts: num(sp.get("gsKt")),
    heading: num(sp.get("heading")),
    verticalFpm: num(sp.get("vsFpm")),
    onGround: sp.get("onGround") === "1",
    origin: sp.get("origin")?.toUpperCase() || undefined,
    destination: sp.get("destination")?.toUpperCase() || undefined,
  };
  const nearest = findNearestAirport(lat, lon, env.radiusNm, { destination: aircraft.destination, origin: aircraft.origin });
  const phase = classifyPhase(aircraft, nearest?.airport ?? null);
  const route = inferRoute(phase, nearest?.airport.icao, aircraft);
  if (!nearest) {
    return NextResponse.json({
      airport: null, distanceNm: null, phase, phaseLabel: PHASE_LABEL[phase], route,
      recommendedId: null, feeds: [], reason: "no-airport",
      message: "Nenhum aeroporto na base local dentro do raio configurado.", config: publicConfig(env),
    });
  }
  const feedsResult = await getFeedsForAirport(nearest.airport.icao);
  const rec = recommendFeed(phase, feedsResult.feeds);
  return NextResponse.json({
    airport: nearest.airport,
    distanceNm: Math.round(nearest.distanceNm * 10) / 10,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    route,
    recommendedId: rec?.id ?? null,
    feeds: feedsResult.feeds,
    reason: feedsResult.reason,
    message: feedsResult.message,
    source: feedsResult.source,
    cachedAt: feedsResult.cachedAt,
    config: publicConfig(env),
  });
}