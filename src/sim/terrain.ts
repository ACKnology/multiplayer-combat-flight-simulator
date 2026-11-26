import * as THREE from "three";
import { GeoFrame, ElevationCache, loadImage, tileUrls, MAP_PROVIDERS, type MapProvider } from "./geo";

export type Quality = "low" | "medium" | "high";

export interface FlatZone { cx: number; cz: number; ux: number; uz: number; halfLen: number; halfWid: number }

// ---- amostrador global (usado por física, armas, IA) ----
let active: Terrain | null = null;
export function setActiveTerrain(t: Terrain | null) { active = t; }
/**
 * Nível do "plateau" do aeroporto: dentro das zonas planas o terreno (físico E
 * renderizado — a mesma função!) é elevado a +0,12 m, e os planos pintados
 * (pista/taxiway/pátio) flutuam ~1,2 cm acima. Como a ordem de desenho é fixa
 * (terreno → decks, via renderOrder), empates de quantização viram vitórias
 * determinísticas do deck — o flickering era exatamente um empate indeterminado.
 */
export const DECK_LEVEL = 0.12;
export function groundHeight(x: number, z: number): number {
  return active ? active.height(x, z) : 0;
}
export function isWater(x: number, z: number): boolean { return active ? active.isWater(x, z) : false; }

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function n2(x: number, z: number) {
  return (
    Math.sin(x * 0.00042 + 1.7) * Math.cos(z * 0.00038 - 0.6) +
    0.5 * Math.sin(x * 0.0011 - 3.1) * Math.cos(z * 0.0009 + 2.2) +
    0.25 * Math.sin(x * 0.0027 + 0.4) * Math.sin(z * 0.0031)
  );
}

interface TileEntry {
  key: string; z: number; x: number; y: number;
  mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; tex: THREE.Texture | null;
  pendingElev: boolean; state: "queued" | "loading" | "done" | "error"; prio: number;
}

export class Terrain {
  readonly mode: "procedural" | "map";
  readonly group = new THREE.Group();
  readonly elev = new ElevationCache();
  readonly frame: GeoFrame;
  readonly elevM: number;
  readonly zones: FlatZone[];
  readonly provider: MapProvider;
  readonly quality: Quality;
  lakes: { x: number; z: number; r: number }[] = [];
  coastal = false;
  readonly seaY: number;
  private tiles = new Map<string, TileEntry>();
  private queue: TileEntry[] = [];
  private inflight = 0;
  private placeholder: THREE.DataTexture;
  private anisotropy: number;
  private centerKey = "";
  private lastUpdate = 0;
  private lastElevVersion = 0;
  private disposed = false;
  private grid: Float32Array | null = null;
  private gridN = 0;
  private gridSize = 0;

  constructor(o: { frame: GeoFrame; elevM: number; zones: FlatZone[]; provider: MapProvider; quality: Quality; anisotropy: number }) {
    this.frame = o.frame;
    this.elevM = o.elevM;
    this.zones = o.zones;
    this.provider = o.provider;
    this.quality = o.quality;
    this.anisotropy = o.anisotropy;
    this.mode = o.provider === "procedural" ? "procedural" : "map";
    this.seaY = -o.elevM;
    this.placeholder = new THREE.DataTexture(new Uint8Array([92, 106, 80, 255]), 1, 1);
    this.placeholder.colorSpace = THREE.SRGBColorSpace;
    this.placeholder.needsUpdate = true;
  }

  // ------------------------------------------------------------ amostragem
  height(x: number, z: number): number {
    return this.rawHeight(x, z) + DECK_LEVEL * this.flatWeight(x, z);
  }
  /** superfície crua (sem plateau), usada pelo build da grade procedural */
  rawHeight(x: number, z: number): number {
    if (this.mode === "procedural" && this.grid) {
      const half = this.gridSize / 2;
      const step = this.gridSize / (this.gridN - 1);
      const fx = (x + half) / step, fz = (z + half) / step;
      if (fx >= 0 && fz >= 0 && fx < this.gridN - 1 && fz < this.gridN - 1) {
        const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, n = this.gridN, g = this.grid;
        return (g[iz * n + ix] * (1 - ax) + g[iz * n + ix + 1] * ax) * (1 - az) + (g[(iz + 1) * n + ix] * (1 - ax) + g[(iz + 1) * n + ix + 1] * ax) * az;
      }
    }
    const w = this.flatWeight(x, z);
    if (w >= 1) return 0;
    let h: number;
    if (this.mode === "map") {
      const [mx, my] = this.frame.toMerc(x, z);
      const e = this.elev.sample(mx, my);
      h = e === null ? 0 : Math.max(e, 0) - this.elevM;
    } else {
      h = this.procHeight(x, z);
    }
    return h * (1 - w);
  }

