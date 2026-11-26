export type PanelType = "mfd" | "steam" | "glass";
export type WeaponKind = "cannon" | "bomb" | "missileIR" | "missileRAD";

export interface AircraftSpec {
  id: string;
  name: string;
  short: string;
  role: string;
  nation: string;
  panel: PanelType;
  afterburner: boolean;
  fixedGear: boolean;
  // dimensões reais (m)
  length: number;
  span: number;
  gearHeight: number; // origem do modelo → solo com trem baixado
  cockpit: [number, number]; // [y, z] olho do piloto
  hp: number; // integridade estrutural
  // física (SI)
  mass: number; // massa de referência (kg)
  dryMass: number; // massa operacional sem combustível nem armamento (kg)
  fuelKg: number; // capacidade interna de combustível (kg)
  wingArea: number;
  thrust: number;
  abThrust: number;
  maxSpeed: number;
  stallSpeed: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  turnCoupling: number;
  gLimit: number;
  loadout: { cannon: number; bomb: number; missileIR: number; missileRAD: number };
  gunsight: boolean;
  cd0: number;
  aStall: number;
  stab: number;
  rollStab: number;
  tailStrike: number;
  propeller: boolean;
  supersonic: boolean;
  cm: { flare: number; chaff: number };
  topKmh: number;
  ceilingFt: number;
  stats: { speed: number; agility: number; firepower: number; armor: number };
  colors: { body: number; accent: number; canopy: number };
  desc: string;
  scale: number; // fator de tamanho p/ câmera (comprimento / 15 m)
}

interface Phys {
  dryMass: number;
  fuelKg: number;
  cd0: number; // arrasto parasita
  aStall: number; // ângulo de ataque de estol (rad)
  stab: number; // estabilidade estática (tendência a compensar o ângulo de ataque)
  rollStab: number; // estabilidade lateral (diedro)
  tailStrike: number; // ângulo máximo de atitude com o trem no solo (rad)
  propeller: boolean;
  supersonic: boolean;
  cm: { flare: number; chaff: number }; // contramedidas
}

const PHYS: Record<string, Phys> = {
  f16: { dryMass: 8600, fuelKg: 3200, cd0: 0.022, aStall: 0.42, stab: 0.9, rollStab: 0, tailStrike: 0.28, propeller: false, supersonic: true, cm: { flare: 60, chaff: 60 } },
  a10: { dryMass: 11320, fuelKg: 4900, cd0: 0.031, aStall: 0.37, stab: 1.0, rollStab: 0.05, tailStrike: 0.24, propeller: false, supersonic: false, cm: { flare: 120, chaff: 120 } },
  su35: { dryMass: 18400, fuelKg: 11500, cd0: 0.023, aStall: 0.46, stab: 0.9, rollStab: 0, tailStrike: 0.28, propeller: false, supersonic: true, cm: { flare: 96, chaff: 96 } },
  fa18: { dryMass: 14550, fuelKg: 6530, cd0: 0.024, aStall: 0.45, stab: 0.9, rollStab: 0, tailStrike: 0.28, propeller: false, supersonic: true, cm: { flare: 60, chaff: 60 } },
  c172: { dryMass: 900, fuelKg: 160, cd0: 0.032, aStall: 0.3, stab: 1.3, rollStab: 0.25, tailStrike: 0.24, propeller: true, supersonic: false, cm: { flare: 0, chaff: 0 } },
  b737: { dryMass: 55000, fuelKg: 16500, cd0: 0.023, aStall: 0.27, stab: 0.85, rollStab: 0.12, tailStrike: 0.15, propeller: false, supersonic: false, cm: { flare: 0, chaff: 0 } },
};

type Base = Omit<AircraftSpec, "scale" | keyof Phys>;
const mk = (a: Base): AircraftSpec => ({ ...a, ...PHYS[a.id], scale: a.length / 15 });

