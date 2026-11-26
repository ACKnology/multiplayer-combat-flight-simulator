/**
 * AircraftIdentityResolver — resolve um registro ADS-B em uma entrada do
 * Aircraft Registry (geometria + livery), com níveis de confiança.
 *
 * Ordem de prioridade (conforme especificação):
 *   1. tipo ICAO (`t`)  → geometria  (referência principal)
 *   2. matrícula (`r`)  → aeronave específica e sua pintura
 *   3. callsign         → operador/companhia → livery (nunca geometria)
 *
 * O callsign NUNCA define a geometria sozinho.
 */
import type { AircraftConfiguration } from "./types";

/** Base configurável de operadores por prefixo de callsign (3 primeiros caracteres). */
export interface OperatorEntry {
  /** prefixo do callsign, ex.: "GLO" */
  prefix: string;
  /** nome do operador */
  name: string;
  /** id de livery preferida quando disponível */
  liveryId?: string;
}

export const OPERATORS: OperatorEntry[] = [
  { prefix: "GLO", name: "Gol Linhas Aéreas", liveryId: "gol" },
  { prefix: "TAM", name: "LATAM Brasil", liveryId: "latam" },
  { prefix: "LAN", name: "LATAM Airlines", liveryId: "latam" },
  { prefix: "AZU", name: "Azul Linhas Aéreas", liveryId: "azul" },
  { prefix: "UAL", name: "United Airlines", liveryId: "united" },
  { prefix: "AAL", name: "American Airlines", liveryId: "american" },
  { prefix: "DAL", name: "Delta Air Lines", liveryId: "delta" },
  { prefix: "BAW", name: "British Airways", liveryId: "british" },
  { prefix: "AFR", name: "Air France", liveryId: "airfrance" },
  { prefix: "KLM", name: "KLM", liveryId: "klm" },
  { prefix: "IBE", name: "Iberia", liveryId: "iberia" },
  { prefix: "TAP", name: "TAP Air Portugal", liveryId: "tap" },
  { prefix: "THY", name: "Turkish Airlines", liveryId: "turkish" },
  { prefix: "QTR", name: "Qatar Airways", liveryId: "qatar" },
  { prefix: "UAE", name: "Emirates", liveryId: "emirates" },
  { prefix: "RYR", name: "Ryanair", liveryId: "ryanair" },
  { prefix: "EZY", name: "easyJet", liveryId: "easyjet" },
  { prefix: "SWA", name: "Southwest Airlines", liveryId: "southwest" },
  { prefix: "JBU", name: "JetBlue", liveryId: "jetblue" },
  { prefix: "ACA", name: "Air Canada", liveryId: "aircanada" },
  { prefix: "AVA", name: "Avianca", liveryId: "avianca" },
  { prefix: "ARG", name: "Aerolíneas Argentinas", liveryId: "aerolineas" },
  { prefix: "CMP", name: "Copa Airlines", liveryId: "copa" },
  { prefix: "FAB", name: "Força Aérea Brasileira" },
  { prefix: "BAW", name: "British Airways" },
  { prefix: "FDX", name: "FedEx Express" },
  { prefix: "UPS", name: "UPS Airlines" },
  { prefix: "PT", name: "Aviação geral (Brasil)" },
];

/** Mapeia tipo ICAO → geometria do Registry. Configurável, sem tocar no código central. */
export interface IcaoTypeMapping {
  /** tipo ICAO (ex.: "B738") */
  type: string;
  /** id da entrada do Registry */
  aircraftId: string;
  /** spec procedural equivalente (fallback quando o GLB não existe) */
  proceduralSpec: string;
  /** escala aplicada à geometria procedural */
  scale?: number;
}

/**
 * Tabela ICAO → Registry. Aeronaves procedurais existentes são usadas como
 * representação aproximada até existirem GLB específicos.
 */
