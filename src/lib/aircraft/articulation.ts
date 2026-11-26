/**
 * Mecanismo CANÔNICO de articulações visuais (PRD 02).
 *
 * Usado tanto pelo LABORATÓRIO do Inspector quanto pela camada visual da simulação
 * (`visual.ts` → `buildGlbVisual`), garantindo que não existam duas implementações
 * incompatíveis. Não implementa física: apenas converte estados/comandos
 * normalizados ( vindos do motor de voo ou dos controles do laboratório ) em
 * rotações/translações de nós do modelo.
 *
 * Características:
 *  - grupo-pivô intermediário (`attach`) sem alterar a geometria original;
 *  - eixo arbitrário, neutro/min/máx em graus, inversão, ganho e slew;
 *  - um comando → múltiplos objetos; objetos independentes por articulação;
 *  - restauração completa da hierarquia no dispose;
 *  - serialize/deserialize para config de sessão e exportação.
 */
import * as THREE from "three";

export type LabChannel =
  | "aileron" | "elevator" | "rudder" | "flaps" | "spoiler" | "gear"
  | "throttle" | "afterburner" | "propeller" | "reverser"
  | "canopy" | "doors" | "brake" | "custom";

/** Estado normalizado que o motor de voo / laboratório envia. Todos 0..1 salvo aileron/elevator/rudder (-1..1). */
export interface ArticulationState {
  aileron?: number;
  elevator?: number;
  rudder?: number;
  flaps?: number;
  spoiler?: number;
  gear?: number; // 1 = baixado
  throttle?: number;
  afterburner?: number;
  propeller?: number; // rotação acumulada em radianos
  reverser?: number;
  canopy?: number;
  doors?: number;
  brake?: number;
}

export interface ArticulationDef {
  id: string;
  label: string;
  channel: LabChannel;
  /** uuid do nó (preferido) ou nome (fallback) */
  object: string;
  objectName: string;
  axis: [number, number, number];
  reverse: boolean;
  neutral: number; // graus
  min: number;
  max: number;
  slew: number; // 1/s (0 = instantâneo)
  gain: number; // multiplicador do comando
  /** translação linear (trem) em vez de rotação */
  translate?: { vector: [number, number, number]; distance: number };
  /** pivô manual em coordenadas locais do pai; null = usa o próprio nó */
  pivot: [number, number, number] | null;
  /** cria grupo-pivô automaticamente na base geométrica do nó */
  autoPivot: boolean;
  enabled: boolean;
  /** valor manual -1..1 (modo laboratório) */
  manual: number | null;
  confidence?: number;
  source?: "alias" | "manual" | "preset";
}

/** Estado bruto do motor de voo (mesma forma de `AircraftState` do controller). */
export interface FlightVisualState {
  rollIn: number; pitchIn: number; yawIn: number;
  flaps: number; spoilerPos: number; gearPos: number; gearDown: boolean;
  eng: number; propAngle?: number; mainRotorAngle?: number; tailRotorAngle?: number;
  reverser?: number; door?: number;
}

/** Conversão ÚNICA dos estados físicos do simulador → canais de articulação visual.
 *  Usada pelo laboratório E pela camada visual da simulação (sem duas implementações). */
export function toArticulationState(s: FlightVisualState, dt = 0): ArticulationState {
  return {
    aileron: s.rollIn,
    elevator: s.pitchIn,
    rudder: s.yawIn,
    flaps: s.flaps,
    spoiler: s.spoilerPos,
    gear: s.gearPos,
    throttle: s.eng,
    afterburner: s.eng > 0.9 ? 1 : 0,
    propeller: s.propAngle ?? s.mainRotorAngle ?? s.eng * Math.max(dt, 0) * 20,
    reverser: s.reverser ?? 0,
    canopy: s.door ?? 0,
    doors: s.door ?? 0,
    brake: s.spoilerPos,
  };
}

export interface LabConfig {
  version: 1;
  aircraftId: string;
  name: string;
  preset: "none" | "fighter" | "airliner" | "propeller";
  articulations: ArticulationDef[];
  clip: { idx: number; speed: number; loop: boolean };
  updatedAt: number;
}

