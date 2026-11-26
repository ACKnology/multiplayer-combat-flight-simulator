/**
 * glbImport — importação 100% local (sem upload) de GLB/GLTF para o Inspector.
 * Usa exclusivamente o GLTFLoader do Three.js (sem parser próprio).
 * GLTF multi-arquivo: os URI de buffers/images são reescritos para Object URLs
 * montados a partir dos arquivos associados selecionados/dropados pelo usuário.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const MAX_FILE_MB = 150;
export const MAX_TOTAL_MB = 200;
export const TRI_WARN = 2_500_000;
export const TRI_HARD = 9_000_000;

const MAIN_RE = /\.(glb|gltf)$/i;
const COMPANION_RE = /\.(bin|png|jpg|jpeg|webp|ktx2|data)$/i;

/** nome canônico para casar URI ↔ arquivo (sem pastas, sem query/hash, minúsculo) */
export function normBase(name: string): string {
  let s = name;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* mantém cru */
  }
  s = s.split("?")[0].split("#")[0];
  s = s.replace(/\\/g, "/");
  s = s.slice(s.lastIndexOf("/") + 1);
  return s.trim().toLowerCase();
}

/** escolhe o arquivo principal; .glb tem prioridade sobre .gltf */
export function pickMain(names: string[]): { name: string; kind: "glb" | "gltf" } | null {
  const mains = names.filter((n) => MAIN_RE.test(n));
  const glb = mains.find((n) => /\.glb$/i.test(n));
  if (glb) return { name: glb, kind: "glb" };
  const gltf = mains.find((n) => /\.gltf$/i.test(n));
  if (gltf) return { name: gltf, kind: "gltf" };
  return null;
}

export interface SelectionReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  mainName: string | null;
  mainKind: "glb" | "gltf" | null;
}

/** Valida nomes/tamanhos ANTES de ler (limites configuráveis). */
export function validateSelection(files: { name: string; size: number }[]): SelectionReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const main = pickMain(files.map((f) => f.name));
  if (!main) {
    errors.push("Nenhum arquivo .glb ou .gltf selecionado. formatos aceitos: .glb (prioritário) e .gltf + companions (.bin, texturas).");
    return { ok: false, errors, warnings, mainName: null, mainKind: null };
  }
  const totalMB = files.reduce((a, f) => a + f.size, 0) / 1e6;
  const mainFile = files.find((f) => f.name === main.name)!;
  if (mainFile.size > MAX_FILE_MB * 1e6) {
    errors.push(`Arquivo principal excede o limite de ${MAX_FILE_MB} MB (${(mainFile.size / 1e6).toFixed(1)} MB).`);
  }
  if (totalMB > MAX_TOTAL_MB * 1e6) {
    errors.push(`Conjunto de arquivos excede ${MAX_TOTAL_MB} MB (${(totalMB / 1e6).toFixed(1)} MB). Reduza texturas ou importe menos companions.`);
  }
  if (main.kind === "gltf") {
    const binCount = files.filter((f) => /\.bin$/i.test(f.name)).length;
    if (binCount === 0) warnings.push("GLTF sem .bin selecionado — se o JSON referenciar buffers externos, a importação indicará os arquivos faltantes.");
  }
  const unknown = files.filter((f) => f.name !== main.name && !MAIN_RE.test(f.name) && !COMPANION_RE.test(f.name));
  for (const u of unknown) warnings.push(`Arquivo ignorado (extensão não reconhecida como companheira): ${u.name}`);
  return { ok: errors.length === 0, errors, warnings, mainName: main.name, mainKind: main.kind };
}

/** URI → nome de arquivo companheiro (null quando ausente) */
export function matchCompanion(uri: string, available: Set<string>): string | null {
  if (!uri || uri.startsWith("data:")) return null; // embutido: nada a resolver
  const base = normBase(uri);
  return available.has(base) ? base : null;
}

export interface ModelStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  skinned: number;
  bones: number;
  size: [number, number, number];
  center: [number, number, number];
}

