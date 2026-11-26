import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Proxy de áudio TTS (pt-BR) usado SOMENTE pelo RadioAudioProcessor.
 *
 * Aqui não há processamento de áudio: apenas obtemos os bytes de fala (MP3) para que
 * o navegador possa decodificá-los na Web Audio API e aplicar a cadeia de rádio.
 * Com os efeitos desligados, esta rota nem é chamada (o simulador usa o TTS nativo).
 *
 * Cache em memória por texto evita chamadas repetidas e reduz a carga no provedor.
 */
const cache = new Map<string, { t: number; buf: ArrayBuffer; type: string }>();
const TTL = 12 * 3600 * 1000;
const MAX_TEXT = 220;
const inflight = new Map<string, Promise<{ buf: ArrayBuffer; type: string }>>();

function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, MAX_TEXT);
}

async function fetchTts(text: string): Promise<{ buf: ArrayBuffer; type: string }> {
  const url =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&ttsspeed=1&q=" +
    encodeURIComponent(text);
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Referer: "https://translate.google.com/",
      Accept: "audio/mpeg,*/*",
    },
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`tts upstream ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 512) throw new Error("tts vazio");
  return { buf, type: r.headers.get("content-type") ?? "audio/mpeg" };
}

async function resolveTts(text: string): Promise<{ buf: ArrayBuffer; type: string }> {
  const hit = cache.get(text);
  if (hit && Date.now() - hit.t < TTL) return hit;
  const existing = inflight.get(text);
  if (existing) return existing;
  const p = fetchTts(text)
    .then((res) => {
      cache.set(text, { t: Date.now(), ...res });
      if (cache.size > 300) {
        const first = cache.keys().next().value;
        if (first !== undefined) cache.delete(first);
      }
      return res;
    })
    .finally(() => inflight.delete(text));
  inflight.set(text, p);
  return p;
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  const text = sanitize(typeof body.text === "string" ? body.text : "");
  if (text.length < 2) return NextResponse.json({ error: "texto inválido" }, { status: 400 });
  try {
    const { buf, type } = await resolveTts(text);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": type.startsWith("audio/") ? type : "audio/mpeg",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.warn(`[tts] falha: ${e instanceof Error ? e.message : "desconhecida"}`);
    return NextResponse.json({ error: "tts indisponível" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const text = sanitize(req.nextUrl.searchParams.get("text") ?? "");
  if (text.length < 2) return NextResponse.json({ error: "texto inválido" }, { status: 400 });
  try {
    const { buf, type } = await resolveTts(text);
    return new NextResponse(buf, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "tts indisponível" }, { status: 502 });
  }
}
