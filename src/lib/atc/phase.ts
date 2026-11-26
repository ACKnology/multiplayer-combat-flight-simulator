// Classificação da fase de voo a partir dos dados ADS-B — pura e testável.
import type { AtcAircraft, FeedType, FlightPhase } from "./types";

export const PHASE_LABEL: Record<FlightPhase, string> = {
  taxi: "Táxi",
  takeoff: "Decolagem",
  climb: "Subida",
  cruise: "Cruzeiro",
  descent: "Descida",
  approach: "Aproximação",
  landing: "Pouso",
  enroute: "Em rota",
};

/**
 * Usa velocidade de solo, razão vertical e altura acima do campo (quando há
 * aeroporto próximo). Sem aeroporto no raio, classifica apenas pelo perfil vertical.
 */
export function classifyPhase(ac: AtcAircraft, airport?: { elevFt: number } | null): FlightPhase {
  const gs = ac.groundSpeedKts ?? 0;
  const vs = ac.verticalFpm ?? 0;
  const alt = ac.altitudeFt ?? 0;
  if (ac.onGround) return gs >= 50 ? "takeoff" : "taxi";
  if (!airport) {
    if (vs > 400) return "climb";
    if (vs < -400) return "descent";
    return "enroute";
  }
  const agl = alt - airport.elevFt;
  if (agl < 200 && vs < -50) return "landing";
  if (agl < 3000 && vs < -150) return "approach";
  if (agl < 1500 && vs > 200) return "takeoff";
  if (vs > 400 && alt < 18000) return "climb";
  if (vs < -400 && agl >= 3000) return "descent";
  if (agl < 3000) return "approach";
  return "cruise";
}

/** Tipos de feed preferidos por fase, em ordem (regra de produto). */
export function preferredFeedTypes(phase: FlightPhase): FeedType[] {
  switch (phase) {
    case "taxi": return ["ground", "tower"];
    case "takeoff": return ["tower", "departure"];
    case "climb": return ["departure", "tower", "center"];
    case "cruise":
    case "enroute": return ["center", "approach", "departure"];
    case "descent": return ["approach", "center"];
    case "approach": return ["approach", "tower"];
    case "landing": return ["tower", "ground"];
  }
}

/** Heurística de rota: subindo perto de um campo → origem; descendo → destino. */
export function inferRoute(
  phase: FlightPhase,
  airportIcao: string | undefined,
  explicit?: { origin?: string; destination?: string }
): { origin?: string; destination?: string } {
  const origin = explicit?.origin?.toUpperCase();
  const destination = explicit?.destination?.toUpperCase();
  if (!airportIcao) return { origin, destination };
  if (!origin && (phase === "takeoff" || phase === "climb" || phase === "taxi")) {
    return { origin: airportIcao, destination };
  }
  if (!destination && (phase === "approach" || phase === "landing" || phase === "descent")) {
    return { origin, destination: airportIcao };
  }
  return { origin, destination };
}