/**
 * AircraftRegistry — catálogo único de aeronaves do simulador.
 *
 * Reúne, num só ponto de referência:
 *  - as 6 aeronaves PROCEDURAIS originais (preservadas; geometria construída por código)
 *  - as aeronaves GLB cadastradas em public/aircraft/<id>/
 *
 * Ambas compartilham a mesma interface (`RegistryEntry`), de modo que a aeronave
 * pilotada e o tráfego ADS-B usam o mesmo sistema.
 */
import type { AircraftConfiguration } from "./types";
import * as glbManifests from "./manifest";
import { AIRCRAFT as PROCEDURAL_SPECS, byId as proceduralById } from "@/sim/aircraft";

export type GeometryOrigin = "procedural" | "glb";

export interface RegistryEntry {
  /** identificador único no catálogo */
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  variant: string;
  /** designação ICAO de tipo, quando aplicável */
  icaoType?: string;
  category: "general-aviation" | "commercial" | "military" | "helicopter" | "executive" | "experimental";
  origin: GeometryOrigin;
  /** config GLB (somente quando origin === "glb") */
  config: AircraftConfiguration | null;
  /** spec procedural (somente quando origin === "procedural") */
  specId: string | null;
  /** liveries disponíveis (ids); procedural = [] */
  liveries: string[];
  /** uso principal: aeronave pilotável pelo usuário */
  flyable: boolean;
  /** pode ser usada para representar tráfego ADS-B */
  usableForTraffic: boolean;
  license: { license: string; author: string; source: string; attribution: string };
}

/** Especificidade das aeronaves procedurais originais (metadados declarativos). */
interface ProcMeta {
  icaoType?: string;
  category: RegistryEntry["category"];
  manufacturer: string;
  variant: string;
  flyable: boolean;
  usableForTraffic: boolean;
}

const PROCEDURAL_META: Record<string, ProcMeta> = {
  f16: { icaoType: "F16", category: "military", manufacturer: "General Dynamics / Lockheed Martin", variant: "C", flyable: true, usableForTraffic: true },
  a10: { icaoType: "A10", category: "military", manufacturer: "Fairchild Republic", variant: "C", flyable: true, usableForTraffic: true },
  su35: { icaoType: "SU35", category: "military", manufacturer: "Sukhoi", variant: "S", flyable: true, usableForTraffic: true },
  fa18: { icaoType: "F18", category: "military", manufacturer: "Boeing", variant: "E", flyable: true, usableForTraffic: true },
  c172: { icaoType: "C172", category: "general-aviation", manufacturer: "Cessna", variant: "Skyhawk", flyable: true, usableForTraffic: true },
  b737: { icaoType: "B738", category: "commercial", manufacturer: "Boeing", variant: "800", flyable: true, usableForTraffic: true },
};

const PROCEDURAL_LICENSE = {
  license: "Proprietário do simulador",
  author: "Geometria procedural do projeto",
  source: "src/sim/models.ts",
  attribution: "Construída por código Three.js neste projeto.",
};

function proceduralEntries(): RegistryEntry[] {
  return PROCEDURAL_SPECS.map((spec) => {
    const meta = PROCEDURAL_META[spec.id] ?? {
      icaoType: undefined,
      category: "experimental" as const,
      manufacturer: "Desconhecido",
      variant: "",
      flyable: true,
      usableForTraffic: true,
    };
    return {
      id: spec.id,
      name: spec.name,
      manufacturer: meta.manufacturer,
      model: spec.short,
      variant: meta.variant,
      icaoType: meta.icaoType,
      category: meta.category,
      origin: "procedural" as const,
      config: null,
      specId: spec.id,
      liveries: [],
      flyable: meta.flyable,
      usableForTraffic: meta.usableForTraffic,
      license: PROCEDURAL_LICENSE,
    };
  });
}

function glbEntries(): RegistryEntry[] {
  const mod = (glbManifests as { default?: unknown }).default ?? glbManifests;
  const arr = (Array.isArray(mod) ? mod : []) as unknown[];
  return arr
    .filter((x): x is AircraftConfiguration => Boolean(x && typeof (x as { id?: unknown }).id === "string"))
    .map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      manufacturer: cfg.manufacturer,
      model: cfg.model,
      variant: cfg.variant,
      icaoType: (cfg as { icaoType?: string }).icaoType,
      category: cfg.category,
      origin: "glb" as const,
      config: cfg,
      specId: null,
      liveries: cfg.liveries ?? [],
      flyable: false, // GLB são visuais; dinâmica de voo continua nos procedurais
      usableForTraffic: true,
      license: cfg.license,
    }));
}

let cache: RegistryEntry[] | null = null;

/** Catálogo completo (procedurais + GLB). Nunca lança. */
export function listAircraft(): RegistryEntry[] {
  if (cache) return cache;
  try {
    cache = [...proceduralEntries(), ...glbEntries()];
  } catch {
    cache = proceduralEntries();
  }
  return cache;
}

export function getAircraft(id: string): RegistryEntry | null {
  return listAircraft().find((a) => a.id === id) ?? null;
}

/** Entradas pilotáveis (hangar). */
export function listFlyable(): RegistryEntry[] {
  return listAircraft().filter((a) => a.flyable);
}

/** Entradas usáveis para tráfego ADS-B. */
export function listForTraffic(): RegistryEntry[] {
  return listAircraft().filter((a) => a.usableForTraffic);
}

/**
 * Diretório real no disco. Os ids GLB do Registry são prefixados ("glb-*") para
 * não colidir com as aeronaves procedurais; a pasta usa o nome original.
 */
const GLB_DIR: Record<string, string> = {
  "glb-c172": "c172",
  "glb-b789": "b789",
  "glb-jet": "jet",
  "glb-bell206": "bell206",
};

export function modelUrl(entry: RegistryEntry): string | null {
  if (entry.origin !== "glb" || !entry.config) return null;
  const dir = GLB_DIR[entry.id] ?? entry.id.replace(/^glb-/, "");
  return `/aircraft/${dir}/${entry.config.modelFile}`;
}

/**
 * Verifica (uma vez por sessão) se o GLB realmente existe no servidor,
 * para não repetir requisições a arquivos inexistentes.
 */
const availability = new Map<string, Promise<boolean>>();
export function checkAvailability(entry: RegistryEntry): Promise<boolean> {
  const url = modelUrl(entry);
  if (!url) return Promise.resolve(true); // procedural sempre disponível
  let p = availability.get(entry.id);
  if (!p) {
    p = fetch(url, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    availability.set(entry.id, p);
  }
  return p;
}

export function safeListAircraft(): RegistryEntry[] {
  try {
    return listAircraft();
  } catch {
    return [];
  }
}

/** Mantido para compatibilidade com código que esperava a config GLB. */
export function getGlbConfig(id: string): AircraftConfiguration | null {
  return getAircraft(id)?.config ?? null;
}

/** Spec procedural por id (para dinâmica de voo). */
export function proceduralSpec(id: string) {
  return proceduralById(id);
}
