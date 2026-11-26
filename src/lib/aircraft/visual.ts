"use client";
/**
 * AircraftVisual — resolve e instancia a geometria de UMA aeronave, de forma
 * unificada, a partir do Aircraft Registry central.
 *
 * Duas origens de geometria, mesmo contrato:
 *  - "procedural": construída por código Three.js (aeronaves originais do simulador)
 *  - "glb":        modelo externo GLB/glTF via GLTFLoader
 *
 * Ambas devolvem a MESMA interface (`AircraftVisualInstance`), com o adapter que
 * traduz estados da simulação para os nós correspondentes. Assim a aeronave
 * pilotada e o tráfego ADS-B compartilham um único sistema.
 */
import * as THREE from "three";
import { buildAircraft, type AircraftModel } from "@/sim/models";
import { byId as proceduralById, type AircraftSpec } from "@/sim/aircraft";
import { loadAircraft, unloadAircraft, type LoadedAircraft } from "./loader";
import { AircraftController, type AircraftState } from "./controller";
import { ArticulationEngine, loadLabSession, toArticulationState } from "./articulation";
import type { AircraftConfiguration } from "./types";

/** Interface única devolvida para qualquer origem de geometria. */
export interface AircraftVisualInstance {
  group: THREE.Group;
  origin: "procedural" | "glb";
  /** configuração usada (glb) ou spec procedural equivalente */
  config: AircraftConfiguration | null;
  spec: AircraftSpec | null;
  /** adapter de animação (superfícies, trem, hélice…); null = sem partes móveis */
  controller: AircraftController | null;
  /** API procedural clássica (luzes, trem, pós-combustor…) — null quando GLB */
  procedural: AircraftModel | null;
  /** atualiza a animação a partir do estado de simulação */
  update: (dt: number, s: AircraftState) => void;
  /** descarte de recursos */
  dispose: () => void;
}

/** Fallback controlado: silhueta genérica, sem partes móveis. */
export function buildFallbackVisual(): AircraftVisualInstance {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.6, metalness: 0.3 });
  const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 8, 6, 12).rotateX(Math.PI / 2), mat);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 1.8), mat);
  wing.position.y = 0.2;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 1.8), mat);
  fin.position.set(0, 1.4, 4);
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(5, 0.22, 1.2), mat);
  hstab.position.set(0, 0.6, 4.2);
  g.add(fuse, wing, fin, hstab);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return {
    group: g,
    origin: "procedural",
    config: null,
    spec: null,
    controller: null,
    procedural: null,
    update: () => undefined,
    dispose: () => {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** Instancia a geometria PROCEDURAL original do simulador (preservada). */
export function buildProceduralVisual(specId: string, registration = ""): AircraftVisualInstance {
  const spec = proceduralById(specId);
  const model = buildAircraft(spec, registration);
  const group = new THREE.Group();
  group.name = `Proc_${spec.id}`;
  group.add(model.group);
  return {
    group,
    origin: "procedural",
    config: null,
    spec,
    controller: null,
    procedural: model,
    // A animação das aeronaves procedurais é feita pelo FlightEngine, que já
    // conhece a API `AircraftModel`. Aqui apenas expomos um no-op coerente.
    update: () => undefined,
    dispose: () => {
      // o motor pode reutilizar; descarte real é responsabilidade do chamador
    },
  };
}

/**
 * Instancia uma aeronave GLB a partir da configuração do Registry.
 * Retorna fallback procedural compatível quando o GLB falha.
 */
export async function buildGlbVisual(
  config: AircraftConfiguration,
  opts: { modelLengthMeters?: number | null; fallbackSpecId?: string } = {}
): Promise<AircraftVisualInstance> {
  try {
    const loaded = await loadAircraft(`/aircraft/${config.id}/${config.modelFile}`, {
      modelLengthMeters: opts.modelLengthMeters ?? null,
    });
    const controller = new AircraftController(loaded, config);
    // MESMO mecanismo de articulação do laboratório: se houver config de sessão
    // (salva no Inspector), o motor de voo passa a movimentar os nós mapeados.
    const lab = loadLabSession(config.id);
    const articulations = lab && lab.articulations.length ? new ArticulationEngine(controller.group) : null;
    if (articulations) articulations.setDefs(lab!.articulations);
    return {
      group: controller.group,
      origin: "glb",
      config,
      spec: null,
      controller,
      procedural: null,
      update: (dt, s) => {
        controller.update(dt, s);
        articulations?.update(dt, toArticulationState(s, dt));
      },
      dispose: () => {
        articulations?.dispose();
        controller.dispose();
        unloadAircraft(loaded.gltf);
      },
    };
  } catch (err) {
    // fallback controlado e identificado
    console.warn(`[aircraft] GLB "${config.id}" indisponível (${err instanceof Error ? err.message : err}). Usando fallback procedural.`);
    if (opts.fallbackSpecId) {
      const fb = buildProceduralVisual(opts.fallbackSpecId);
      return { ...fb, origin: "procedural" };
    }
    return buildFallbackVisual();
  }
}
