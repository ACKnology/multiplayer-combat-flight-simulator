// AircraftController — traduz estados da simulação em articulações visuais do modelo GLB.
// Não duplica dinâmica de voo: só representa visualmente os comandos recebidos.
import * as THREE from "three";
import type { ArticulationSpec, AircraftConfiguration, ControlChannel } from "./types";
import type { LoadedAircraft } from "./loader";

export interface AircraftState {
  pitchIn: number; // -1..1
  rollIn: number; // -1..1
  yawIn: number; // -1..1
  flaps: number; // 0..1
  spoilerPos: number; // 0..1
  /** 0..1 (1 = baixado) */
  gearPos: number;
  gearMoving: boolean;
  gearDown: boolean;
  eng: number; // 0..1 rotação/empuxo
  /** rotação acumulada da hélice (rad) — controlado separadamente quando presente */
  propAngle?: number;
  mainRotorAngle?: number;
  tailRotorAngle?: number;
  navLights?: boolean;
  beacon?: boolean;
  strobe?: boolean;
  landing?: boolean;
  reverser?: number;
  door?: number;
}

const DEG = Math.PI / 180;

interface BoundArticulation {
  target: THREE.Object3D;
  axis: THREE.Vector3;
  minDeg: number;
  maxDeg: number;
  reverse: boolean;
  gainDeg: number;
  baseQuat: THREE.Quaternion;
  wrapper: boolean;
}

export class AircraftController {
  config: AircraftConfiguration;
  group: THREE.Group; // wrapper normalizado na cena
  bounds: Map<ControlChannel, BoundArticulation[]>;
  missing: ControlChannel[] = [];
  syntheticPivots: { channel: ControlChannel; node: string }[] = [];

  constructor(loaded: LoadedAircraft, config: AircraftConfiguration) {
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = `Aircraft_${config.id}`;
    this.group.add(loaded.gltf);
    this.bounds = this.bindAll(loaded.gltf);
  }

  private asArray<T>(v: T | T[] | undefined): T[] {
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  }

  /**
   * Aplica uma articulação a um nó:
   * - se `pivot` vier na config, cria um Group pivô na posição e attacha o nó a ele;
   * - senão, usa o próprio nó (preserva hierarquia).
   */
  private applyOne(scene: THREE.Object3D, spec: ArticulationSpec, channel: ControlChannel): BoundArticulation | null {
    let target: THREE.Object3D | undefined = undefined;
    let wrapper = false;
    if (spec.pivot) {
      const node = scene.getObjectByName(spec.node);
      if (!node) return null;
      const parent = node.parent ?? node;
      parent.updateWorldMatrix(true, false);
      const wrap = new THREE.Group();
      wrap.name = `__pivot_${spec.node}`;
      wrap.position.set(...spec.pivot);
      parent.add(wrap);
      wrap.updateWorldMatrix(true, false);
      wrap.attach(node);
      target = wrap;
      wrapper = true;
      this.syntheticPivots.push({ channel, node: spec.node });
    } else {
      target = scene.getObjectByName(spec.node);
    }
    if (!target) return null;

    const axis = spec.axis ? new THREE.Vector3(...spec.axis).normalize() : new THREE.Vector3(1, 0, 0);
    const bound: BoundArticulation = {
      target,
      axis,
      minDeg: spec.minAngle ?? -20,
      maxDeg: spec.maxAngle ?? 20,
      reverse: Boolean(spec.reverse),
      gainDeg: Math.abs((spec.maxAngle ?? 20) - (spec.minAngle ?? -20)) || 20,
      baseQuat: target.quaternion.clone(),
      wrapper,
    };
    target.userData.__aircraftChannel = channel;
    target.userData.__aircraftPivot = spec.pivot ?? null;
    target.userData.__aircraftAxis = spec.axis ?? null;
    return bound;
  }

  private bindAll(scene: THREE.Object3D): Map<ControlChannel, BoundArticulation[]> {
    const out = new Map<ControlChannel, BoundArticulation[]>();
    const map: Partial<Record<ControlChannel, ArticulationSpec | ArticulationSpec[]>> = this.config.components;
    for (const [channel, entry] of Object.entries(map) as [ControlChannel, ArticulationSpec | ArticulationSpec[]][]) {
      const list: BoundArticulation[] = [];
      for (const spec of this.asArray(entry)) {
        const applied = this.applyOne(scene, spec, channel);
        if (applied) list.push(applied);
        else this.missing.push(channel);
      }
      if (list.length) out.set(channel, list);
    }
    return out;
  }

