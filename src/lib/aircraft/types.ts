// Tipos do sistema universal de aeronaves (loader, configuração, controlador,
// discovery, inspector, registry e liveries).

// ---------- Identificação / Feature Discovery ----------
export type ComponentKind =
  | "aileronLeft"
  | "aileronRight"
  | "elevator"
  | "rudder"
  | "flapLeft"
  | "flapRight"
  | "spoiler"
  | "speedbrake"
  | "gearLeft"
  | "gearRight"
  | "gearNose"
  | "gearDoor"
  | "propeller"
  | "mainRotor"
  | "tailRotor"
  | "lightNav"
  | "lightBeacon"
  | "lightStrobe"
  | "lightLanding"
  | "door"
  | "reverser";

export type DiscoveryStatus = "confirmed" | "probable" | "ambiguous" | "unidentified";

export type ControlChannel =
  | "aileronLeft"
  | "aileronRight"
  | "elevator"
  | "rudder"
  | "flapL"
  | "flapR"
  | "spoiler"
  | "speedbrake"
  | "gear"
  | "gearLeft"
  | "gearRight"
  | "gearNose"
  | "gearDoor"
  | "propeller"
  | "prop"
  | "mainRotor"
  | "tailRotor"
  | "nav"
  | "beacon"
  | "strobe"
  | "landing"
  | "door"
  | "reverser";

export type TransformMode = "rotate" | "translate";

export interface ArticulationSpec {
  node: string; // nome do nó no GLB (ou vazio = pivô sintético)
  axis?: [number, number, number]; // eixo local da articulação
  pivot?: [number, number, number]; // posição do pivô (metros)
  minAngle?: number; // graus
  maxAngle?: number;
  reverse?: boolean;
  units?: "degrees" | "radians";
  mode?: TransformMode; // rotate (angular) ou translate (linear)
  distance?: number; // metros (para translate, ex.: trem de pouso)
  initial?: number; // valor inicial
  curve?: [[number, number], [number, number]] | null; // curva de resposta [0..1] → [out0..out1]
  confidence?: number;
  status?: DiscoveryStatus;
  channel?: ControlChannel;
  animation?: string | null; // nome do AnimationClip associado
  actuator?: "mixer" | "controller" | "hybrid";
}

export interface FeatureManifest {
  aircraftId: string;
  features: Partial<Record<ControlChannel, boolean>>;
  notes?: string;
}

// ---------- Configuração de aeronave ----------
export interface AircraftComponentMap {
  /** chave = canal de comando; valor = a articulação do nó correspondente */
  [channel: string]: ArticulationSpec | ArticulationSpec[] | undefined;
  aileronLeft?: ArticulationSpec;
  aileronRight?: ArticulationSpec;
  elevator?: ArticulationSpec;
  rudder?: ArticulationSpec;
  flapL?: ArticulationSpec;
  flapR?: ArticulationSpec;
  spoiler?: ArticulationSpec | ArticulationSpec[];
  speedbrake?: ArticulationSpec;
  gear?: ArticulationSpec | ArticulationSpec[];
  gearLeft?: ArticulationSpec;
  gearRight?: ArticulationSpec;
  gearNose?: ArticulationSpec;
  gearDoor?: ArticulationSpec | ArticulationSpec[];
  propeller?: ArticulationSpec | ArticulationSpec[];
  mainRotor?: ArticulationSpec | ArticulationSpec[];
  tailRotor?: ArticulationSpec | ArticulationSpec[];
  lightNav?: ArticulationSpec | ArticulationSpec[];
  lightBeacon?: ArticulationSpec | ArticulationSpec[];
  lightStrobe?: ArticulationSpec | ArticulationSpec[];
  lightLanding?: ArticulationSpec | ArticulationSpec[];
  door?: ArticulationSpec | ArticulationSpec[];
  reverser?: ArticulationSpec | ArticulationSpec[];
}

export interface AircraftLicense {
  license: string;
  author: string;
  source: string;
  attribution: string;
}

export interface AircraftConfiguration {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  variant: string;
  category: "general-aviation" | "commercial" | "military" | "helicopter";
  /** caminho do GLB (relativo a /public/aircraft/<id>/) */
  modelFile: string;
  units: { length: "meters"; angles: "degrees" };
  /** escala adicional aplicada ao modelo */
  scale?: number;
  /** yaw do modelo para apontar o nariz para -Z (rad) */
  rotateY?: number;
  components: AircraftComponentMap;
  liveries?: string[]; // ids de pinturas
  license: AircraftLicense;
  thumbnail?: string;
  thumbnailAttribution?: string;
  manifest: FeatureManifest;
}

// ---------- Liveries ----------
export interface LiveryConfig {
  id: string;
  aircraftId: string;
  name: string;
  airline?: string;
  registration?: string;
  country?: string;
  description?: string;
  textures?: Record<string, string>; // materialName → caminho da textura
  materials?: Record<string, { color?: string; metalness?: number; roughness?: number }>; // material/propriedades
  /** decalques: planar map sobre o modelo, na frame do modelo (x, y, z, largura, altura, yaw°) */
  decals?: { text?: string; texture?: string; position: [number, number, number]; size: [number, number]; yaw?: number; pitch?: number }[];
  origin?: string;
  license?: string;
}

// ---------- Inspeção ----------
export interface InspectionNode {
  name: string;
  id: string;
  children: InspectionNode[];
  worldPos: [number, number, number];
  mesh: boolean;
  triangles?: number;
  materialName?: string;
}

export interface InspectionResult {
  nodes: InspectionNode[];
  clips: { name: string; duration: number; tracks: string[] }[];
  components: { channel: ControlChannel; node: string | null; confidence: number; status: DiscoveryStatus; source: string; axis: [number, number, number]; pivot: [number, number, number] }[];
}

// ---------- Catalog ----------
export interface AircraftRegistryEntry {
  configuration: AircraftConfiguration;
  baseDir: string;
}