export function computeStats(root: THREE.Object3D): ModelStats {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  let skinned = 0;
  let bones = 0;
  const mats = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
    if ((o as THREE.Bone).isBone) bones++;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const pos = mesh.geometry.getAttribute?.("position");
    if (pos) vertices += pos.count;
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : pos ? pos.count / 3 : 0;
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => x && mats.add(x.uuid));
    else if (m) mats.add(m.uuid);
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    meshes,
    vertices,
    triangles: Math.floor(triangles),
    materials: mats.size,
    skinned,
    bones,
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  };
}

/** heurística de unidade: maior dimensão > 300 ⇒ provavelmente centímetros */
export function autoUnitFactor(stats: ModelStats): { factor: number; guessed: string } {
  const max = Math.max(...stats.size.map(Math.abs));
  if (max > 300) return { factor: 0.01, guessed: "centímetros → metros (auto)" };
  if (max > 0 && max < 0.05) return { factor: 100, guessed: "escala mínima — confira a unidade de origem" };
  return { factor: 1, guessed: "metros (assumido)" };
}

export interface ImportResult {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  warnings: string[];
  bytes: number;
  name: string;
  /** URLs de companions a revogar no descarte */
  urls: string[];
}

/** extrai todos os URIs externos de buffers/images de um JSON glTF */
export function collectExternalUris(json: unknown): { buffers: string[]; images: string[] } {
  const j = json as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  const buffers = (j.buffers ?? []).map((b) => b.uri ?? "").filter((u) => u && !u.startsWith("data:"));
  const images = (j.images ?? []).map((b) => b.uri ?? "").filter((u) => u && !u.startsWith("data:"));
  return { buffers, images };
}

type FileMap = Map<string, File>;

const byName = (files: File[]): FileMap => {
  const m = new Map<string, File>();
  for (const f of files) m.set(normBase(f.name), f);
  return m;
};

const readBuffer = (f: File, onProgress?: (p: number) => void): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error(`Falha ao ler ${f.name}`));
    r.readAsArrayBuffer(f);
  });

const readText = async (f: File): Promise<string> => new TextDecoder().decode(await f.arrayBuffer());

/**
 * Importa. Lança Error com mensagem legível (tratada pela UI). Nunca toca no
 * cache do loader do simulador — recursos importados são independentes.
 */