  /** Aplica estado do canal com slew (approach rate) */
  private updateChannel(dt: number, channel: ControlChannel, value: number, slew: number) {
    const list = this.bounds.get(channel);
    if (!list) return;
    for (const b of list) {
      const t = THREE.MathUtils.clamp(value, -1, 1);
      const angleDeg = b.minDeg + ((t + 1) / 2) * b.gainDeg;
      const target = b.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(b.axis, angleDeg * DEG));
      const k = 1 - Math.exp(-slew * dt);
      b.target.quaternion.slerp(target, k);
    }
  }

  /** Rotação contínua (hélice/rotor): valor = rotação acumulada em radianos. */
  private spinContinuous(dt: number, channel: ControlChannel, angleRad: number) {
    const list = this.bounds.get(channel);
    if (!list) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angleRad);
    for (const b of list) {
      b.target.quaternion.copy(b.baseQuat.clone().multiply(q));
    }
  }

  /** Abertura 0..1 com slew (trem em transição, portas, reversores). */
  private binary(dt: number, channel: ControlChannel, value: number, slew: number) {
    const list = this.bounds.get(channel);
    if (!list) return;
    for (const b of list) {
      const angleDeg = value ? b.maxDeg : b.minDeg;
      const target = b.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(b.axis, angleDeg * DEG));
      const k = 1 - Math.exp(-slew * dt);
      b.target.quaternion.slerp(target, k);
    }
  }

  /**
   * Atualiza o controller com o estado da simulação.
   * Slew rates aproximam atuadores reais (flaps lembram lentos, spoilers rápidos).
   */
  update(dt: number, s: AircraftState) {
    this.updateChannel(dt, "aileronLeft", s.rollIn, 8);
    this.updateChannel(dt, "aileronRight", s.rollIn, 8);
    this.updateChannel(dt, "elevator", s.pitchIn, 8);
    this.updateChannel(dt, "rudder", s.yawIn, 8);
    this.updateChannel(dt, "flapL", s.flaps, 1.8);
    this.updateChannel(dt, "flapR", s.flaps, 1.8);
    this.updateChannel(dt, "spoiler", s.spoilerPos, 6);
    this.updateChannel(dt, "speedbrake", s.spoilerPos, 6);
    this.binary(dt, "gear", s.gearDown ? 1 : 0, 2.4);
    this.binary(dt, "gearLeft", s.gearDown ? 1 : 0, 2.4);
    this.binary(dt, "gearRight", s.gearDown ? 1 : 0, 2.4);
    this.binary(dt, "gearNose", s.gearDown ? 1 : 0, 2.4);
    this.binary(dt, "gearDoor", s.gearMoving ? 1 : 0, 5);
    this.binary(dt, "door", s.door ?? 0, 2);
    this.binary(dt, "reverser", s.reverser ?? 0, 4);
    if (s.propAngle !== undefined) this.spinContinuous(dt, "propeller", s.propAngle);
    if (s.propAngle !== undefined) this.spinContinuous(dt, "prop", s.propAngle);
    if (s.mainRotorAngle !== undefined) this.spinContinuous(dt, "mainRotor", s.mainRotorAngle);
    if (s.tailRotorAngle !== undefined) this.spinContinuous(dt, "tailRotor", s.tailRotorAngle);
    this.binary(dt, "nav", s.navLights ? 1 : 0, 8);
    this.binary(dt, "beacon", s.beacon ? 1 : 0, 8);
    this.binary(dt, "strobe", s.strobe ? 1 : 0, 8);
    this.binary(dt, "landing", s.landing ? 1 : 0, 8);
  }

  /** Reverte pivôs sintéticos (devolve nós aos pais originais) — usado no descarte. */
  dispose() {
    for (const [_ch, list] of this.bounds) {
      for (const b of list) {
        if (b.wrapper) {
          const wrap = b.target as THREE.Group;
          const parent = wrap.parent;
          const children = [...wrap.children];
          for (const c of children) parent?.add(c);
          wrap.children.length = 0;
          parent?.remove(wrap);
        }
      }
    }
    this.bounds.clear();
    this.syntheticPivots.length = 0;
  }
}