export const ICAO_TYPE_MAP: IcaoTypeMapping[] = [
  // Airbus narrow-body → representado pelo 737 procedural (comercial similar)
  { type: "A20N", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  { type: "A21N", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.05 },
  { type: "A319", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.95 },
  { type: "A320", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  { type: "A321", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.05 },
  // Boeing narrow-body
  { type: "B38M", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  { type: "B737", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  { type: "B738", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  { type: "B739", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.02 },
  { type: "B73P", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1 },
  // wide-body → 737 ampliado (aproximação visual)
  { type: "B744", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.4 },
  { type: "B77W", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.35 },
  { type: "B788", aircraftId: "glb-b789", proceduralSpec: "b737", scale: 1.3 },
  { type: "B789", aircraftId: "glb-b789", proceduralSpec: "b737", scale: 1.3 },
  { type: "A332", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.3 },
  { type: "A339", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.3 },
  { type: "A359", aircraftId: "glb-b789", proceduralSpec: "b737", scale: 1.35 },
  { type: "A35K", aircraftId: "glb-b789", proceduralSpec: "b737", scale: 1.4 },
  { type: "A388", aircraftId: "glb-b789", proceduralSpec: "b737", scale: 1.6 },
  { type: "E190", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.85 },
  { type: "E195", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.88 },
  { type: "E295", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.9 },
  { type: "AT72", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.85 },
  { type: "AT76", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.85 },
  { type: "DH8D", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 0.8 },
  // aviação geral
  { type: "C172", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1 },
  { type: "C182", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.02 },
  { type: "C208", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.1 },
  { type: "P28A", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 0.95 },
  { type: "SR22", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 0.95 },
  { type: "BE20", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.15 },
  { type: "C25A", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.1 },
  { type: "C25B", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.1 },
  { type: "C56X", aircraftId: "glb-c172", proceduralSpec: "c172", scale: 1.12 },
  // executivas
  { type: "GLF5", aircraftId: "glb-jet", proceduralSpec: "c172", scale: 1.15 },
  { type: "GLF6", aircraftId: "glb-jet", proceduralSpec: "c172", scale: 1.15 },
  { type: "LJ45", aircraftId: "glb-jet", proceduralSpec: "c172", scale: 1.0 },
  { type: "E55P", aircraftId: "glb-jet", proceduralSpec: "c172", scale: 1.0 },
  // militares
  { type: "F16", aircraftId: "glb-jet", proceduralSpec: "f16", scale: 1 },
  { type: "F16C", aircraftId: "glb-jet", proceduralSpec: "f16", scale: 1 },
  { type: "F18", aircraftId: "glb-jet", proceduralSpec: "fa18", scale: 1 },
  { type: "FA18", aircraftId: "glb-jet", proceduralSpec: "fa18", scale: 1 },
  { type: "A10", aircraftId: "glb-jet", proceduralSpec: "a10", scale: 1 },
  { type: "SU27", aircraftId: "glb-jet", proceduralSpec: "su35", scale: 1 },
  { type: "SU35", aircraftId: "glb-jet", proceduralSpec: "su35", scale: 1 },
  { type: "C130", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.15 },
  { type: "C17", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.35 },
  { type: "KC35", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.35 },
  { type: "A400", aircraftId: "glb-b737", proceduralSpec: "b737", scale: 1.25 },
  { type: "MQ9", aircraftId: "glb-jet", proceduralSpec: "f16", scale: 0.9 },
  // helicópteros
  { type: "H60", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1.2 },
  { type: "B06", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1 },
  { type: "B407", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1 },
  { type: "B412", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1.1 },
  { type: "AS50", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 0.95 },
  { type: "AS55", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 0.95 },
  { type: "R22", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 0.7 },
  { type: "R44", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 0.8 },
  { type: "EC35", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1.05 },
  { type: "A139", aircraftId: "glb-bell206", proceduralSpec: "c172", scale: 1.15 },
];

export type IdentityConfidence = "high" | "medium" | "low";

export interface ResolvedIdentity {
  /** geometria do Registry (null = usar procedural) */
  aircraftId: string | null;
  /** spec procedural equivalente (sempre presente para fallback) */
  proceduralSpec: string;
  scale: number;
  /** livery resolvida, se houver */
  liveryId: string | null;
  operator: string | null;
  confidence: IdentityConfidence;
  /** motivo da resolução, para diagnóstico */
  reason: string;
}

const norm = (s: string) => s.trim().toUpperCase();
const byType = new Map(ICAO_TYPE_MAP.map((m) => [m.type, m]));
const byPrefix = new Map(OPERATORS.map((o) => [o.prefix, o]));

/** cache de resolução por (hex) — evita recomputar a cada atualização ADS-B */
const hexCache = new Map<string, ResolvedIdentity>();

export interface AdsbIdentityInput {
  hex?: string;
  type?: string;
  registration?: string;
  callsign?: string;
  category?: string;
  groundSpeedKts?: number;
}

/**
 * Resolve identidade ADS-B. Nunca lança; sempre devolve algo renderizável.
 */
export function resolveAdsbIdentity(input: AdsbIdentityInput): ResolvedIdentity {
  const key = input.hex ? norm(input.hex) : `${norm(input.callsign ?? "")}|${norm(input.type ?? "")}`;
  const cached = hexCache.get(key);
  if (cached) return cached;

  const t = norm(input.type ?? "");
  const cs = norm(input.callsign ?? "");
  const reg = norm(input.registration ?? "");

  // 1) tipo ICAO é a referência principal para a geometria
  const mapping = t ? byType.get(t) : undefined;

  // 2) operador pelo prefixo do callsign (não define geometria!)
  const prefix3 = cs.slice(0, 3);
  const operator = byPrefix.get(prefix3) ?? (cs.length > 3 ? byPrefix.get(cs.slice(0, 2)) : undefined);

  let result: ResolvedIdentity;

  if (mapping) {
    // geometria conhecida pelo tipo ICAO → confiança alta na geometria
    let confidence: IdentityConfidence = "high";
    let liveryId: string | null = null;

    if (operator?.liveryId) {
      liveryId = operator.liveryId;
      confidence = "high";
    } else if (operator) {
      confidence = "medium";
    } else if (reg) {
      // matrícula presente mas sem operador identificado
      confidence = "medium";
    } else {
      confidence = t ? "medium" : "low";
    }

    result = {
      aircraftId: mapping.aircraftId,
      proceduralSpec: mapping.proceduralSpec,
      scale: mapping.scale ?? 1,
      liveryId,
      operator: operator?.name ?? null,
      confidence,
      reason: `tipo ICAO ${t || "ausente"}${operator ? ` · operador ${operator.name} por callsign` : ""}`,
    };
  } else {
    // tipo desconhecido → heurística leve por categoria/velocidade, confiança baixa
    let spec = "b737";
    let scale = 1;
    if (input.category === "A7") {
      spec = "c172"; // proxy de helicóptero
      scale = 1;
    } else if (typeof input.groundSpeedKts === "number" && input.groundSpeedKts < 170) {
      spec = "c172";
    }
    result = {
      aircraftId: null,
      proceduralSpec: spec,
      scale,
      liveryId: null,
      operator: operator?.name ?? null,
      confidence: "low",
      reason: `tipo ICAO "${t || "ausente"}" não mapeado${operator ? ` · operador ${operator.name} identificado` : ""} — usando aproximação`,
    };
  }

  if (hexCache.size > 2000) hexCache.clear();
  hexCache.set(key, result);
  return result;
}

export function clearIdentityCache() {
  hexCache.clear();
}

/** Lista de liveries efetivamente disponíveis para uma aeronave (não inventa). */
export function availableLiveries(config: AircraftConfiguration): string[] {
  return config.liveries ?? [];
}
