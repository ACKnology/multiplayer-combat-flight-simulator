import { NextRequest } from "next/server";
import { readAtcEnv } from "@/lib/atc/config";
import { serverFeedCache } from "@/lib/atc/feeds";

export const dynamic = "force-dynamic";

/**
 * Proxy do stream ao vivo: resolve a URL real no servidor (catálogo em cache ou
 * base configurada), aplica credenciais premium se existirem e devolve o áudio
 * same-origin — sem CORS e sem expor chave/URL assinada ao front-end.
 */
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return new Response("id inválido", { status: 400 });
  const env = readAtcEnv();
  const upstream = serverFeedCache.upstreamOf(id) ?? `${env.streamBase}/${id}`;

  const headers: Record<string, string> = { "User-Agent": "SBVS-FlightSim/1.0 (live ATC listener)", "Icy-MetaData": "0" };
  if (env.premiumUser && env.premiumPass) {
    headers.Authorization = "Basic " + Buffer.from(`${env.premiumUser}:${env.premiumPass}`).toString("base64");
  }
  try {
    const r = await fetch(upstream, { headers, signal: req.signal, cache: "no-store", redirect: "follow" });
    if (!r.ok || !r.body) {
      console.warn(`[atc] stream ${id}: upstream HTTP ${r.status}`);
      return new Response("stream indisponível", { status: 502 });
    }
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return new Response(null, { status: 499 });
    console.warn(`[atc] stream ${id}: falha de rede`);
    return new Response("falha de rede no stream", { status: 502 });
  }
}