  isWaterRaw(x: number, z: number): boolean {
    if (this.mode === "map") {
      const [mx, my] = this.frame.toMerc(x, z);
      const e = this.elev.sample(mx, my);
      return e !== null && e <= 0.5;
    }
    return this.lakes.some((l) => (x - l.x) ** 2 + (z - l.z) ** 2 < (l.r * 0.75) ** 2);
  }

  isWater(x: number, z: number): boolean {
    if (this.flatWeight(x, z) > 0.3) return false;
    return this.isWaterRaw(x, z);
  }

  flatWeight(x: number, z: number): number {
    let w = 0;
    for (const f of this.zones) {
      const dx = x - f.cx, dz = z - f.cz;
      const a = Math.abs(dx * f.ux + dz * f.uz) - f.halfLen;
      const c = Math.abs(-dx * f.uz + dz * f.ux) - f.halfWid;
      const d = Math.hypot(Math.max(a, 0), Math.max(c, 0));
      const ww = 1 - smooth(0, this.mode === "map" ? 1000 : 1600, d);
      if (ww > w) w = ww;
      if (w >= 1) break;
    }
    return w;
  }

  procHeight(x: number, z: number): number {
    const d = Math.hypot(x, z);
    const hills = Math.max(0, n2(x, z)) * 380 * smooth(2500, 8000, d);
    const ridge = Math.max(0, n2(x * 0.45 + 9000, z * 0.45 - 4000)) * 1400 * smooth(9000, 19000, d);
    let h = hills + ridge;
    for (const l of this.lakes) {
      const ld = Math.hypot(x - l.x, z - l.z);
      if (ld < l.r) h = THREE.MathUtils.lerp(h, -22, 1 - smooth(l.r * 0.55, l.r, ld));
    }
    return h;
  }