/** Catálogo de componentes aeronáuticos suportados (todos opcionais). */
export const LAB_GROUPS: {
  key: string; label: string; channel: LabChannel; aliases: RegExp; axis: [number, number, number];
  min: number; max: number; gain: number; group: string;
}[] = [
  { key: "aileronLeft", label: "Aileron esquerdo", channel: "aileron", aliases: /^(aileron[_\-.]?l(eft)?|l(eft)[_\-.]?aileron|ail[_\-.]?l|esq[_\-.]?aileron)$/i, axis: [1, 0, 0], min: -20, max: 20, gain: 20, group: "Superfícies" },
  { key: "aileronRight", label: "Aileron direito", channel: "aileron", aliases: /^(aileron[_\-.]?r(ight)?|r(ight)[_\-.]?aileron|ail[_\-.]?r|dir[_\-.]?aileron)$/i, axis: [1, 0, 0], min: -20, max: 20, gain: 20, group: "Superfícies" },
  { key: "elevatorLeft", label: "Profundor esquerdo", channel: "elevator", aliases: /^(elevator[_\-.]?l(eft)?|elev[_\-.]?l|l(eft)[_\-.]?elevator)$/i, axis: [1, 0, 0], min: -25, max: 25, gain: 25, group: "Superfícies" },
  { key: "elevatorRight", label: "Profundor direito", channel: "elevator", aliases: /^(elevator[_\-.]?r(ight)?|elev[_\-.]?r|r(ight)[_\-.]?elevator)$/i, axis: [1, 0, 0], min: -25, max: 25, gain: 25, group: "Superfícies" },
  { key: "elevator", label: "Profundor", channel: "elevator", aliases: /^(elevator|elev|profundor|horizontal[_\-.]?stab[_\-.]?elev)$/i, axis: [1, 0, 0], min: -25, max: 25, gain: 25, group: "Superfícies" },
  { key: "rudder", label: "Leme", channel: "rudder", aliases: /^(rudder|leme|vertical[_\-.]?rudder|fin[_\-.]?rudder|rud)$/i, axis: [0, 1, 0], min: -25, max: 25, gain: 25, group: "Superfícies" },
  { key: "flapLeft", label: "Flap esquerdo", channel: "flaps", aliases: /^(flap[_\-.]?l(eft)?|l(eft)[_\-.]?flap|flaps?[_\-.]?l)$/i, axis: [1, 0, 0], min: 0, max: -35, gain: 35, group: "Superfícies" },
  { key: "flapRight", label: "Flap direito", channel: "flaps", aliases: /^(flap[_\-.]?r(ight)?|r(ight)[_\-.]?flap|flaps?[_\-.]?r)$/i, axis: [1, 0, 0], min: 0, max: -35, gain: 35, group: "Superfícies" },
  { key: "flap", label: "Flaps", channel: "flaps", aliases: /^(flaps?|flap[_\-.]?surface)$/i, axis: [1, 0, 0], min: 0, max: -35, gain: 35, group: "Superfícies" },
  { key: "spoilerLeft", label: "Spoiler esquerdo", channel: "spoiler", aliases: /^(spoiler[_\-.]?l(eft)?|speed[_\-.]?brake[_\-.]?l|airbrake[_\-.]?l|l(eft)[_\-.]?spoiler)$/i, axis: [1, 0, 0], min: 0, max: 55, gain: 55, group: "Superfícies / freios" },
  { key: "spoilerRight", label: "Spoiler direito", channel: "spoiler", aliases: /^(spoiler[_\-.]?r(ight)?|speed[_\-.]?brake[_\-.]?r|airbrake[_\-.]?r|r(ight)[_\-.]?spoiler)$/i, axis: [1, 0, 0], min: 0, max: 55, gain: 55, group: "Superfícies / freios" },
  { key: "spoiler", label: "Spoilers / freio aerodinâmico", channel: "spoiler", aliases: /^(spoilers?|speed[_\-.]?brakes?|airbrakes?)$/i, axis: [1, 0, 0], min: 0, max: 55, gain: 55, group: "Superfícies / freios" },
  { key: "gearNose", label: "Trem dianteiro", channel: "gear", aliases: /^(nose[_\-.]?gear|gear[_\-.]?nose|front[_\-.]?gear|bequilha)$/i, axis: [1, 0, 0], min: 0, max: 90, gain: 90, group: "Trem de pouso" },
  { key: "gearLeft", label: "Trem principal esquerdo", channel: "gear", aliases: /^(main[_\-.]?gear[_\-.]?l(eft)?|gear[_\-.]?l|l(eft)[_\-.]?gear)$/i, axis: [1, 0, 0], min: 0, max: 90, gain: 90, group: "Trem de pouso" },
  { key: "gearRight", label: "Trem principal direito", channel: "gear", aliases: /^(main[_\-.]?gear[_\-.]?r(ight)?|gear[_\-.]?r|r(ight)[_\-.]?gear)$/i, axis: [1, 0, 0], min: 0, max: 90, gain: 90, group: "Trem de pouso" },
  { key: "gear", label: "Trem de pouso", channel: "gear", aliases: /^(gear|landing[_\-.]?gear|trem)$/i, axis: [1, 0, 0], min: 0, max: 90, gain: 90, group: "Trem de pouso" },
  { key: "gearDoor", label: "Portas do trem", channel: "gear", aliases: /^(gear[_\-.]?doors?|doors?[_\-.]?gear|gear[_\-.]?bay)$/i, axis: [1, 0, 0], min: 0, max: 75, gain: 75, group: "Trem de pouso" },
  { key: "wheel", label: "Rodas", channel: "custom", aliases: /^(wheels?|rodas?|tire|tyre)$/i, axis: [0, 0, 1], min: 0, max: 360, gain: 360, group: "Trem de pouso" },
  { key: "strut", label: "Amortecedores", channel: "custom", aliases: /^(struts?|amort[_\-.]?ecedores?|oleo|shock)$/i, axis: [0, 1, 0], min: 0, max: 10, gain: 10, group: "Trem de pouso" },
  { key: "propeller", label: "Hélice", channel: "propeller", aliases: /^(prop(eller)?|helice|prop[_\-.]?blade|helix)$/i, axis: [0, 0, 1], min: 0, max: 360, gain: 1, group: "Motor" },
  { key: "fan", label: "Fan / compressor", channel: "propeller", aliases: /^(fan|compressor|n1|turbina)$/i, axis: [0, 0, 1], min: 0, max: 360, gain: 1, group: "Motor" },
  { key: "exhaust", label: "Escapamento", channel: "throttle", aliases: /^(exhaust|escapamento|nozzle|bocal)$/i, axis: [1, 0, 0], min: 0, max: 15, gain: 15, group: "Motor" },
  { key: "afterburner", label: "Pós-combustão", channel: "afterburner", aliases: /^(afterburner|ab|pos[_\-.]?combustao|reheat|chama)$/i, axis: [1, 0, 0], min: 0, max: 100, gain: 100, group: "Motor" },
  { key: "smoke", label: "Emissores de fumaça", channel: "throttle", aliases: /^(smoke|fumaca|smoke[_\-.]?emitter|exhaust[_\-.]?smoke)$/i, axis: [1, 0, 0], min: 0, max: 100, gain: 100, group: "Motor" },
  { key: "canopy", label: "Canopy", channel: "canopy", aliases: /^(canopy|cupula|cobertura|cockpit[_\-.]?glass)$/i, axis: [1, 0, 0], min: 0, max: 65, gain: 65, group: "Outros" },
  { key: "door", label: "Portas / compartimentos", channel: "doors", aliases: /^(doors?|hatch|compartimento|bay|escotilha|weapon[_\-.]?bay)$/i, axis: [0, 1, 0], min: 0, max: 90, gain: 90, group: "Outros" },
  { key: "brake", label: "Freio aerodinâmico", channel: "brake", aliases: /^(brakes?|freio|airbrake|speedbrake)$/i, axis: [1, 0, 0], min: 0, max: 45, gain: 45, group: "Outros" },
  { key: "reverser", label: "Reversores", channel: "reverser", aliases: /^(reverser|reverse[_\-.]?thrust|reverso)$/i, axis: [1, 0, 0], min: 0, max: 60, gain: 60, group: "Outros" },
];

