import { pgTable, text, real, serial, timestamp, boolean, index, integer } from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: text("id").primaryKey(),
  callsign: text("callsign").notNull(),
  aircraft: text("aircraft").notNull(),
  airport: text("airport").notNull().default("SBGR"),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  z: real("z").notNull().default(0),
  qx: real("qx").notNull().default(0),
  qy: real("qy").notNull().default(0),
  qz: real("qz").notNull().default(0),
  qw: real("qw").notNull().default(1),
  vx: real("vx").notNull().default(0),
  vy: real("vy").notNull().default(0),
  vz: real("vz").notNull().default(0),
  speed: real("speed").notNull().default(0),
  gear: boolean("gear").notNull().default(true),
  hp: real("hp").notNull().default(100),
  alive: boolean("alive").notNull().default(true),
  flares: integer("flares").notNull().default(0),
  chaff: integer("chaff").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    playerId: text("player_id").notNull().default(""),
    callsign: text("callsign").notNull(),
    channel: text("channel").notNull(),
    text: text("text").notNull(),
    kind: text("kind").notNull().default("pilot"), // pilot | atc | system
    airport: text("airport").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_airport_idx").on(t.airport, t.id)]
);

// Eventos de dano multiplayer (tiros, mísseis, colisões entre jogadores)
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    targetId: text("target_id").notNull(),
    fromId: text("from_id").notNull(),
    fromCallsign: text("from_callsign").notNull(),
    dmg: real("dmg").notNull(),
    weapon: text("weapon").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_target_idx").on(t.targetId, t.id)]
);