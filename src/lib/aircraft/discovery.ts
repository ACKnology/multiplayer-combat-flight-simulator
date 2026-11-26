// Aircraft Feature Discovery — reconhecimento de componentes aeronáuticos em modelos GLB:
// aliases por nome, pivôs por geometria (bounds), analise de animações e manifest de capacidades.
import * as THREE from "three";
import { matchScore, sideOf, type AliasRule, COMPONENT_ALIASES } from "./aliases";
import type { ControlChannel, DiscoveryStatus, InspectionResult, FeatureManifest } from "./types";

export type { InspectionResult };

export interface DiscoveredComponent {
  channel: ControlChannel;
  node: string | null;
  object?: THREE.Object3D;
  confidence: number;
  status: DiscoveryStatus;
  source: string;
  axis: [number, number, number];
  pivot: [number, number, number];
}

export interface DiscoveryReport {
  aircraftId: string;
  nodeCount: number;
  meshCount: number;
  clipCount: number;
  components: DiscoveredComponent[];
  clips: { name: string; duration: number; tracks: string[] }[];
}

/** Sugere como atrelar uma pinça de comando à articulação (canal + sentido), sem validar articulação real. */
export interface SuggestedMapping {
  channel: ControlChannel;
  /** quanto o valor do comando deve girar em graus (ganho básico) */
  gainDeg: number;
  reverse?: boolean;
}

// limites + giros de referência (não constam em especificações reais de cada aeronave):
const SPAN: Partial<Record<ControlChannel, { gain: number; reverse?: boolean }>> = {
  aileronLeft: { gain: 20 },
  aileronRight: { gain: 20, reverse: true },
  elevator: { gain: 25 },
  rudder: { gain: 22 },
  flapL: { gain: -30 },
  flapR: { gain: -30 },
  spoiler: { gain: 55 },
  speedbrake: { gain: 45 },
  gear: { gain: 90 },
  gearLeft: { gain: 90 },
  gearRight: { gain: 90, reverse: true },
  gearNose: { gain: 90 },
  gearDoor: { gain: 75 },
  propeller: { gain: 360 }, // interpretado como rotação contínua (rpm)
  mainRotor: { gain: 360 },
  tailRotor: { gain: 360 },
  door: { gain: 70 },
  reverser: { gain: -35 },
};

export function defaultGain(channel: ControlChannel): SuggestedMapping {
  const s = SPAN[channel];
  return { channel, gainDeg: s?.gain ?? 0, reverse: s?.reverse };
}

/**
 * Inspeciona um modelo GLB (já carregado) e devolve relatório de descoberta:
 * nó por canal (aliases), confiança, animações e manifest.
 */
export function inspect(scene: THREE.Object3D, animationClips: THREE.AnimationClip[], aircraftId = ""): DiscoveryReport {
  const nodes: { node: THREE.Object3D; name: string; isMesh: boolean; triangles: number }[] = [];
  let meshCount = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const isMesh = Boolean(mesh.isMesh && mesh.geometry);
    if (isMesh) meshCount++;
    nodes.push({
      node: o,
      name: o.name || "<sem nome>",
      isMesh,
      triangles: isMesh ? (mesh.geometry.index ? mesh.geometry.index.count / 3 : (mesh.geometry.attributes.position?.count ?? 0) / 3) : 0,
    });
  });

  const components: DiscoveredComponent[] = [];
  const ruleByChannel = new Map<ControlChannel, AliasRule>(COMPONENT_ALIASES.map((r) => [r.channel, r]));

  for (const rule of COMPONENT_ALIASES) {
    // candidatos com nome combinando ao alias
    const best = nodes
      .filter((n) => n.name && !/<sem nome|^Object_\d+/i.test(n.name))
      .map((n) => ({ n, score: matchScore(n.name, rule.channel) }))
      .filter((x) => x.score.score > 0)
      .sort((a, b) => b.score.score - a.score.score);

    if (!best.length) continue;

    // severidade do lado (para superfícies pareadas)
    const bestA = best[0];
    let status: DiscoveryStatus = "probable";
    let conf = bestA.score.score;

    const pairedLeft = best.some((b) => sideOf(b.n.name) === "L");
    const pairedRight = best.some((b) => sideOf(b.n.name) === "R");
    if (rule.channel === "aileronLeft" || rule.channel === "flapL") {
      if (!pairedLeft && pairedRight) status = "ambiguous";
      else if (!pairedLeft && !pairedRight) status = "ambiguous";
    }
    if (rule.channel === "aileronRight" || rule.channel === "flapR") {
      if (!pairedRight && pairedLeft) status = "ambiguous";
      else if (!pairedRight && !pairedLeft) status = "ambiguous";
    }

    // fonte fraca + sem malha sólida → ambíguo
    if (bestA.score.score < 0.75) status = "ambiguous";
    if (rule.needsMesh && !bestA.n.isMesh) status = "ambiguous";

    if (status === "probable" && conf >= 0.95) status = "confirmed";

    components.push({
      channel: rule.channel,
      node: bestA.n.name,
      object: bestA.n.node,
      confidence: conf,
      status,
      source: bestA.score.source,
      axis: [1, 0, 0],
      pivot: [0, 0, 0],
    });
    void ruleByChannel;
  }

  const clips = animationClips.map((c) => ({
    name: c.name,
    duration: c.duration,
    tracks: c.tracks.map((t) => t.name),
  }));

  return { aircraftId, nodeCount: nodes.length, meshCount, clipCount: clips.length, components, clips };
}

