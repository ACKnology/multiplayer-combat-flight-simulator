import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { players } from "@/db/schema";
import { gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const cutoff = new Date(Date.now() - 8000);
  const rows = await db.select().from(players).where(gt(players.updatedAt, cutoff));
  return NextResponse.json({ players: rows });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b?.id || !b?.callsign) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const row = {
    id: String(b.id).slice(0, 64),
    callsign: String(b.callsign).slice(0, 24),
    aircraft: String(b.aircraft ?? "f16").slice(0, 24),
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    z: Number(b.z) || 0,
    qx: Number(b.qx) || 0,
    qy: Number(b.qy) || 0,
    qz: Number(b.qz) || 0,
    qw: Number(b.qw ?? 1),
    speed: Number(b.speed) || 0,
    gear: Boolean(b.gear),
    updatedAt: new Date(),
  };
  await db.insert(players).values(row).onConflictDoUpdate({ target: players.id, set: row });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const { eq } = await import("drizzle-orm");
    await db.delete(players).where(eq(players.id, id));
  }
  return NextResponse.json({ ok: true });
}