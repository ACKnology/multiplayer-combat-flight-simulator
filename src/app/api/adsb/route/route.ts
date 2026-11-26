import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface RouteAirport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface FlightRouteInfo {
  callsign: string;
  airline?: string;
  origin?: RouteAirport;
  destination?: RouteAirport;
  registration?: string;
  aircraftName?: string;
  icaoType?: string;
}

const cache = new Map<string, { t: number; data: FlightRouteInfo }>();
const TTL = 6 * 3600 * 1000;

function mapAirport(a: Record<string, unknown> | null | undefined): RouteAirport | undefined {
  if (!a || typeof a !== "object") return undefined;
  const icao = typeof a.icao_code === "string" ? a.icao_code : "";
  const iata = typeof a.iata_code === "string" ? a.iata_code : "";
  if (!icao && !iata) return undefined;
  return {
    icao,
    iata,
    name: typeof a.name === "string" ? a.name : "",
    city: typeof a.municipality === "string" ? a.municipality : "",
    country: typeof a.country_name === "string" ? a.country_name : "",
    lat: typeof a.latitude === "number" ? a.latitude : 0,
    lon: typeof a.longitude === "number" ? a.longitude : 0,
  };
}

/**
 * Consulta rota (origem/destino) e matrícula reais via api.adsbdb.com (gratuita, sem chave).
 * Cacheado em memória no servidor; falhas retornam dados parciais sem bloquear o simulador.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const callsign = (sp.get("callsign") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hex = (sp.get("hex") ?? "").trim().toLowerCase().replace(/[^a-f0-9]/g, "");
  if (!callsign && !hex) return NextResponse.json({ error: "callsign ou hex obrigatório" }, { status: 400 });

  const key = `${callsign}|${hex}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return NextResponse.json(hit.data);

  const info: FlightRouteInfo = { callsign };
  const tasks: Promise<void>[] = [];

  if (callsign && callsign.length >= 3) {
    tasks.push(
      fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
        signal: AbortSignal.timeout(4500),
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) return;
          const j = await r.json();
          const fr = j?.response?.flightroute;
          if (!fr) return;
          info.origin = mapAirport(fr.origin);
          info.destination = mapAirport(fr.destination);
          if (typeof fr.airline?.name === "string") info.airline = fr.airline.name;
        })
        .catch(() => undefined)
    );
  }

  if (hex && hex.length === 6) {
    tasks.push(
      fetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`, {
        signal: AbortSignal.timeout(4500),
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) return;
          const j = await r.json();
          const ac = j?.response?.aircraft;
          if (!ac) return;
          if (typeof ac.registration === "string") info.registration = ac.registration;
          if (typeof ac.type === "string") info.aircraftName = ac.type;
          if (typeof ac.icao_type === "string") info.icaoType = ac.icao_type;
          if (!info.airline && typeof ac.registered_owner === "string") info.airline = ac.registered_owner;
        })
        .catch(() => undefined)
    );
  }

  await Promise.all(tasks);
  cache.set(key, { t: Date.now(), data: info });
  return NextResponse.json(info);
}
