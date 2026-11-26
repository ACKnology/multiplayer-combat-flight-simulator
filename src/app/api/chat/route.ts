import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { atcName, atcReply } from "@/lib/atc";
import { airportByIcao, runwayEnds } from "@/sim/airports";

export const dynamic = "force-dynamic";

const CHANNELS = ["tower", "ground", "approach", "global", "flight"];

export async function GET(req: NextRequest) {
  const after = Number(req.nextUrl.searchParams.get("after") ?? 0) || 0;
  const airport = (req.nextUrl.searchParams.get("airport") ?? "").slice(0, 8);
  const scope = or(eq(messages.channel, "global"), eq(messages.airport, airport));
  const rows = await db.select().from(messages).where(and(gt(messages.id, after), scope)).orderBy(desc(messages.id)).limit(80);
  return NextResponse.json({ messages: rows.reverse() });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.callsign || !b?.text || !CHANNELS.includes(b?.channel)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const ap = airportByIcao(String(b.airport ?? ""));
  const runway = runwayEnds(ap).includes(String(b.runway)) ? String(b.runway) : ap.active;
  const playerId = String(b.playerId ?? "").slice(0, 64);
  const callsign = String(b.callsign).slice(0, 24);
  const channel = String(b.channel);
  const text = String(b.text).slice(0, 400);
  const kind = b.kind === "system" ? "system" : "pilot";
  const airport = channel === "global" ? "" : ap.icao;

  const [inserted] = await db.insert(messages).values({ playerId, callsign, channel, text, kind, airport }).returning();
  const created = [inserted];

  if (kind === "pilot" && ["tower", "ground", "approach"].includes(channel)) {
    if (b.noAtc) {
      const [sys] = await db
        .insert(messages)
        .values({ playerId: "atc", callsign: "SISTEMA", channel, text: "… estática. Sem resposta — a torre de controle foi destruída.", kind: "system", airport })
        .returning();
      created.push(sys);
    } else {
      const wind = typeof b.wind === "string" && /^\d{3}°\/\d{2}kt$/.test(b.wind) ? b.wind : undefined;
      const qnhN = Number(b.qnh);
      const qnh = Number.isFinite(qnhN) && qnhN > 900 && qnhN < 1100 ? Math.round(qnhN) : undefined;
      const reply = atcReply(playerId, callsign, channel, text, ap, runway, { wind, qnh });
      if (reply) {
        const [atc] = await db
          .insert(messages)
          .values({ playerId: "atc", callsign: atcName(channel, ap), channel, text: reply.text, kind: "atc", airport })
          .returning();
        created.push(atc);
      }
    }
  }
  return NextResponse.json({ ok: true, messages: created });
}