  // ------------------------------------------------------------ inicialização
  async init(onProgress: (text: string, pct: number) => void): Promise<void> {
    if (this.mode === "procedural") {
      this.buildProcedural();
      onProgress("Terreno procedural gerado", 1);
      return;
    }
    const [mx, my] = this.frame.toMerc(0, 0);
    const reqs = this.elevTiles(mx, my);
    let done = 0;
    onProgress("Baixando relevo real (AWS Terrain Tiles)…", 0.02);
    await Promise.race([
      Promise.all(
        reqs.map(([z, x, y]) =>
          this.elev.request(z, x, y).then(() => {
            done++;
            onProgress(`Relevo real ${done}/${reqs.length}`, 0.02 + (0.33 * done) / reqs.length);
          })
        )
      ),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
    this.lastElevVersion = this.elev.version;
    this.detectCoast();
    this.centerKey = "";
    this.sync(0, 0);
    const name = MAP_PROVIDERS.find((p) => p.id === this.provider)?.name ?? this.provider;
    const t0 = performance.now();
    while (!this.disposed && performance.now() - t0 < 14000) {
      const all = [...this.tiles.values()];
      const near = all.filter((t) => t.z === 15);
      const fin = (t: TileEntry) => t.state === "done" || t.state === "error";
      const loaded = all.filter(fin).length;
      onProgress(`Imagens ${name}: ${loaded}/${all.length} tiles`, 0.35 + (0.65 * loaded) / Math.max(1, all.length));
      if (near.filter(fin).length >= near.length * 0.9 && loaded >= all.length * 0.6) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private detectCoast() {
    let sea = 0, tot = 0;
    for (let i = -12; i <= 12; i++)
      for (let j = -12; j <= 12; j++) {
        const [mx, my] = this.frame.toMerc(i * 1800, j * 1800);
        const e = this.elev.sample(mx, my);
        if (e === null) continue;
        tot++;
        if (e <= 0.5) sea++;
      }
    this.coastal = tot > 0 && sea > 6;
  }

  // ------------------------------------------------------------ procedural
  private buildProcedural() {
    // lago em local livre de pistas
    for (const [lx, lz] of [[-5200, 5600], [5600, 5200], [-5600, -5200], [5200, -5600]]) {
      if (this.flatWeight(lx, lz) < 0.02) {
        this.lakes.push({ x: lx, z: lz, r: 1500 });
        break;
      }
    }
    const size = 60000;
    const seg = this.quality === "low" ? 150 : this.quality === "medium" ? 210 : 270;
    const n = seg + 1;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grid = new Float32Array(n * n);
    const cGrass = new THREE.Color(0x4a6a30), cGrass2 = new THREE.Color(0x5f7a38), cFarm = new THREE.Color(0x8b8a4c),
      cDry = new THREE.Color(0x9a8f5e), cRock = new THREE.Color(0x6f675d), cSnow = new THREE.Color(0xeef2f5),
      cSand = new THREE.Color(0xa99b6c), cForest = new THREE.Color(0x2f4a22);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // o grid armazena o valor CRU (o plateau é somado por height() na leitura,
      // exatamente como em rawHeight → height dos tiles: mesma superfície física)
      const h = this.procHeight(x, z) * (1 - this.flatWeight(x, z));
      pos.setY(i, h);
      grid[i] = h;
      const v = n2(x * 2.1 + 500, z * 2.1 - 300);
      const v2 = n2(x * 5.3 - 900, z * 4.7 + 1200);
      tmp.copy(v > 0.45 ? cFarm : v > 0.2 ? cDry : v < -0.55 ? cForest : v2 > 0.3 ? cGrass2 : cGrass);
      if (h > 420) tmp.lerp(cRock, smooth(420, 1000, h));
      if (h > 1150) tmp.lerp(cSnow, smooth(1150, 1600, h));
      if (this.flatWeight(x, z) > 0.5) tmp.lerp(cSand, 0.18);
      for (const l of this.lakes) {
        const ld = Math.hypot(x - l.x, z - l.z);
        if (ld < l.r * 1.1) tmp.lerp(cSand, 1 - smooth(l.r * 0.8, l.r * 1.1, ld));
      }
      tmp.multiplyScalar(0.9 + Math.random() * 0.18);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.grid = grid;
    this.gridN = n;
    this.gridSize = size;

    // textura de detalhe (ruído) multiplicada pelas cores
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const c = cv.getContext("2d")!;
    const img = c.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const g = 205 + Math.random() * 50;
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 90; i++) {
      c.fillStyle = `rgba(${60 + Math.random() * 60},${70 + Math.random() * 50},40,0.12)`;
      c.beginPath();
      c.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 18, 0, Math.PI * 2);
      c.fill();
    }
    const detail = new THREE.CanvasTexture(cv);
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.repeat.set(size / 70, size / 70);
    detail.colorSpace = THREE.SRGBColorSpace;
    detail.anisotropy = this.anisotropy;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 1, metalness: 0 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ tiles de mapa (LOD)
  private blocks(mx: number, my: number) {
    const c10x = Math.floor(mx * 1024), c10y = Math.floor(my * 1024);
    const half = (f: number) => Math.floor(f) - (f - Math.floor(f) < 0.5 ? 1 : 0);
    return { c10x, c10y, b11x: half(mx * 2048), b11y: half(my * 2048), b13x: half(mx * 8192), b13y: half(my * 8192) };
  }

  private elevTiles(mx: number, my: number): [number, number, number][] {
    const b = this.blocks(mx, my);
    const out: [number, number, number][] = [];
    for (let x = b.b11x * 2; x < b.b11x * 2 + 4; x++) for (let y = b.b11y * 2; y < b.b11y * 2 + 4; y++) out.push([12, x, y]);
    for (let x = b.c10x - 1; x <= b.c10x + 1; x++) for (let y = b.c10y - 1; y <= b.c10y + 1; y++) out.push([10, x, y]);
    return out;
  }

  private desired(mx: number, my: number) {
    const b = this.blocks(mx, my);
    const out: { z: number; x: number; y: number }[] = [];
    for (let x = b.c10x * 2 - 2; x <= b.c10x * 2 + 3; x++)
      for (let y = b.c10y * 2 - 2; y <= b.c10y * 2 + 3; y++) {
        if (x >= b.b11x && x <= b.b11x + 1 && y >= b.b11y && y <= b.b11y + 1) continue;
        out.push({ z: 11, x, y });
      }
    for (let x = b.b11x * 4; x < b.b11x * 4 + 8; x++)
      for (let y = b.b11y * 4; y < b.b11y * 4 + 8; y++) {
        if (x >= b.b13x && x <= b.b13x + 1 && y >= b.b13y && y <= b.b13y + 1) continue;
        out.push({ z: 13, x, y });
      }
    for (let x = b.b13x * 4; x < b.b13x * 4 + 8; x++) for (let y = b.b13y * 4; y < b.b13y * 4 + 8; y++) out.push({ z: 15, x, y });
    return { out, key: `${b.c10x},${b.c10y},${b.b11x},${b.b11y},${b.b13x},${b.b13y}` };
  }

  private segFor(z: number) {
    const q = this.quality === "low" ? 0.6 : this.quality === "medium" ? 0.85 : 1;
    return Math.round((z >= 15 ? 18 : z >= 13 ? 22 : 18) * q);
  }

  private elevReady(x0: number, z0: number, size: number, tz: number): boolean {
    const need = tz >= 13 ? 12 : 10;
    const n = 2 ** need;
    for (const [px, pz] of [[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]]) {
      const [mx, my] = this.frame.toMerc(Math.min(px, x0 + size - 1), Math.min(pz, z0 + size - 1));
      if (!this.elev.settled(need, Math.floor(mx * n), Math.floor(my * n))) return false;
    }
    return true;
  }

  private tileGeometry(x0: number, z0: number, size: number, seg: number, tz: number) {
    const n = seg + 1, m = n + 2, step = size / seg;
    const cx = x0 + size / 2, cz = z0 + size / 2;
    const H = new Float32Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) H[j * m + i] = this.height(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const vCount = n * n + 8 * n;
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos[k * 3] = x0 + i * step - cx;
        pos[k * 3 + 1] = H[(j + 1) * m + i + 1];
        pos[k * 3 + 2] = z0 + j * step - cz;
        const nx = H[(j + 1) * m + i] - H[(j + 1) * m + i + 2];
        const nz = H[j * m + i + 1] - H[(j + 2) * m + i + 1];
        const ny = 2 * step;
        const L = Math.hypot(nx, ny, nz);
        nor[k * 3] = nx / L;
        nor[k * 3 + 1] = ny / L;
        nor[k * 3 + 2] = nz / L;
        uv[k * 2] = i / seg;
        uv[k * 2 + 1] = 1 - j / seg;
      }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    // saias para esconder frestas entre níveis de LOD
    const edges = [
      Array.from({ length: n }, (_, i) => i),
      Array.from({ length: n }, (_, i) => (n - 1) * n + i),
      Array.from({ length: n }, (_, j) => j * n),
      Array.from({ length: n }, (_, j) => j * n + n - 1),
    ];
    const drop = 25 + size * 0.004;
    let v = n * n;
    for (const e of edges) {
      const top = v;
      for (const k of e) {
        pos.copyWithin(v * 3, k * 3, k * 3 + 3);
        nor.copyWithin(v * 3, k * 3, k * 3 + 3);
        uv.copyWithin(v * 2, k * 2, k * 2 + 2);
        v++;
      }
      const bot = v;
      for (const k of e) {
        pos.copyWithin(v * 3, k * 3, k * 3 + 3);
        pos[v * 3 + 1] -= drop;
        nor.copyWithin(v * 3, k * 3, k * 3 + 3);
        uv.copyWithin(v * 2, k * 2, k * 2 + 2);
        v++;
      }
      for (let t = 0; t < n - 1; t++) {
        const a = top + t, b = top + t + 1, c = bot + t, d = bot + t + 1;
        idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return { geo, pending: !this.elevReady(x0, z0, size, tz) };
  }

  private makeTile(z: number, x: number, y: number): TileEntry {
    const o = this.frame.tileOrigin(z, x, y);
    const size = this.frame.tileSize(z);
    const { geo, pending } = this.tileGeometry(o.x, o.z, size, this.segFor(z), z);
    // albedo levemente reduzido: as imagens de satélite já trazem iluminação "assada"
    const mat = new THREE.MeshStandardMaterial({ map: this.placeholder, color: 0xb4b4b4, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.x + size / 2, 0, o.z + size / 2);
    mesh.receiveShadow = z >= 15;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return { key: `${z}/${x}/${y}`, z, x, y, mesh, mat, tex: null, pendingElev: pending, state: "queued", prio: 0 };
  }

  private sync(px: number, pz: number) {
    const [mx, my] = this.frame.toMerc(px, pz);
    const { out, key } = this.desired(mx, my);
    if (key === this.centerKey) return;
    this.centerKey = key;
    const want = new Set(out.map((t) => `${t.z}/${t.x}/${t.y}`));
    for (const [k, t] of this.tiles) {
      if (want.has(k)) continue;
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mat.dispose();
      t.tex?.dispose();
      this.tiles.delete(k);
    }
    for (const w of out) {
      const k = `${w.z}/${w.x}/${w.y}`;
      if (this.tiles.has(k)) continue;
      const t = this.makeTile(w.z, w.x, w.y);
      this.tiles.set(k, t);
      this.queue.push(t);
    }
    for (const t of this.queue) {
      const o = this.frame.tileOrigin(t.z, t.x, t.y), s = this.frame.tileSize(t.z);
      const d = Math.hypot(o.x + s / 2 - px, o.z + s / 2 - pz);
      t.prio = d / (t.z >= 15 ? 5 : t.z >= 13 ? 1.6 : 1);
    }
    this.queue = this.queue.filter((t) => this.tiles.has(t.key) && t.state === "queued").sort((a, b) => a.prio - b.prio);
    for (const [z, x, y] of this.elevTiles(mx, my)) void this.elev.request(z, x, y);
    this.pump();
  }

  private pump() {
    while (this.inflight < 10 && this.queue.length) {
      const t = this.queue.shift()!;
      if (t.state !== "queued" || !this.tiles.has(t.key)) continue;
      t.state = "loading";
      this.inflight++;
      loadImage(tileUrls(this.provider, t.z, t.x, t.y))
        .then((img) => {
          if (this.disposed || !this.tiles.has(t.key)) return;
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = this.anisotropy;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          t.tex = tex;
          t.mat.map = tex;
          t.state = "done";
        })
        .catch(() => {
          t.state = "error";
          t.mat.color.setHex(0x7d8a6a);
        })
        .finally(() => {
          this.inflight--;
          if (!this.disposed) this.pump();
        });
    }
  }

  /** chamado a cada quadro; trabalho pesado limitado a 1x/s */
  update(px: number, pz: number, now: number) {
    if (this.mode !== "map" || now - this.lastUpdate < 1000) return;
    this.lastUpdate = now;
    this.sync(px, pz);
    if (this.elev.version !== this.lastElevVersion) {
      this.lastElevVersion = this.elev.version;
      let rebuilt = 0;
      for (const t of this.tiles.values()) {
        if (!t.pendingElev) continue;
        const o = this.frame.tileOrigin(t.z, t.x, t.y), size = this.frame.tileSize(t.z);
        const { geo, pending } = this.tileGeometry(o.x, o.z, size, this.segFor(t.z), t.z);
        t.mesh.geometry.dispose();
        t.mesh.geometry = geo;
        t.pendingElev = pending;
        if (++rebuilt >= 14) {
          this.lastElevVersion = -1;
          break;
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const t of this.tiles.values()) {
      t.mesh.geometry.dispose();
      t.mat.dispose();
      t.tex?.dispose();
    }
    this.tiles.clear();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}