export const AIRCRAFT: AircraftSpec[] = [
  mk({
    id: "f16", name: "F-16C Fighting Falcon", short: "F-16C", role: "Caça multirole", nation: "EUA",
    panel: "mfd", afterburner: true, fixedGear: false,
    length: 15.06, span: 9.96, gearHeight: 1.75, cockpit: [0.95, -3.4], hp: 110,
    mass: 9500, wingArea: 28, thrust: 76000, abThrust: 129000, maxSpeed: 600, stallSpeed: 62,
    pitchRate: 1.15, rollRate: 3.4, yawRate: 0.55, turnCoupling: 2.4, gLimit: 9,
    loadout: { cannon: 511, bomb: 6, missileIR: 4, missileRAD: 2 }, gunsight: true,
    topKmh: 2178, ceilingFt: 50000,
    stats: { speed: 92, agility: 95, firepower: 80, armor: 45 },
    colors: { body: 0x8d99a6, accent: 0x4a5663, canopy: 0xd9b64a },
    desc: "Fly-by-wire lendário, relação empuxo-peso brutal. O canivete suíço da USAF — dogfight e ataque ao solo com o mesmo sorriso.",
  }),
  mk({
    id: "a10", name: "A-10C Thunderbolt II", short: "A-10C", role: "Ataque ao solo (CAS)", nation: "EUA",
    panel: "mfd", afterburner: false, fixedGear: false,
    length: 16.26, span: 17.53, gearHeight: 1.85, cockpit: [1.15, -5.2], hp: 260,
    mass: 14000, wingArea: 47, thrust: 80000, abThrust: 80000, maxSpeed: 200, stallSpeed: 52,
    pitchRate: 0.75, rollRate: 1.9, yawRate: 0.6, turnCoupling: 2.0, gLimit: 6.5,
    loadout: { cannon: 1174, bomb: 8, missileIR: 2, missileRAD: 4 }, gunsight: true,
    topKmh: 706, ceilingFt: 45000,
    stats: { speed: 35, agility: 55, firepower: 100, armor: 95 },
    colors: { body: 0x5f6b5a, accent: 0x3c4439, canopy: 0x9fb8c8 },
    desc: "O Warthog. Banheira de titânio, GAU-8 Avenger de 30 mm que faz BRRRT e cauda dupla que volta para casa em pedaços. Lento, feio e imortal.",
  }),
  mk({
    id: "su35", name: "Su-35S Flanker-E", short: "SU-35S", role: "Superioridade aérea", nation: "Rússia",
    panel: "mfd", afterburner: true, fixedGear: false,
    length: 21.9, span: 15.3, gearHeight: 2.25, cockpit: [1.2, -6.0], hp: 150,
    mass: 19000, wingArea: 62, thrust: 172000, abThrust: 284000, maxSpeed: 690, stallSpeed: 58,
    pitchRate: 1.3, rollRate: 3.0, yawRate: 0.7, turnCoupling: 2.6, gLimit: 9,
    loadout: { cannon: 150, bomb: 6, missileIR: 6, missileRAD: 2 }, gunsight: true,
    topKmh: 2500, ceilingFt: 59000,
    stats: { speed: 100, agility: 98, firepower: 85, armor: 60 },
    colors: { body: 0x7d8fa6, accent: 0x3c5a84, canopy: 0xc7a94f },
    desc: "Empuxo vetorial 3D, manobra Pugachev e mísseis R-73. O ápice da família Flanker — dança no ar onde outros estolam.",
  }),
  mk({
    id: "fa18", name: "F/A-18E Super Hornet", short: "F/A-18E", role: "Caça embarcado", nation: "EUA",
    panel: "mfd", afterburner: true, fixedGear: false,
    length: 18.31, span: 13.62, gearHeight: 2.05, cockpit: [1.1, -5.0], hp: 140,
    mass: 14500, wingArea: 46, thrust: 124000, abThrust: 196000, maxSpeed: 530, stallSpeed: 56,
    pitchRate: 1.05, rollRate: 2.8, yawRate: 0.6, turnCoupling: 2.3, gLimit: 7.5,
    loadout: { cannon: 412, bomb: 6, missileIR: 4, missileRAD: 4 }, gunsight: true,
    topKmh: 1915, ceilingFt: 50000,
    stats: { speed: 82, agility: 86, firepower: 88, armor: 58 },
    colors: { body: 0x7a8794, accent: 0x343f4a, canopy: 0xcf9f3e },
    desc: "O Rhino da Marinha. Alto ângulo de ataque impressionante, carga bélica de porta-aviões e trem de pouso feito para pancada.",
  }),
  mk({
    id: "c172", name: "Cessna 172 Skyhawk", short: "C-172", role: "Aviação geral", nation: "EUA",
    panel: "steam", afterburner: false, fixedGear: true,
    length: 8.28, span: 11.0, gearHeight: 1.3, cockpit: [0.55, -0.6], hp: 55,
    mass: 1050, wingArea: 16, thrust: 2550, abThrust: 2550, maxSpeed: 72, stallSpeed: 25,
    pitchRate: 0.6, rollRate: 1.2, yawRate: 0.5, turnCoupling: 1.6, gLimit: 3.8,
    loadout: { cannon: 0, bomb: 0, missileIR: 0, missileRAD: 0 }, gunsight: false,
    topKmh: 226, ceilingFt: 13500,
    stats: { speed: 12, agility: 30, firepower: 0, armor: 10 },
    colors: { body: 0xeceae3, accent: 0xb03a2e, canopy: 0x5d7a8c },
    desc: "O avião mais produzido da história. Six-pack analógico, trem fixo, cheiro de avgas e o circuito de tráfego perfeito para aprender a falar com a torre.",
  }),
  mk({
    id: "b737", name: "Boeing 737-800", short: "B738", role: "Linha aérea", nation: "EUA",
    panel: "glass", afterburner: false, fixedGear: false,
    length: 39.5, span: 35.8, gearHeight: 2.95, cockpit: [1.0, -17.4], hp: 220,
    mass: 62000, wingArea: 125, thrust: 215000, abThrust: 215000, maxSpeed: 260, stallSpeed: 70,
    pitchRate: 0.35, rollRate: 0.7, yawRate: 0.25, turnCoupling: 1.3, gLimit: 2.5,
    loadout: { cannon: 0, bomb: 0, missileIR: 0, missileRAD: 0 }, gunsight: false,
    topKmh: 842, ceilingFt: 41000,
    stats: { speed: 55, agility: 15, firepower: 0, armor: 70 },
    colors: { body: 0xf1f3f5, accent: 0x1f5fa8, canopy: 0x1a2530 },
    desc: "Glass cockpit, 189 passageiros imaginários e responsabilidade enorme. Voe o circuito como os profissionais — e escute a torre.",
  }),
];

export const byId = (id: string) => AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[0];

/** Peso instantâneo em kg = massa operacional + combustível + armamento carregado */
export function computeMassKg(
  spec: AircraftSpec,
  fuelFrac: number,
  ammo: { cannon: number; bomb: number; missileIR: number; missileRAD: number }
): { totalKg: number; fuelKg: number; weaponsKg: number } {
  const fuelKg = spec.fuelKg * Math.max(0, Math.min(1, fuelFrac));
  const weaponsKg =
    ammo.bomb * 230 +
    ammo.missileIR * 88 +
    ammo.missileRAD * 155 +
    ammo.cannon * 0.28;
  return { totalKg: spec.dryMass + fuelKg + weaponsKg, fuelKg, weaponsKg };
}

export const WEAPON_LABEL: Record<WeaponKind, string> = {
  cannon: "CANHÃO",
  bomb: "BOMBA MK-82",
  missileIR: "MÍSSIL IR (CALOR)",
  missileRAD: "MÍSSIL GUIADO RÁDIO",
};