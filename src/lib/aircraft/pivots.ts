// Derivações de pivôs/eixos a partir da geometria de um nó (pivôs sintéticos).
import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ControlChannel } from "./types";

export interface PivotGuess {
  pivot: [number, number, number];
  axis: [number, number, number];
  confidence: number;
  source: "mesh-bounds" | "node-position" | "manual";
}

const _q = new THREE.Quaternion();

/** transforma do modelo para o espaço LOCAL do nó pivô: posição e direção */
function worldToPivotLocal(node: THREE.Object3D, wPos: THREE.Vector3, wDir: THREE.Vector3, out: { pivot: [number, number, number]; axis: [number, number, number] }) {
  node.updateWorldMatrix(true, false);
  const inv = node.matrixWorld.clone().invert();
  const lp = wPos.clone().applyMatrix4(inv);
  const ld = wDir.clone().transformDirection(inv);
  out.pivot = [lp.x, lp.y, lp.z];
  out.axis = [ld.x, ld.y, ld.z];
  return out;
}

/**
 * Estádio **sugerido** de pivô/eixo por canal, usando a caixa delimitadora do mesh.
 * É uma conjectura para revisão manual pelo Inspector — não é articulação real.
 */
export function suggestPivot(channel: ControlChannel, node: THREE.Object3D): PivotGuess {
  const box = new THREE.Box3().setFromObject(node);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const parent = node.parent ?? node;
  node.updateWorldMatrix(true, false);
  const invNode = parent.matrixWorld.clone().invert();
  const toLocal = (p: THREE.Vector3, d: THREE.Vector3) => {
    const lp = p.clone().applyMatrix4(invNode);
    const ld = d.clone().transformDirection(invNode);
    return { pivot: [lp.x, lp.y, lp.z] as [number, number, number], axis: [ld.x, ld.y, ld.z] as [number, number, number] };
  };

  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  switch (channel) {
    case "aileronLeft": {
      // borda de fuga interna: X mínimo, Y central, Z do bordo de fuga (máx)
      const p = new THREE.Vector3(box.min.x + size.x * 0.15, center.y, box.max.z - size.z * 0.05);
      const l = toLocal(p, X);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.78, source: "mesh-bounds" };
    }
    case "aileronRight": {
      const p = new THREE.Vector3(box.max.x - size.x * 0.15, center.y, box.max.z - size.z * 0.05);
      const l = toLocal(p, X);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.78, source: "mesh-bounds" };
    }
    case "elevator": {
      const p = new THREE.Vector3(center.x, center.y, box.max.z - size.z * 0.08);
      const l = toLocal(p, X);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.82, source: "mesh-bounds" };
    }
    case "rudder": {
      // borda de ataque, centro vertical
      const p = new THREE.Vector3(center.x, center.y, box.min.z + size.z * 0.12);
      const l = toLocal(p, Y);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.8, source: "mesh-bounds" };
    }
    case "flapL":
    case "flapR": {
      const p = new THREE.Vector3(center.x, center.y, box.max.z - size.z * 0.06);
      const l = toLocal(p, X);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.74, source: "mesh-bounds" };
    }
    case "spoiler":
    case "speedbrake": {
      const p = new THREE.Vector3(center.x, box.max.y, box.max.z - size.z * 0.1);
      const l = toLocal(p, X);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.68, source: "mesh-bounds" };
    }
    case "gear":
    case "gearLeft":
    case "gearRight":
    case "gearNose":
    case "gearDoor": {
      // topo do trem; recolhimento para cima/para dentro
      const p = new THREE.Vector3(center.x, box.max.y, center.z);
      const l = toLocal(p, Y);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.6, source: "mesh-bounds" };
    }
    case "propeller":
    case "prop":
    case "mainRotor":
    case "tailRotor": {
      const p = center.clone();
      const l = toLocal(p, channel === "propeller" || channel === "prop" ? Z : Y);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.86, source: "mesh-bounds" };
    }
    case "nav":
    case "beacon":
    case "strobe":
    case "landing":
    case "door":
    case "reverser": {
      const l = toLocal(center, Y);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.5, source: "mesh-bounds" };
    }
    default: {
      const l = toLocal(center, Y);
      return { pivot: l.pivot, axis: l.axis, confidence: 0.4, source: "node-position" };
    }
  }
}

/** envolve um nó num pivô recém-criado (repare sentido: todo o movimento passa a ser do pivô) */
export function ensurePivot(spec: {
  nodeName: string;
  pivot?: [number, number, number];
  axis?: [number, number, number];
}, scene: THREE.Object3D): { pivot: THREE.Object3D; node: THREE.Object3D } | null {
  const node = scene.getObjectByName(spec.nodeName);
  if (!node) return null;
  if (spec.pivot) {
    // pivô explícito em configuração: cria um wrapper na posição indicada (em coordenadas do nó pai)
    const parent = node.parent ?? scene;
    const pivot = new THREE.Group();
    pivot.name = `Pivot_${spec.nodeName}`;
    const pw = new THREE.Vector3(...spec.pivot);
    parent.updateWorldMatrix(true, false);
    // interpreta o pivô como posição no espaço do PAI do nó
    pivot.position.copy(pw);
    const worldPos = new THREE.Vector3();
    node.getWorldPosition(worldPos);
    parent.add(pivot);
    pivot.updateWorldMatrix(true, false);
    pivot.attach(node); // preserva a posição mundial do nó
    return { pivot, node };
  }
  return { pivot: node, node };
}

/** junta todos os meshes de um nó em um único objeto (para virar superfície articulável) */
export function mergeNodeMeshes(node: THREE.Object3D): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  node.updateWorldMatrix(true, true);
  const inv = node.matrixWorld.clone().invert();
  node.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (m.material) mats.push(m.material as THREE.Material);
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = geos.length > 1 ? BufferGeometryUtils.mergeGeometries(geos, true) : geos[0];
  const mesh = new THREE.Mesh(merged, (mats.length > 1 ? mats : mats[0]) as THREE.Material) as THREE.Mesh;
  if (!mats[0]) mesh.material = new THREE.MeshStandardMaterial({ color: 0x8b93a1 });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

void _q;
