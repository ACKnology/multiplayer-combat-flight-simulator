// Georreferenciamento: Web Mercator ↔ mundo local (metros), tiles de mapa e relevo real (Terrarium).
export type MapProvider = "esri" | "google" | "osm" | "procedural";

export const MAP_PROVIDERS: { id: MapProvider; name: string; desc: string; needsKey?: boolean }[] = [
  { id: "esri", name: "Satélite (Esri)", desc: "Imagens de satélite mundiais + relevo real 3D" },
  { id: "google", name: "Google Satélite", desc: "Google Map Tiles API + relevo real (requer GOOGLE_MAPS_API_KEY)", needsKey: true },
  { id: "osm", name: "OpenStreetMap", desc: "Mapa de ruas como textura de solo + relevo real" },
  { id: "procedural", name: "Procedural", desc: "Terreno gerado, cidade e floresta 3D (offline, mais leve)" },
];

const EARTH = 40075016.686;
const D2R = Math.PI / 180;

export function merc(lat: number, lon: number): [number, number] {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * D2R);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function unmerc(mx: number, my: number): [number, number] {
  const n = Math.PI - 2 * Math.PI * my;
  return [Math.atan(Math.sinh(n)) / D2R, mx * 360 - 180];
}

/** tile (x,y) e posição fracionária dentro do tile */
export function tileOf(lat: number, lon: number, z: number) {
  const [mx, my] = merc(lat, lon);
  const n = 2 ** z;
  const fx = mx * n, fy = my * n;
  return { x: Math.floor(fx), y: Math.floor(fy), fx: fx - Math.floor(fx), fy: fy - Math.floor(fy) };
}

/**
 * Plano tangente local: x = leste (m), z = sul (m). Mapeamento linear da projeção Mercator,
 * de modo que imagens, relevo e pistas ficam perfeitamente consistentes entre si.
 */
export class GeoFrame {
  readonly lat0: number;
  readonly lon0: number;
  readonly mx0: number;
  readonly my0: number;
  readonly S: number; // metros por unidade mercator na latitude de referência

  constructor(lat: number, lon: number) {
    this.lat0 = lat;
    this.lon0 = lon;
    [this.mx0, this.my0] = merc(lat, lon);
    this.S = EARTH * Math.cos(lat * D2R);
  }
  toWorld(lat: number, lon: number) {
    const [mx, my] = merc(lat, lon);
    return { x: (mx - this.mx0) * this.S, z: (my - this.my0) * this.S };
  }
  toMerc(x: number, z: number): [number, number] {
    return [this.mx0 + x / this.S, this.my0 + z / this.S];
  }
  toLatLon(x: number, z: number): [number, number] {
    return unmerc(this.mx0 + x / this.S, this.my0 + z / this.S);
  }
  tileSize(z: number) {
    return this.S / 2 ** z;
  }
  tileOrigin(z: number, tx: number, ty: number) {
    const n = 2 ** z;
    return { x: (tx / n - this.mx0) * this.S, z: (ty / n - this.my0) * this.S };
  }
}

export function tileUrls(provider: string, z: number, x: number, y: number): string[] {
  const proxy = `/api/tiles/${provider}/${z}/${x}/${y}`;
  switch (provider) {
    case "esri":
      return [`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, proxy];
    case "osm":
      return [`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, proxy];
    case "terrarium":
      return [`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, proxy];
    default:
      return [proxy];
  }
}

export function loadImage(urls: string[], timeoutMs = 15000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) {
        reject(new Error("tile indisponível"));
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        img.src = "";
        i++;
        next();
      }, timeoutMs);
      img.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        i++;
        next();
      };
      img.src = urls[i];
    };
    next();
  });
}

/** Cache de elevação real (AWS Terrain Tiles, codificação Terrarium). */
export class ElevationCache {
  private data = new Map<string, Float32Array>();
  private loading = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  version = 0;
  readonly zooms = [12, 10];

  has(z: number, x: number, y: number) {
    return this.data.has(`${z}/${x}/${y}`);
  }

  /** carregado OU falhou (não vale a pena esperar) */
  settled(z: number, x: number, y: number) {
    const k = `${z}/${x}/${y}`;
    return this.data.has(k) || this.failed.has(k);
  }

  request(z: number, x: number, y: number): Promise<void> {
    const k = `${z}/${x}/${y}`;
    if (this.data.has(k) || this.failed.has(k)) return Promise.resolve();
    const ex = this.loading.get(k);
    if (ex) return ex;
    const p = loadImage(tileUrls("terrarium", z, x, y))
      .then((img) => {
        const cv = document.createElement("canvas");
        cv.width = 256;
        cv.height = 256;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("canvas");
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        this.data.set(k, out);
        this.version++;
      })
      .catch(() => {
        this.failed.add(k);
      })
      .finally(() => {
        this.loading.delete(k);
      });
    this.loading.set(k, p);
    return p;
  }

  /** elevação MSL (m) por interpolação bilinear; null se ainda não carregada */
  sample(mx: number, my: number): number | null {
    for (const z of this.zooms) {
      const n = 2 ** z;
      const fx = mx * n, fy = my * n;
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const d = this.data.get(`${z}/${tx}/${ty}`);
      if (!d) continue;
      const px = Math.min(255, Math.max(0, (fx - tx) * 256 - 0.5));
      const py = Math.min(255, Math.max(0, (fy - ty) * 256 - 0.5));
      const x0 = Math.floor(px), y0 = Math.floor(py);
      const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
      const ax = px - x0, ay = py - y0;
      return (
        (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) +
        (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay
      );
    }
    return null;
  }
}