import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_WX, describeWx, type Weather } from "@/sim/weather";

export const dynamic = "force-dynamic";

const cache = new Map<string, { t: number; wx: Weather }>();

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "coords" }, { status: 400 });
  }
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return NextResponse.json(hit.wx);

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day` +
      `&hourly=visibility&wind_speed_unit=ms&timezone=GMT&forecast_days=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const j = await r.json();
    const c = j.current ?? {};
    const code = num(c.weather_code, 0);
    const cloud = Math.min(1, Math.max(0, num(c.cloud_cover, 15) / 100));
    let precip = Math.max(num(c.precipitation, 0), num(c.rain, 0) + num(c.showers, 0));
    let snow = num(c.snowfall, 0);
    // intensidade mínima coerente com o código WMO (o campo "precipitation" pode vir zerado)
    const minRain: Record<number, number> = { 51: 0.3, 53: 0.5, 55: 0.8, 61: 1.5, 63: 4, 65: 9, 66: 1.5, 67: 5, 80: 2, 81: 5, 82: 10, 95: 6, 96: 8, 99: 10 };
    const minSnow: Record<number, number> = { 71: 0.5, 73: 1.5, 75: 3, 77: 0.6, 85: 1.5, 86: 3 };
    if (minRain[code]) precip = Math.max(precip, minRain[code]);
    if (minSnow[code]) snow = Math.max(snow, minSnow[code]);

    let vis = 24000;
    const times: string[] = j.hourly?.time ?? [];
    const idx = typeof c.time === "string" ? times.indexOf(`${c.time.slice(0, 13)}:00`) : -1;
    const hv = idx >= 0 ? j.hourly?.visibility?.[idx] : undefined;
    if (typeof hv === "number" && hv > 0) vis = hv;
    if (code === 45 || code === 48) vis = Math.min(vis, 500);
    else if (precip > 4) vis = Math.min(vis, 5000);

    const wind = num(c.wind_speed_10m, 3);
    const wx: Weather = {
      tempC: num(c.temperature_2m, 22),
      pressureHpa: Math.min(1060, Math.max(950, num(c.pressure_msl, 1013))),
      humidity: num(c.relative_humidity_2m, 55),
      cloud, precip, snow, code,
      windMs: wind,
      windDir: num(c.wind_direction_10m, 90),
      gustMs: Math.max(wind, num(c.wind_gusts_10m, wind)),
      visM: vis,
      thunder: code >= 95,
      summary: describeWx(code, cloud),
      source: "live",
      observed: typeof c.time === "string" ? `${c.time}Z` : "",
    };
    cache.set(key, { t: Date.now(), wx });
    return NextResponse.json(wx);
  } catch {
    const stale = cache.get(key);
    if (stale) return NextResponse.json(stale.wx);
    return NextResponse.json({ ...DEFAULT_WX, summary: "Sem dados ao vivo — clima padrão" });
  }
}