export const STATE_CHANNELS: LabChannel[] = [
  "aileron", "elevator", "rudder", "flaps", "spoiler", "gear", "throttle", "afterburner", "propeller", "reverser", "canopy", "doors", "brake", "custom",
];

const clamp = THREE.MathUtils.clamp;

let uid = 0;
const nextId = () => `art-${++uid}`;

function defFromGroup(
  g: (typeof LAB_GROUPS)[number],
  obj: THREE.Object3D,
  source: ArticulationDef["source"],
  confidence: number
): ArticulationDef {
  // ailerons/flaps/spoilers/gear em lados opostos: sentido invertido por padrão no lado direito
  const rightSide = /(Right|_R$|r$)/i.test(g.key);
  return {
    id: nextId(), label: g.label, channel: g.channel,
    object: obj.uuid, objectName: obj.name || "(sem nome)",
    axis: [...g.axis] as [number, number, number],
    reverse: rightSide && ["aileron", "spoiler"].includes(g.channel),
    neutral: 0, min: g.min, max: g.max, gain: g.gain, slew: 8,
    pivot: null, autoPivot: source !== "manual", enabled: true, manual: null,
    confidence, source,
  };
}

const canon = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

/** Descoberta automática de articulações por nome de nó (confiança informada). */
export function suggestArticulations(root: THREE.Object3D): ArticulationDef[] {
  const out: ArticulationDef[] = [];
  const used = new Set<string>();
  root.traverse((o) => {
    if (!o.name) return;
    for (const g of LAB_GROUPS) {
      if (used.has(o.uuid)) break;
      const nm = canon(o.name);
      const exact = g.aliases.test(o.name) || g.aliases.test(nm);
      const loose = !exact && nm.length >= 4 && canon(g.key).startsWith(nm);
      if (!exact && !loose) continue;
      out.push(defFromGroup(g, o, "alias", exact ? 0.95 : 0.55));

      used.add(o.uuid);
      break;
    }
  });
  return out;
}