export async function importFiles(
  files: File[],
  onProgress?: (pct: number, stage: string) => void
): Promise<ImportResult> {
  const sel = validateSelection(files);
  if (!sel.ok) throw new Error(sel.errors.join(" · "));
  const map = byName(files);
  const main = map.get(normBase(sel.mainName!))!;
  const warnings = [...sel.warnings];
  const urls: string[] = [];
  let parseInput: ArrayBuffer | string;
  let bytes = main.size;

  if (sel.mainKind === "glb") {
    onProgress?.(8, `lendo ${main.name}…`);
    parseInput = await readBuffer(main, (p) => onProgress?.(8 + p * 55, `lendo ${main.name}…`));
  } else {
    onProgress?.(6, `lendo ${main.name}…`);
    const text = await readText(main);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON do .gltf inválido: ${e instanceof Error ? e.message : "?"}`);
    }
    onProgress?.(20, "resolvendo arquivos associados…");
    const { buffers, images } = collectExternalUris(json);
    const missingBuffers: string[] = [];
    const missingImages: string[] = [];
    const rewrite = (uri: string, sink: string[]) => {
      const hit = matchCompanion(uri, new Set(map.keys()));
      if (!hit) {
        sink.push(normBase(uri));
        return uri;
      }
      const url = URL.createObjectURL(map.get(hit)!);
      urls.push(url);
      return url;
    };
    const j = json as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    for (const b of j.buffers ?? []) if (b.uri) b.uri = rewrite(b.uri, missingBuffers);
    for (const im of j.images ?? []) if (im.uri) im.uri = rewrite(im.uri, missingImages);
    if (missingBuffers.length) {
      revokeAll(urls);
      throw new Error(`Dependências ausentes no GLTF: ${[...new Set(missingBuffers)].join(", ")} — selecione também os .bin do modelo.`);
    }
    if (missingImages.length) warnings.push(`Texturas não encontradas (material ficará neutro): ${[...new Set(missingImages)].join(", ")}`);
    parseInput = JSON.stringify(json);
  }

  onProgress?.(68, "decodindo glTF…");
  const loader = new GLTFLoader();
  // manager sem CORS: object URLs são locais
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    try {
      loader.parse(parseInput as ArrayBuffer, "", (g) => resolve({ scene: g.scene as THREE.Group, animations: g.animations ?? [] }), (err) =>
        reject(err instanceof Error ? err : new Error(String(err)))
      );
    } catch (e) {
      reject(e);
    }
  }).catch((e: unknown) => {
    revokeAll(urls);
    throw new Error(`Falha ao decodificar o modelo: ${e instanceof Error ? e.message : String(e)}`);
  });

  onProgress?.(90, "verificando geometria…");
  let anyGeo = false;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && (m.geometry.getAttribute("position")?.count ?? 0) > 0) anyGeo = true;
  });
  if (!anyGeo) {
    revokeAll(urls);
    throw new Error("Modelo sem geometria — o arquivo não contém malhas utilizáveis.");
  }
  const stats = computeStats(gltf.scene);
  if (stats.triangles >= TRI_HARD) {
    revokeAll(urls);
    throw new Error(`Modelo excessivamente complexo (${stats.triangles.toLocaleString("pt-BR")} triângulos > limite de ${TRI_HARD.toLocaleString("pt-BR")}).`);
  }
  if (stats.triangles >= TRI_WARN) warnings.push(`Complexidade alta: ${stats.triangles.toLocaleString("pt-BR")} triângulos — inspeção pode ficar pesada neste dispositivo.`);

  // companions já foram consumidos pela decodificação; nada a manter vivo
  revokeAll(urls);
  onProgress?.(100, "pronto");
  return { root: gltf.scene, clips: gltf.animations, warnings, bytes, name: main.name, urls: [] };
}

export function revokeAll(urls: string[]) {
  for (const u of urls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* noop */
    }
  }
}

/**
 * Libera GPU/CPU de uma árvore: geometrias, materiais (e todas as texturas
 * conhecidas), sem tocar em objetos compartilhados marcados com userData.shared.
 */
export function disposeImported(root: THREE.Object3D | null) {
  if (!root) return;
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.userData.shared) geos.add(m.geometry);
    const mat = (m as THREE.Mesh).material;
    const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const mm of list) {
      if (mm.userData.shared) continue;
      mats.add(mm);
      for (const slot of [
        "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "bumpMap", "lightMap", "displacementMap",
      ] as const) {
        const t = (mm as unknown as Record<string, THREE.Texture | undefined>)[slot];
        if (t && !t.userData.shared) texs.add(t);
      }
    }
  });
  for (const t of texs) t.dispose();
  for (const mt of mats) mt.dispose();
  for (const g of geos) g.dispose();
  root.parent?.remove(root);
  root.clear();
}

/** texturas de um material (nome do slot → textura definida) */
export function materialTextureSlots(mat: THREE.Material): { slot: string; tex: THREE.Texture }[] {
  const out: { slot: string; tex: THREE.Texture }[] = [];
  const m = mat as unknown as Record<string, THREE.Texture | undefined>;
  const label: Record<string, string> = {
    map: "Base Color",
    normalMap: "Normal",
    roughnessMap: "Roughness",
    metalnessMap: "Metalness",
    emissiveMap: "Emissive",
    aoMap: "AO",
    alphaMap: "Alpha",
    bumpMap: "Bump",
  };
  for (const [k, name] of Object.entries(label)) {
    const t = m[k];
    if (t) out.push({ slot: name, tex: t });
  }
  return out;
}