/** Mapeia descoberta + geometria para especificações de articulação prontas p/ AircraftController. */
export function buildArticulations(report: DiscoveryReport) {
  const out: Partial<Record<ControlChannel, { node: string; axis: [number, number, number]; pivot: [number, number, number]; minAngle: number; maxAngle: number; reverse: boolean; confidence: number; status: DiscoveryStatus; gainDeg: number }>> = {};
  for (const comp of report.components) {
    if (comp.status === "ambiguous" || comp.status === "unidentified") {
      // ambíguos ficam Identificados mas não articulados automaticamente (manifest e Inspector corrigem)
      continue;
    }
    const g = defaultGain(comp.channel);
    const max = Math.abs(g.gainDeg);
    out[comp.channel] = {
      node: comp.node ?? "",
      axis: comp.axis,
      pivot: comp.pivot,
      minAngle: g.reverse ? 0 : -max,
      maxAngle: g.reverse ? max : g.gainDeg < 0 ? 0 : max,
      reverse: !!g.reverse,
      confidence: comp.confidence,
      status: comp.status,
      gainDeg: g.gainDeg,
    };
  }
  return out;
}

/** Manifesta capacidades visuais (não aerodinâmicas) do modelo */
export function manifestOf(report: DiscoveryReport): FeatureManifest {
  const features: FeatureManifest["features"] = {};
  for (const c of report.components) {
    features[c.channel] = c.status === "confirmed" || c.status === "probable";
  }
  return { aircraftId: report.aircraftId, features, notes: "capacidade visual/integração; não equivale a simulação aerodinâmica" };
}

/** Relatório pronto para o AircraftInspector (hierarquia + clips + componentes). */
export function inspectionOf(scene: THREE.Object3D, animationClips: THREE.AnimationClip[], aircraftId = ""): InspectionResult {
  const report = inspect(scene, animationClips, aircraftId);
  const rootNodes: InspectionResult["nodes"] = [];

  const toIN = (o: THREE.Object3D): InspectionResult["nodes"][number] => {
    const mesh = o as THREE.Mesh;
    const isMesh = Boolean(mesh.isMesh);
    return {
      name: o.name || "<sem nome>",
      id: o.uuid,
      children: o.children.map(toIN),
      worldPos: [0, 0, 0] as [number, number, number],
      mesh: isMesh,
      triangles: isMesh && mesh.geometry ? (mesh.geometry.index ? mesh.geometry.index.count / 3 : (mesh.geometry.attributes.position?.count ?? 0) / 3) : undefined,
      materialName: isMesh && mesh.material ? (Array.isArray(mesh.material) ? mesh.material[0]?.name : mesh.material.name) : undefined,
    };
  };
  scene.children.forEach((c) => rootNodes.push(toIN(c)));
  report.components.forEach((c) => {
    c.object?.updateWorldMatrix(true, false);
    const p = new THREE.Vector3();
    c.object?.getWorldPosition(p);
    // posição corrigida no viewer do inspector (contra o crop do modelo)
    c.pivot = [p.x, p.y, p.z];
  });

  return {
    nodes: rootNodes,
    clips: report.clips,
    components: report.components.map((c) => ({
      channel: c.channel,
      node: c.node,
      confidence: c.confidence,
      status: c.status,
      source: c.source,
      axis: c.axis,
      pivot: c.pivot,
    })),
  };
}