/** Presets iniciais — nunca impositivos: geram defs só para os nós encontrados. */
export const PRESETS: Record<"fighter" | "airliner" | "propeller", string[]> = {
  fighter: ["aileronLeft", "aileronRight", "elevatorLeft", "elevatorRight", "rudder", "flapLeft", "flapRight", "spoiler", "gearNose", "gearLeft", "gearRight", "gearDoor", "afterburner", "canopy"],
  airliner: ["aileronLeft", "aileronRight", "elevatorLeft", "elevatorRight", "rudder", "flapLeft", "flapRight", "spoiler", "gearNose", "gearLeft", "gearRight", "gearDoor", "reverser", "fan"],
  propeller: ["aileronLeft", "aileronRight", "elevator", "rudder", "flapLeft", "flapRight", "gear", "gearNose", "propeller", "door", "canopy"],
};

export function presetArticulations(root: THREE.Object3D, preset: "fighter" | "airliner" | "propeller"): ArticulationDef[] {
  const keys = PRESETS[preset];
  const out: ArticulationDef[] = [];
  const byKey = new Map(LAB_GROUPS.map((g) => [g.key, g]));
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  for (const k of keys) {
    const g = byKey.get(k);
    if (!g) continue;
    // correspondência por chave ("Aileron_L" etc.), senão deixa espaço em branco (manual)
    const rx = new RegExp(g.aliases.source.replace(/^\^|\$$/g, ""), "i");
    const obj = nodes.find((o) => o.name && (g.aliases.test(o.name) || rx.test(o.name)));
    if (obj) out.push(defFromGroup(g, obj, "preset", 0.8));
    else {
      out.push({
        ...defFromGroup(g, root, "preset", 0),
        object: "", objectName: "(selecione o objeto)", enabled: false, confidence: 0,
      });
    }
  }
  return out;
}

function stateValue(ch: LabChannel, s: ArticulationState): number {
  const v = (s as Record<string, number | undefined>)[ch] ?? 0;
  return v;
}

