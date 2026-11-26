// LiveryManager — troca de pinturas (livery) sem recarregar a geometria.
// Aplica: substituição de texturas, de materiais e decalcos de matrícula sob demanda.
import * as THREE from "three";
import type { LiveryConfig } from "./types";

export interface LiveryAsset {
  config: LiveryConfig;
  /** mapa de material original → material clonado (para restaurar) */
  applied: { original: THREE.Material; clone: THREE.Material }[];
  decals: THREE.Mesh[];
}

const texLoader = new THREE.TextureLoader();

const liveryCache = new Map<string, Promise<LiveryConfig | null>>();
/** diretório real no disco pode divergir do id do Registry (ids GLB são prefixados) */
const DIR_OF: Record<string, string> = {
  "glb-c172": "c172",
  "glb-b789": "b789",
  "glb-jet": "jet",
  "glb-bell206": "bell206",
};

async function loadLivery(id: string, aircraftId: string): Promise<LiveryConfig | null> {
  const key = `${aircraftId}/${id}`;
  let p = liveryCache.get(key);
  if (!p) {
    const dir = DIR_OF[aircraftId] ?? aircraftId.replace(/^glb-/, "");
    p = fetch(`/aircraft/${dir}/liveries/${id}/livery.json`)
      .then((r) => (r.ok ? (r.json() as Promise<LiveryConfig>) : null))
      .catch(() => null);
    liveryCache.set(key, p);
  }
  return p;
}

/** Aplica uma livery a um objeto (modelo GLB). Não recarrega a geometria. */
export async function applyLivery(root: THREE.Object3D, liveryId: string, aircraftId: string): Promise<LiveryAsset | null> {
  const cfg = await loadLivery(liveryId, aircraftId);
  if (!cfg) return null;

  // materiais por nome, preservando o material original p/ restauração
  const applied: LiveryAsset["applied"] = [];
  const decals: THREE.Mesh[] = [];

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    (m.material as THREE.Material[]) = mats.map((orig: THREE.Material) => {
      const name = orig?.name ?? "";
      const materialCfg = cfg.materials?.[name];
      const tex = cfg.textures?.[name];
      if (!materialCfg && !tex) return orig;
      // clona apenas quando vai alterar
      const clone = orig.clone();
      (clone as THREE.Material & { userData: Record<string, unknown> }).userData.__liveryOriginal = orig.uuid;
      if (materialCfg?.color) (clone as THREE.MeshStandardMaterial).color.set(materialCfg.color);
      if (typeof materialCfg?.metalness === "number") (clone as THREE.MeshStandardMaterial).metalness = materialCfg.metalness;
      if (typeof materialCfg?.roughness === "number") (clone as THREE.MeshStandardMaterial).roughness = materialCfg.roughness;
      if (tex) {
        const t = texLoader.load(tex, undefined, undefined, () => {});
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false; // glTF: UV não espelhado
        (clone as THREE.MeshStandardMaterial).map = t;
      }
      applied.push({ original: orig, clone });
      return clone;
    });
  });

  // decalques de matrícula (back/front, yaw 90 ⇒ plano lateral)
  for (const d of cfg.decals ?? []) {
    const w = d.size?.[0] ?? 1, h = d.size?.[1] ?? 0.3;
    const mesh = decalMesh(d.text ?? cfg.registration ?? cfg.name, w, h);
    mesh.position.set(...(d.position ?? [0, 0, 0]));
    if (typeof d.yaw === "number") mesh.rotation.y = (d.yaw * Math.PI) / 180;
    if (typeof d.pitch === "number") mesh.rotation.x = (d.pitch * Math.PI) / 180;
    decals.push(mesh);
    root.add(mesh);
  }

  return { config: cfg, applied, decals };
}


function decalMesh(text: string, w: number, h: number): THREE.Mesh {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = Math.max(64, Math.round((512 * h) / w));
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, cv.width, cv.height);
  g.font = `bold ${Math.round(cv.height * 0.62)}px 'Rajdhani', sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#181b20";
  g.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  );
  mesh.renderOrder = 1;
  return mesh;
}

/** Remove a livery (restaura materiais originais e remove decalques). */
export function removeLivery(root: THREE.Object3D, asset: LiveryAsset | null) {
  if (!asset) return;
  const byClone = new Map(asset.applied.map((a) => [a.clone.uuid, a.original]));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      m.material = m.material.map((mat) => byClone.get(mat.uuid) ?? mat);
    } else if (m.material) {
      m.material = byClone.get(m.material.uuid) ?? m.material;
    }
  });
  for (const d of asset.decals) {
    (d.material as THREE.Material).dispose();
    d.geometry.dispose();
    d.removeFromParent();
  }
  // libera clones
  for (const { clone } of asset.applied) clone.dispose();
}
