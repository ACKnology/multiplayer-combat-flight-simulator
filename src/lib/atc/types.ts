// Tipos compartilhados do subsystema "ATC ao vivo" (cliente + servidor + testes).

export type FeedType = "ground" | "tower" | "approach" | "departure" | "center" | "atis" | "other";

export interface AtcAirport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevFt: number;
}

export interface AtcFeed {
  id: string;
  name: string;
  airportIcao?: string;
  frequency?: string;
  type: FeedType;
  /** URL utilizável pelo player (proxy same-origin; credenciais ficam no servidor) */
  streamUrl: string;
  latitude?: number;
  longitude?: number;
  listeners?: number;
  status?: string;
  description?: string;
}

export type FlightPhase =
  | "taxi" | "takeoff" | "climb" | "cruise" | "descent" | "approach" | "landing" | "enroute";

/** Aeronave ADS-B no contrato mínimo pedido pela especificação do serviço. */
export interface AtcAircraft {
  callsign: string;
  icao24?: string;
  latitude: number;
  longitude: number;
  altitudeFt?: number;
  groundSpeedKts?: number;
  heading?: number;
  verticalFpm?: number;
  onGround?: boolean;
  origin?: string;
  destination?: string;
}

export interface AtcConfig {
  radiusNm: number;
  cacheTtlHours: number;
  maxReconnect: number;
  liveVolume: number;
  simVolume: number;
  /** false quando BROADCASTIFY_API_KEY não está configurada no servidor */
  providerConfigured: boolean;
}

export interface NearestResult {
  airport: AtcAirport;
  distanceNm: number;
}

export interface FeedsResult {
  icao: string;
  feeds: AtcFeed[];
  /** motivo quando a lista vem vazia */
  reason?: "no-api-key" | "no-feeds" | "upstream-error" | "unknown-airport";
  message?: string;
  cachedAt?: number;
  source: string;
  config: AtcConfig;
}