interface Bound {
  def: ArticulationDef;
  node: THREE.Object3D;
  pivotGroup: THREE.Group | null;
  origParent: THREE.Object3D | null;
  origQuat: THREE.Quaternion;
  origPos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
  q: THREE.Quaternion;
  value: number; // -1..1 current
}

/**
 * Motor de articulações. Construído sobre a árvore carregada; `dispose()` restaura
 * pais/quaternions/posições — nenhuma alteração destrutiva na geometria.
 */
export class ArticulationEngine {
  root: THREE.Object3D;
  defs: ArticulationDef[] = [];
  private bounds = new Map<string, Bound>();
  private pivotMarkers: THREE.Object3D[] = [];
  private seq: { channels: LabChannel[]; t: number; dur: number; combo: boolean } | null = null;

  constructor(root: THREE.Object3D) {
    this.root = root;
  }

  setDefs(defs: ArticulationDef[]) {
    this.unbindAll();
    this.defs = defs.map((d) => ({ ...d, axis: [...d.axis] as [number, number, number] }));
    this.rebind();
  }

  private rebind() {
    for (const d of this.defs) {
      if (!d.enabled || !d.object) continue;
      const node = this.root.getObjectByProperty("uuid", d.object) ?? this.root.getObjectByName(d.objectName);
      if (!node) continue;
      let pivotGroup: THREE.Group | null = null;
      let target = node;
      const origParent = node.parent;
      const origQuat = node.quaternion.clone();
      const origPos = node.position.clone();
      if (d.pivot || d.autoPivot) {
        const parent = node.parent ?? this.root;
        parent.updateWorldMatrix(true, false);
        const wrap = new THREE.Group();
        wrap.name = `__lab_pivot_${d.objectName}`;
        if (d.pivot) wrap.position.set(...d.pivot);
        else {
          const b = new THREE.Box3().setFromObject(node);
          const c = b.getCenter(new THREE.Vector3());
          parent.worldToLocal(c);
          wrap.position.copy(c);
        }
        parent.add(wrap);
        wrap.updateWorldMatrix(true, false);
        wrap.attach(node); // preserva transformação mundial
        pivotGroup = wrap;
        target = wrap;
      }
      const baseQuat = target.quaternion.clone();
      const basePos = target.position.clone();
      this.bounds.set(d.id, {
        def: d, node: target, pivotGroup, origParent, origQuat, origPos,
        baseQuat, basePos, q: new THREE.Quaternion(), value: 0,
      });
    }
  }

  /** atualiza uma def sem reconstruir tudo (slider em tempo real) */
  patch(id: string, patch: Partial<ArticulationDef>) {
    const d = this.defs.find((x) => x.id === id);
    if (!d) return;
    const structural =
      (patch.object !== undefined && patch.object !== d.object) ||
      (patch.objectName !== undefined && patch.objectName !== d.objectName) ||
      (patch.pivot !== undefined && JSON.stringify(patch.pivot) !== JSON.stringify(d.pivot)) ||
      (patch.autoPivot !== undefined && patch.autoPivot !== d.autoPivot) ||
      (patch.enabled !== undefined && patch.enabled !== d.enabled);
    const prevManual = d.manual;
    Object.assign(d, patch);
    d.manual = patch.manual !== undefined ? patch.manual : prevManual;
    if (structural) {
      this.unbind(id);
      this.rebindOne(d);
    }
  }

  private rebindOne(d: ArticulationDef) {
    const node = this.root.getObjectByProperty("uuid", d.object) ?? this.root.getObjectByName(d.objectName);
    if (!node || !d.enabled || !d.object) return;
    let pivotGroup: THREE.Group | null = null;
    let target: THREE.Object3D = node;
    const origParent = node.parent;
    const origQuat = node.quaternion.clone();
    const origPos = node.position.clone();
    if (d.pivot || d.autoPivot) {
      const parent = node.parent ?? this.root;
      parent.updateWorldMatrix(true, false);
      const wrap = new THREE.Group();
      wrap.name = `__lab_pivot_${d.objectName}`;
      if (d.pivot) wrap.position.set(...d.pivot);
      else {
        const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
        parent.worldToLocal(c);
        wrap.position.copy(c);
      }
      parent.add(wrap);
      wrap.updateWorldMatrix(true, false);
      wrap.attach(node);
      pivotGroup = wrap;
      target = wrap;
    }
    this.bounds.set(d.id, {
      def: d, node: target, pivotGroup, origParent, origQuat, origPos,
      baseQuat: target.quaternion.clone(), basePos: target.position.clone(),
      q: new THREE.Quaternion(), value: 0,
    });
  }

