import { NextRequest, NextResponse } from "next/server";
import { getFeedsForAirport } from "@/lib/atc/feeds";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const icao = (req.nextUrl.searchParams.get("icao") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) {
    return NextResponse.json({ error: "icao inválido" }, { status: 400 });
  }
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const result = await getFeedsForAirport(icao, { refresh });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}