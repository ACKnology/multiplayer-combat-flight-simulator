import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, messages, players } from "@/db/schema";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Sincronização multiplayer em uma única requisição:
 * publica o estado do jogador + acertos causados, e recebe jogadores do mesmo aeroporto,
 * danos recebidos e novas mensagens de rádio.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.callsign) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const id = String(b.id).slice(0, 64);
  const airport = String(b.airport ?? "SBGR").slice(0, 8);
  const s = b.state ?? {};
  const row = {
    id,
    callsign: String(b.callsign).slice(0, 24),
    aircraft: String(b.aircraft ?? "f16").slice(0, 16),
    airport,
    x: num(s.x), y: num(s.y), z: num(s.z),
    qx: num(s.qx), qy: num(s.qy), qz: num(s.qz), qw: num(s.qw, 1),
    vx: num(s.vx), vy: num(s.vy), vz: num(s.vz),
    speed: num(s.speed), gear: Boolean(s.gear), hp: num(s.hp, 100), alive: s.alive !== false,
    flares: Math.max(0, Math.floor(num(s.fl))), chaff: Math.max(0, Math.floor(num(s.ch))),
    updatedAt: new Date(),
  };
  await db.insert(players).values(row).onConflictDoUpdate({ target: players.id, set: row });

  const hits = Array.isArray(b.hits) ? b.hits.slice(0, 60) : [];
  if (hits.length) {
    await db.insert(events).values(
      hits.map((h: { target?: unknown; dmg?: unknown; weapon?: unknown }) => ({
        targetId: String(h.target ?? "").slice(0, 64),
        fromId: id,
        fromCallsign: row.callsign,
        dmg: Math.min(10000, Math.max(0, num(h.dmg))),
        weapon: String(h.weapon ?? "").slice(0, 24),
      }))
    );
  }

  const lastEvent = num(b.lastEvent);
  const lastMsg = num(b.lastMsg);
  const cutoff = new Date(Date.now() - 8000);
  const scope = or(eq(messages.airport, airport), eq(messages.channel, "global"));
  const [plist, evs, msgs] = await Promise.all([
    db.select().from(players).where(and(eq(players.airport, airport), gt(players.updatedAt, cutoff))),
    db.select().from(events).where(and(eq(events.targetId, id), gt(events.id, lastEvent))).orderBy(asc(events.id)).limit(60),
    lastMsg > 0
      ? db.select().from(messages).where(and(gt(messages.id, lastMsg), scope)).orderBy(asc(messages.id)).limit(60)
      : db.select().from(messages).where(scope).orderBy(desc(messages.id)).limit(25).then((r) => r.reverse()),
  ]);

  if (Math.random() < 0.03) {
    await Promise.all([
      db.delete(events).where(lt(events.createdAt, new Date(Date.now() - 120000))),
      db.delete(players).where(lt(players.updatedAt, new Date(Date.now() - 600000))),
    ]);
  }

  return NextResponse.json({ players: plist, events: evs, messages: msgs });
}