  private unbind(id: string) {
    const b = this.bounds.get(id);
    if (!b) return;
    if (b.pivotGroup && b.origParent) {
      const child = b.pivotGroup.children[0] ?? b.node; // nó original
      b.origParent.attach(child); // preserva transformação mundial
      b.pivotGroup.removeFromParent();
      // devolve os valores LOCAIS originais do nó (attach pode tê-los alterado)
      child.quaternion.copy(b.origQuat);
      child.position.copy(b.origPos);
    } else {
      b.node.quaternion.copy(b.baseQuat);
      b.node.position.copy(b.basePos);
    }
    this.bounds.delete(id);
  }

  private unbindAll() {
    for (const id of [...this.bounds.keys()]) this.unbind(id);
    this.clearMarkers();
  }

  /** marcadores visuais do centro de rotação */
  showPivots(on: boolean, scene: THREE.Scene) {
    this.clearMarkers();
    if (!on) return;
    for (const b of this.bounds.values()) {
      if (!b.pivotGroup) continue;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false })
      );
      b.pivotGroup.getWorldPosition(m.position);
      m.renderOrder = 999;
      scene.add(m);
      this.pivotMarkers.push(m);
      const axes = new THREE.AxesHelper(0.35);
      b.pivotGroup.getWorldPosition(axes.position);
      axes.renderOrder = 999;
      scene.add(axes);
      this.pivotMarkers.push(axes);
      const q = b.def.axis;
      const dir = new THREE.Vector3(...q).normalize();
      const arrow = new THREE.ArrowHelper(dir, m.position, 0.6, 0x38bdf8);
      arrow.renderOrder = 999;
      scene.add(arrow);
      this.pivotMarkers.push(arrow);
      void b;
    }
  }

  private clearMarkers() {
    for (const m of this.pivotMarkers) {
      m.removeFromParent();
      const mesh = m as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mm = mesh.material as THREE.Material | undefined;
      mm?.dispose?.();
    }
    this.pivotMarkers = [];
  }

  /** valor manual -1..1 (sobrescreve o estado do comando no laboratório) */
  setManual(id: string, v: number | null) {
    const d = this.defs.find((x) => x.id === id);
    if (d) d.manual = v === null ? null : clamp(v, -1, 1);
  }
  clearManuals() {
    for (const d of this.defs) d.manual = null;
  }

  /** sequência automática de teste (seno) sobre um ou mais canais */
  playSequence(channels: LabChannel[], dur = 4, combo = false) {
    this.seq = { channels, dur, t: 0, combo };
  }
  stopSequence() {
    this.seq = null;
  }
  get sequencing() {
    return this.seq !== null;
  }

  /** aplica estado + testes; dt em segundos */
  update(dt: number, state: ArticulationState) {
    let testState: ArticulationState = state;
    if (this.seq) {
      this.seq.t += dt;
      const v = Math.sin((this.seq.t / this.seq.dur) * Math.PI * 4);
      const s: ArticulationState = { ...state };
      for (const ch of this.seq.channels) {
        if (ch === "aileron" || ch === "elevator" || ch === "rudder") (s as Record<string, number>)[ch] = v;
        else if (ch === "propeller") (s as Record<string, number>).propeller = (state.propeller ?? 0) + dt * 8;
        else if (ch === "gear") (s as Record<string, number>).gear = (v + 1) / 2;
        else (s as Record<string, number>)[ch] = (v + 1) / 2;
      }
      testState = s;
      if (this.seq.t >= this.seq.dur) this.seq = null;
    }

    for (const b of this.bounds.values()) {
      const d = b.def;
      // manual (-1..1) → graus; estado do comando (-1..1 ou 0..1) → graus via gain
      const cmd = d.manual !== null ? d.manual : stateValue(d.channel, testState);
      const raw = (d.reverse ? -cmd : cmd) * d.gain + d.neutral;
      const lo = Math.min(d.min, d.max) + d.neutral;
      const hi = Math.max(d.min, d.max) + d.neutral;
      const desired = clamp(raw, lo, hi);
      const k = d.slew > 0 ? 1 - Math.exp(-d.slew * dt) : 1;
      b.value = THREE.MathUtils.lerp(b.value, desired, k);
      if (d.translate) {
        const off = new THREE.Vector3(...d.translate.vector).normalize().multiplyScalar((b.value / 100) * d.translate.distance);
        b.node.position.copy(b.basePos).add(off);
        b.node.quaternion.copy(b.baseQuat);
      } else {
        const axis = new THREE.Vector3(...d.axis).normalize();
        b.q.setFromAxisAngle(axis, (b.value * Math.PI) / 180);
        b.node.quaternion.copy(b.baseQuat).multiply(b.q);
        b.node.position.copy(b.basePos);
      }
    }
  }

  /** estado atual por articulação (para o slider refletir) */
  valueOf(id: string) {
    return this.bounds.get(id)?.value ?? 0;
  }

  serialize(aircraftId: string, name: string, clip: LabConfig["clip"], preset: LabConfig["preset"]): LabConfig {
    return {
      version: 1, aircraftId, name, preset,
      articulations: this.defs.map((d) => ({ ...d, manual: null })),
      clip, updatedAt: Date.now(),
    };
  }

  dispose() {
    this.unbindAll();
    this.clearMarkers();
    this.bounds.clear();
    this.seq = null;
  }
}

