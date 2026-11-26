// Aliases e regras para Feature Discovery (reconhecimento de nós GLB por nome).
// Reconhecimento NÃO literal: aliases + sinonímias + padrões com separadores/lados.

import type { ControlChannel } from "./types";

/** Canal de comando aceito pelo AircraftController (espelha `AircraftComponentMap`). */
export type ResolveChannel = ControlChannel;

/** Mapeia aliases de identificação (ComponentKind) para o canal de controle. */
export const CHANNEL_OF_KIND: Record<string, ControlChannel> = {
  aileronLeft: "aileronLeft",
  aileronRight: "aileronRight",
  elevator: "elevator",
  rudder: "rudder",
  flapLeft: "flapL",
  flapRight: "flapR",
  spoiler: "spoiler",
  speedbrake: "speedbrake",
  gearLeft: "gearLeft",
  gearRight: "gearRight",
  gearNose: "gearNose",
  gearDoor: "gearDoor",
  propeller: "propeller",
  mainRotor: "mainRotor",
  tailRotor: "tailRotor",
  lightNav: "nav",
  lightBeacon: "beacon",
  lightStrobe: "strobe",
  lightLanding: "landing",
  door: "door",
  reverser: "reverser",
};

export interface AliasRule {
  channel: ControlChannel;
  /** padrões principais (fortes) */
  aliases: RegExp[];
  /** padrões fracos (suspeitos) */
  weak?: RegExp[];
  /** exigem que o nó seja um Mesh com volume não trivial */
  needsMesh?: boolean;
}

const NEG = (list: string[]) => list.map((s) => `(?!${s})`).join("");

/** versões de bidimensionalizar: remove separadores e caixa */
export const normName = (s: string) => s.replace(/[\s_-]+/g, "").toLowerCase();

/** lado da aeronave reportado pelo nome */
export const sideOf = (s: string): "L" | "R" | null => {
  const n = normName(s);
  if (/(^|[^a-z])left|(^|[^a-z])l[^a-z]/.test(n) || /[.\-_ ](l|left)$/.test(n) || /^(l|left)[.\-_ ]/.test(n)) return "L";
  if (/(^|[^a-z])right|(^|[^a-z])r[^a-z]/.test(n) || /[.\-_ ](r|right)$/.test(n) || /^(r|right)[.\-_ ]/.test(n)) return "R";
  if (/aileronl|flapl|gearl|mainleft/.test(n)) return "L";
  if (/aileronr|flapr|gearr|mainright/.test(n)) return "R";
  return null;
};

export const COMPONENT_ALIASES: AliasRule[] = [
  {
    channel: "aileronLeft",
    aliases: [/aileron.*l(i|eft)?/i, /l.*aileron/i, /\bail(?:eron)?_?l\b/i, /left.*ail/i],
    weak: [/aileron/i],
    needsMesh: true,
  },
  {
    channel: "aileronRight",
    aliases: [/aileron.*r(i|ight)?/i, /r.*aileron/i, /\bail(?:eron)?_?r\b/i, /right.*ail/i],
    weak: [/aileron/i],
    needsMesh: true,
  },
  {
    channel: "elevator",
    aliases: [/kicker|elevator|elevador|profundor|horizontal.*stab.*elev|stab(?!ili)|elev(?!ator)/i],
    weak: [/alleron|empen|tail.*surf/i],
    needsMesh: true,
  },
  {
    channel: "rudder",
    aliases: [/rudder|leme|vertical.*rud|rudder.*surf/i],
    weak: [/tail(?!.*plane)|vertical.*tail|fin/i],
    needsMesh: true,
  },
  {
    channel: "flapL",
    aliases: [/flap.*l/i, /l.*flap/i, /\bflap(?:s)?_?l\b/i],
    weak: [/flap/i],
    needsMesh: true,
  },
  {
    channel: "flapR",
    aliases: [/flap.*r/i, /r.*flap/i, /\bflap(?:s)?_?r\b/i],
    weak: [/flap/i],
    needsMesh: true,
  },
  {
    channel: "spoiler",
    aliases: [/spoiler|speed.?brake|s?poiler|air.?brake|airbrake/i],
    weak: [/spoiler(?:Left|Right|L|R)/i],
    needsMesh: true,
  },
  {
    channel: "speedbrake",
    aliases: [/speed.?brake|airbrake/i],
    needsMesh: true,
  },
  {
    channel: "gearLeft",
    aliases: [/gear.*(main|left|l)/i, /main.*(gear|l)/i, /left.*main.*gear/i, /main.*left/i, /\bmain.?l\b/i, /\bmain.?gear.?l(?:eft)?\b/i],
    weak: [/gear/i],
    needsMesh: true,
  },
  {
    channel: "gearRight",
    aliases: [/gear.*(main|right|r)/i, /main.*(gear|r)/i, /right.*main.*gear/i, /main.*right/i, /\bmain.?r\b/i, /\bmain.?gear.?r(?:ight)?\b/i],
    weak: [/gear/i],
    needsMesh: true,
  },
  {
    channel: "gearNose",
    aliases: [/nose.*gear|gear.*nose|front.*gear|gear.*front|bequilha/i],
    weak: [/gear/i],
    needsMesh: true,
  },
  {
    channel: "gearDoor",
    aliases: [/gear.*door|door.*gear|gear.*bay|gear.*compart/i],
    needsMesh: true,
  },
  {
    channel: "propeller",
    aliases: [/propeller|prop(?!el(?!ler))|propellerblade|props?|hélice|helice/i],
    weak: [/blade/i],
    needsMesh: true,
  },
  {
    channel: "mainRotor",
    aliases: [/main.?rotor|main.?blade|main.?rot/i],
    weak: [/rotor(?!.*tail)/i],
    needsMesh: true,
  },
  {
    channel: "tailRotor",
    aliases: [/tail.?rotor|tail.?blade|tail.?rot|antitorque/i],
    weak: [/rotor/i],
    needsMesh: true,
  },
  {
    channel: "nav",
    aliases: [/nav(?:igation)?.*light|nav.?l|l.*nav|navlight/i],
    weak: [/light/i],
  },
  {
    channel: "beacon",
    aliases: [/beacon|anti.?collision|rotating.*beacon|rot.*beacon/i],
  },
  {
    channel: "strobe",
    aliases: [/strobe|strobo|flash/i],
  },
  {
    channel: "landing",
    aliases: [/landing.*light|light.*landing|landlight|land.?light/i],
  },
  {
    channel: "door",
    aliases: [/door|doorway|hatch|hatchdoor|cargo.*door|access.*door/i],
    weak: [/door/i],
    needsMesh: true,
  },
  {
    channel: "reverser",
    aliases: [/reverse|reverser|thrust.?reverse|bucket/i],
    needsMesh: true,
  },
];
void NEG;

/** Pontua a correspondência de um nome de nó contra os aliases de um canal. */
export function matchScore(name: string, channel: ControlChannel): { score: number; source: string } {
  const rule = COMPONENT_ALIASES.find((r) => r.channel === channel);
  if (!rule) return { score: 0, source: "none" };
  const n = normName(name);
  for (const r of rule.aliases) {
    if (r.test(n)) return { score: 0.95, source: "name-alias" };
  }
  if (rule.weak) {
    for (const r of rule.weak) if (r.test(n)) return { score: 0.68, source: "name-weak" };
  }
  return { score: 0, source: "none" };
}
