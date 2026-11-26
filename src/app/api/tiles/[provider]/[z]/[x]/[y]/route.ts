import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// sessão da Google Map Tiles API (2D) em cache no servidor
let googleSession: { id: string; exp: number } | null = null;

async function getGoogleSession(key: string): Promise<string | null> {
  if (googleSession && googleSession.exp > Date.now() + 60000) return googleSession.id;
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "pt-BR", region: "BR" }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { session?: string; expiry?: string };
  if (!j.session) return null;
  googleSession = { id: j.session, exp: j.expiry ? Number(j.expiry) * 1000 : Date.now() + 3600_000 };
  return j.session;
}

export async function GET(_req: Request, ctx: { params: Promise<{ provider: string; z: string; x: string; y: string }> }) {
  const { provider, z, x, y } = await ctx.params;
  const Z = parseInt(z, 10), X = parseInt(x, 10), Y = parseInt(y, 10);
  if (![Z, X, Y].every(Number.isFinite) || Z < 0 || Z > 19 || X < 0 || Y < 0 || X >= 2 ** Z || Y >= 2 ** Z) {
    return new NextResponse(null, { status: 400 });
  }
  let url: string;
  switch (provider) {
    case "esri":
      url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${Y}/${X}`;
      break;
    case "osm":
      url = `https://tile.openstreetmap.org/${Z}/${X}/${Y}.png`;
      break;
    case "terrarium":
      url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${X}/${Y}.png`;
      break;
    case "google": {
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) return new NextResponse("GOOGLE_MAPS_API_KEY ausente", { status: 404 });
      const session = await getGoogleSession(key);
      if (!session) return new NextResponse("sessão Google indisponível", { status: 502 });
      url = `https://tile.googleapis.com/v1/2dtiles/${Z}/${X}/${Y}?session=${session}&key=${encodeURIComponent(key)}`;
      break;
    }
    default:
      return new NextResponse(null, { status: 404 });
  }
  try {
    const r = await fetch(url, { headers: { "User-Agent": "SBVS-FlightSim/2.0 (simulador educacional)" } });
    if (!r.ok) return new NextResponse(null, { status: r.status });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}