// ---------------- persistência de sessão ----------------
const KEY = (id: string) => `sbvs-lab:${id}`;
/** fallback em memória para ambientes sem Web Storage (Node, modo privado, iframe restrito) */
const mem = new Map<string, string>();

const stores = (): { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }[] => [
  {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { mem.set(k, v); } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { mem.delete(k); } },
  },
  {
    get: (k) => { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
    del: (k) => { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
  },
];

export function saveLabSession(cfg: LabConfig) {
  const raw = JSON.stringify(cfg);
  for (const s of stores()) s.set(KEY(cfg.aircraftId), raw);
  mem.set(KEY(cfg.aircraftId), raw);
}

export function loadLabSession(id: string): LabConfig | null {
  const raw = stores().map((s) => s.get(KEY(id))).find((x) => x !== null) ?? mem.get(KEY(id)) ?? null;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw as string) as LabConfig;
    return c.version === 1 && Array.isArray(c.articulations) ? c : null;
  } catch {
    return null;
  }
}

export function clearLabSession(id: string) {
  for (const s of stores()) s.del(KEY(id));
  mem.delete(KEY(id));
}

/** Comandos de teste disponíveis no laboratório. */
export const TEST_COMMANDS: { key: string; label: string; channels: LabChannel[] }[] = [
  { key: "ailerons", label: "TESTAR AILERONS", channels: ["aileron"] },
  { key: "elevator", label: "TESTAR PROFUNDOR", channels: ["elevator"] },
  { key: "rudder", label: "TESTAR LEME", channels: ["rudder"] },
  { key: "flaps", label: "TESTAR FLAPS", channels: ["flaps"] },
  { key: "spoilers", label: "TESTAR SPOILERS", channels: ["spoiler"] },
  { key: "gear", label: "TESTAR TREM DE POUSO", channels: ["gear"] },
  { key: "engine", label: "TESTAR MOTOR", channels: ["propeller", "throttle"] },
  { key: "afterburner", label: "TESTAR PÓS-COMBUSTÃO", channels: ["afterburner"] },
  { key: "combo", label: "SEQUÊNCIA COMBINADA", channels: ["aileron", "elevator", "rudder", "flaps", "spoiler", "gear"] },
];
