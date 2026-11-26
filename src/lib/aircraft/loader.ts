// AircraftAssetLoader — carrega GLB/GLTF com GLTFLoader, cache, tratamento de falhas
// e descarte correto de buffers/texturas (sem vazamentos).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface LoadedAircraft {
  /** root da cena glTF (preserva hierarquia/materiais/animações) */
  gltf: THREE.Group;
  clips: THREE.AnimationClip[];
  animations: { name: string; duration: number }[];
  /** centraliza na origem e normaliza o comprimento total */
  normalize: (lengthMeters?: number | null) => void;
}

/** URL → promessa de aeronave carregada. */
const cache = new Map<string, Promise<LoadedAircraft>>();

/** Libera texturas/geometrias de um Object3D (trio-safe) — evita vazamento de memória. */
function disposeObject(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.geometry) geos.add(m.geometry);
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  for (const m of mats) m.dispose();
  for (const g of geos) g.dispose();
  root.clear();
}

function fromGltf(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): LoadedAircraft {
  const scene = gltf.scene;
  const clips = gltf.animations ?? [];
  return {
    gltf: scene,
    clips,
    animations: clips.map((c) => ({ name: c.name, duration: c.duration })),
    normalize(lengthMeters?: number | null) {
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      scene.position.sub(center);
      if (lengthMeters && size.length() > 0) {
        const s = lengthMeters / size.length();
        scene.scale.setScalar(s);
      }
    },
  };
}

/**
 * Carrega a GLB. Falha não é cacheada — retry liberado.
 */
export function loadAircraft(url: string, opts: { modelLengthMeters?: number | null } = {}): Promise<LoadedAircraft> {
  let p = cache.get(url);
  if (!p) {
    const loader = new GLTFLoader();
    p = loader
      .loadAsync(url)
      .then((gltf) => {
        const ac = fromGltf(gltf);
        if (opts.modelLengthMeters) ac.normalize(opts.modelLengthMeters);
        return ac;
      })
      .catch((err: unknown) => {
        cache.delete(url);
        throw err;
      });
    cache.set(url, p);
  }
  return p;
}

export function unloadAircraft(obj: THREE.Object3D | null) {
  if (obj) disposeObject(obj);
}

export function clearAircraftCache() {
  cache.clear();
}
