import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { Airport } from "./airports";
import type { GeoFrame } from "./geo";
import { groundHeight, type FlatZone, type Terrain, type Quality } from "./terrain";
import type { DamageRegistry, Damageable, Team } from "./damage";
import { type FX } from "./fx";
import { CloudField } from "./clouds";
import { byId } from "./aircraft";
import { buildAircraft } from "./models";
import type { Scars } from "./scars";
import { solarPosition, sunVec, type Weather } from "./weather";

export type TimeOfDay = "day" | "sunset" | "night";

export interface RunwayW {
  leId: string; heId: string; lx: number; lz: number; hx: number; hz: number;
  cx: number; cz: number; len: number; wid: number; ux: number; uz: number; rotY: number;
}

export interface Layout {
  runways: RunwayW[];
  active: RunwayW;
  activeIdent: string;
  thr: THREE.Vector3;
  dir: THREE.Vector3; // sentido de pouso/decolagem
  right: THREE.Vector3;
  spawn: THREE.Vector3;
  spawnRotY: number;
  apron: THREE.Vector3;
  out: THREE.Vector3; // da pista para o pátio
  tower: THREE.Vector3; // olho do controlador
  papi: THREE.Vector3;
}

export function computeLayout(ap: Airport, ident: string, frame: GeoFrame): Layout {
  const runways: RunwayW[] = ap.runways.map((r) => {
    const a = frame.toWorld(r.le.lat, r.le.lon), b = frame.toWorld(r.he.lat, r.he.lon);
    const dx = b.x - a.x, dz = b.z - a.z, lenC = Math.hypot(dx, dz);
    const ux = dx / lenC, uz = dz / lenC;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    // algumas bases marcam cabeceiras deslocadas: usa o comprimento publicado do pavimento
    const len = Math.max(lenC, r.lengthM);
    return {
      leId: r.le.ident, heId: r.he.ident, lx: cx - (ux * len) / 2, lz: cz - (uz * len) / 2, hx: cx + (ux * len) / 2, hz: cz + (uz * len) / 2,
      cx, cz, len, wid: r.widthM, ux, uz, rotY: Math.atan2(-uz, ux),
    };
  });
  const active = runways.find((r) => r.leId === ident || r.heId === ident) ?? runways[0];
  const fromHe = active.heId === ident;
  const dir = fromHe ? new THREE.Vector3(-active.ux, 0, -active.uz) : new THREE.Vector3(active.ux, 0, active.uz);
  const thr = fromHe ? new THREE.Vector3(active.hx, 0, active.hz) : new THREE.Vector3(active.lx, 0, active.lz);
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const out = right.clone().multiplyScalar(ap.terminalSide);
  const center = new THREE.Vector3(active.cx, 0, active.cz);
  return {
    runways, active, activeIdent: fromHe ? active.heId : active.leId, thr, dir, right,
    spawn: thr.clone().addScaledVector(dir, 140), spawnRotY: Math.atan2(-dir.x, -dir.z),
    apron: center.clone().addScaledVector(out, active.wid / 2 + 300), out, tower: center.clone(),
    papi: thr.clone().addScaledVector(dir, 300).addScaledVector(right, -(active.wid / 2 + 15)),
  };
}

export function flatZones(l: Layout): FlatZone[] {
  return l.runways.map((r) => ({ cx: r.cx, cz: r.cz, ux: r.ux, uz: r.uz, halfLen: r.len / 2 + 300, halfWid: r.wid / 2 + 480 }));
}

export function insideRunway(l: Layout, x: number, z: number, margin: number): RunwayW | null {
  for (const r of l.runways) {
    const dx = x - r.cx, dz = z - r.cz;
    if (Math.abs(dx * r.ux + dz * r.uz) < r.len / 2 + margin && Math.abs(-dx * r.uz + dz * r.ux) < r.wid / 2 + margin) return r;
  }
  return null;
}

/** pátio/torre em área livre (fora de pistas e da água) */
export function placeFacilities(l: Layout, terrain: Terrain, side: 1 | -1) {
  const center = new THREE.Vector3(l.active.cx, 0, l.active.cz);
  for (const s of [side, -side]) {
    const out = l.right.clone().multiplyScalar(s);
    for (const d of [300, 420, 560, 720, 900, 1100]) {
      for (const along of [0, -0.18, 0.18, -0.32, 0.32]) {
        const p = center.clone().addScaledVector(out, l.active.wid / 2 + d).addScaledVector(l.dir, along * l.active.len);
        let ok = true;
        for (const [a, o] of [[0, 0], [-260, 0], [260, 0], [0, 190], [-220, 190], [330, 150], [0, -50]]) {
          const q = p.clone().addScaledVector(l.dir, a).addScaledVector(out, o);
          if (insideRunway(l, q.x, q.z, 80) || terrain.isWaterRaw(q.x, q.z)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          l.apron.copy(p);
          l.out.copy(out);
          l.tower.copy(p).addScaledVector(l.dir, 120).addScaledVector(out, 130);
          return;
        }
      }
    }
  }
  l.tower.copy(l.apron).addScaledVector(l.dir, 120).addScaledVector(l.out, 130);
}

export interface World {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  lightDir: THREE.Vector3;
  layout: Layout;
  clouds: CloudField;
  state: { elev: number; dark: number; daylight: number; over: number; baseFogDensity: number; baseFogColor: THREE.Color };
  towerAlive: () => boolean;
  setEnvironment(date: Date, wx: Weather): void;
  setGlare(k: number): void;
  /** Reposiciona a luz solar ancorada no jogador com SNAP à grade de texels da
   *  shadow map — elimina o "crawling" (sombras que tremulam no solo a cada fração
   *  de texel de movimento), segunda fonte real do flickering. */
  updateShadow(anchor: THREE.Vector3): void;
  update(dt: number, t: number, camera: THREE.Camera, eye: THREE.Vector3, wind: THREE.Vector3, playerPos?: THREE.Vector3, inCloud?: number, isCB?: boolean): void;
}

// ---------------------------------------------------------------- texturas
function runwayTexture(len: number, wid: number, leId: string, heId: string): THREE.CanvasTexture {
  const cw = 4096, ch = Math.max(64, Math.min(256, Math.round((cw * wid) / len) * 2));
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#33363b";
  c.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.random() * 40;
    c.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
    c.fillRect(Math.random() * cw, Math.random() * ch, 2, 2);
  }
  for (const base of [0, cw]) {
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(12,12,12,${0.05 + Math.random() * 0.1})`;
      const x = base === 0 ? (300 + Math.random() * 700) * (cw / len) : cw - (300 + Math.random() * 700) * (cw / len);
      c.fillRect(x, ch * (0.36 + Math.random() * 0.28), (20 + Math.random() * 90) * (cw / len), ch * 0.03);
    }
  }
  const sx = cw / len, sy = ch / wid;
  c.save();
  c.scale(sx, sy);
  c.fillStyle = "#e9e9e4";
  c.fillRect(0, 1.2, len, 0.9);
  c.fillRect(0, wid - 2.1, len, 0.9);
  for (let a = 80; a < len - 100; a += 50) c.fillRect(a, wid / 2 - 0.45, 30, 0.9);
  const stripes = wid >= 55 ? 16 : wid >= 44 ? 12 : wid >= 29 ? 8 : 6;
  const span = stripes * 3.6;
  for (const end of [0, 1]) {
    for (let i = 0; i < stripes; i++) {
      const cpos = wid / 2 - span / 2 + i * 3.6 + (i >= stripes / 2 ? 1.8 : 0) - 0.9;
      const a0 = end === 0 ? 6 : len - 36;
      c.fillRect(a0, cpos, 30, 1.8);
    }
    for (const dist of [150, 450, 600]) {
      const a0 = end === 0 ? dist : len - dist - 22.5;
      for (const sd of [-1, 1]) for (let k = 0; k < (dist === 150 ? 3 : 2); k++) c.fillRect(a0, wid / 2 + sd * (6 + k * 3.2) - 0.9, 22.5, 1.8);
    }
    const aimA = end === 0 ? 300 : len - 345;
    for (const sd of [-1, 1]) c.fillRect(aimA, wid / 2 + sd * Math.min(wid * 0.24, 11) - 3, 45, 6);
  }
  const drawId = (id: string, a: number, rot: number) => {
    const num = id.replace(/[LCRG]/g, "").padStart(2, "0");
    const letter = id.replace(/[0-9]/g, "");
    c.save();
    c.translate(a, wid / 2);
    c.rotate(rot);
    c.scale(0.62, 1);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "bold 18px sans-serif";
    c.fillText(num, 0, letter ? -10 : 0);
    if (letter) c.fillText(letter, 0, 11);
    c.restore();
  };
  drawId(leId, 64, Math.PI / 2);
  drawId(heId, len - 64, -Math.PI / 2);
  c.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function waterNormalTexture(): THREE.CanvasTexture {
  const s = 256, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(s, s);
  const h = (x: number, y: number) => {
    const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
    return Math.sin(u * 3 + v * 2) * 0.5 + Math.sin(u * 7 - v * 5) * 0.25 + Math.sin(u * 13 + v * 11) * 0.12 + Math.sin(-u * 5 + v * 9) * 0.2;
  };
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const i = (y * s + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixC = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// ---------------------------------------------------------------- construção
export function buildWorld(c: {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; airport: Airport; layout: Layout; terrain: Terrain;
  quality: Quality; registry: DamageRegistry; fx: FX; scars: Scars; wx: Weather;
}): World {
  const { scene, renderer, layout: L, terrain, quality, registry, fx, scars, wx: wx0 } = c;
  const ap = c.airport;
  const gy = (x: number, z: number) => groundHeight(x, z);
  const lightDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const sunDir = new THREE.Vector3(0, 1, 0), moonDir = new THREE.Vector3(0, 1, 0);
  const st = { elev: 30, dark: 0, daylight: 1, over: 0, baseFogDensity: 0.00003, baseFogColor: new THREE.Color(0xa9c1d9) };

  // ---- céu físico + ambiente PMREM
  const sky = new Sky();
  sky.scale.setScalar(40000);
  scene.add(sky);
  const sky2 = new Sky();
  sky2.scale.setScalar(1000);
  const envScene = new THREE.Scene();
  envScene.add(sky2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  scene.fog = new THREE.FogExp2(0xa9c1d9, 0.00003);
  scene.background = new THREE.Color(0xa9c1d9);

  const hemi = new THREE.HemisphereLight(0xbcd6f2, 0x5a5640, 0.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1db, 2);
  sun.castShadow = quality !== "low";
  const sm = quality === "high" ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -700; sc.right = 700; sc.top = 700; sc.bottom = -700; sc.near = 10; sc.far = 7000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);

  // domo de céu encoberto (cinza) para dias nublados/chuvosos
  const overDome = new THREE.Mesh(
    new THREE.SphereGeometry(36000, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9aa3ab, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false })
  );
  overDome.renderOrder = -1;
  scene.add(overDome);

  // estrelas e lua
  const nightGroup = new THREE.Group();
  const starMat = new THREE.PointsMaterial({ color: new THREE.Color(2.2, 2.3, 2.6), size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false });
  {
    const pts: number[] = [];
    for (let i = 0; i < 2200; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y > 0.02) pts.push(v.x * 30000, v.y * 30000, v.z * 30000);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    nightGroup.add(new THREE.Points(g, starMat));
  }
  const moonMat = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const cx = cv.getContext("2d")!;
    const gr = cx.createRadialGradient(64, 64, 20, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,250,235,1)");
    gr.addColorStop(0.45, "rgba(240,236,220,1)");
    gr.addColorStop(0.5, "rgba(200,210,255,0.35)");
    gr.addColorStop(1, "rgba(160,180,255,0)");
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 128, 128);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), fog: false, color: new THREE.Color(2.4, 2.4, 2.4), transparent: true, opacity: 0, depthWrite: false });
  })();
  const moon = new THREE.Sprite(moonMat);
  moon.scale.setScalar(1400);
  nightGroup.add(moon);
  scene.add(nightGroup);

  // nuvens dinâmicas em múltiplas camadas + cumulonimbus
  const clouds = new CloudField(quality, wx0);
  scene.add(clouds.mesh);

  // água
  let waterNormal: THREE.Texture | null = null;
  const waterMats: THREE.MeshStandardMaterial[] = [];
  const waterMat = (opacity: number, repeat: number) => {
    waterNormal = waterNormal ?? waterNormalTexture();
    waterNormal.repeat.set(repeat, repeat);
    const m = new THREE.MeshStandardMaterial({
      color: 0x1d4a63, roughness: 0.07, metalness: 0.1, normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35), transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    waterMats.push(m);
    return m;
  };
  if (terrain.mode === "map" && terrain.coastal) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(140000, 140000).rotateX(-Math.PI / 2), waterMat(0.5, 9000));
    w.position.y = terrain.seaY + 0.9;
    w.renderOrder = 1;
    scene.add(w);
  }
  for (const lk of terrain.lakes) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(lk.r * 1.02, 48).rotateX(-Math.PI / 2), waterMat(0.95, 120));
    w.position.set(lk.x, -3, lk.z);
    scene.add(w);
  }

  // ---------------------------------------------------------- pistas
  const procedural = terrain.mode === "procedural";
  for (const r of L.runways) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r.len, r.wid).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: runwayTexture(r.len, r.wid, r.leId, r.heId), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 })
    );
    m.position.set(r.cx, 0.132, r.cz);
    m.rotation.y = r.rotY;
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
  }
  const rotY = Math.atan2(-L.dir.z, L.dir.x);
  const at = (a: number, o: number) => L.apron.clone().addScaledVector(L.dir, a).addScaledVector(L.out, o);
  const pave = new THREE.MeshStandardMaterial({ color: 0x45484d, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
  if (procedural) {
    const apr = new THREE.Mesh(new THREE.PlaneGeometry(560, 170).rotateX(-Math.PI / 2), pave);
    const p = at(30, 55);
    apr.position.set(p.x, 0.135, p.z);
    apr.rotation.y = rotY;
    apr.receiveShadow = true;
    scene.add(apr);
    const distOut = L.apron.clone().sub(new THREE.Vector3(L.active.cx, 0, L.active.cz)).dot(L.out);
    const tw = new THREE.Mesh(new THREE.PlaneGeometry(L.active.len, 23).rotateX(-Math.PI / 2), pave);
    const tp = new THREE.Vector3(L.active.cx, 0, L.active.cz).addScaledVector(L.out, L.active.wid / 2 + 110);
    tw.position.set(tp.x, 0.134, tp.z);
    tw.rotation.y = rotY;
    scene.add(tw);
    for (const a of [-0.45, 0, 0.45]) {
      const conn = new THREE.Mesh(new THREE.PlaneGeometry(23, distOut - L.active.wid / 2).rotateX(-Math.PI / 2), pave);
      const cp = new THREE.Vector3(L.active.cx, 0, L.active.cz).addScaledVector(L.dir, a * L.active.len).addScaledVector(L.out, (L.active.wid / 2 + distOut) / 2);
      conn.position.set(cp.x, 0.133, cp.z);
      conn.rotation.y = rotY;
      scene.add(conn);
    }
  }

  // ---------------------------------------------------------- luzes de pista
  const lights: { p: THREE.Vector3; c: THREE.Color }[] = [];
  const W = new THREE.Color(1, 0.95, 0.82), Y = new THREE.Color(1, 0.78, 0.28), G = new THREE.Color(0.25, 1, 0.45), Rd = new THREE.Color(1, 0.12, 0.08);
  for (const r of L.runways) {
    const isActive = r === L.active;
    const n = Math.floor(r.len / 60);
    for (let i = 0; i <= n; i++) {
      const a = -r.len / 2 + (i * r.len) / n;
      const fromThr = isActive ? (L.activeIdent === r.leId ? a + r.len / 2 : r.len / 2 - a) : 0;
      const col = isActive && fromThr > r.len - 600 ? Y : W;
      for (const sd of [-1, 1]) {
        const x = r.cx + r.ux * a - r.uz * sd * (r.wid / 2 + 1.5), z = r.cz + r.uz * a + r.ux * sd * (r.wid / 2 + 1.5);
        lights.push({ p: new THREE.Vector3(x, 0.45, z), c: col });
      }
    }
    for (const end of [-1, 1]) {
      const isThr = isActive && ((end === -1) === (L.activeIdent === r.leId));
      for (let k = -r.wid / 2; k <= r.wid / 2; k += 3) {
        const a = (end * r.len) / 2;
        lights.push({ p: new THREE.Vector3(r.cx + r.ux * a - r.uz * k, 0.45, r.cz + r.uz * a + r.ux * k), c: isActive ? (isThr ? G : Rd) : G });
      }
    }
  }
  for (let d = 30; d <= 900; d += 30) {
    for (let k = -2; k <= 2; k++) {
      const p = L.thr.clone().addScaledVector(L.dir, -d).addScaledVector(L.right, k * 1.1);
      p.y = Math.max(gy(p.x, p.z), terrain.seaY + 1) + 0.6;
      lights.push({ p, c: W });
    }
  }
  for (let k = -15; k <= 15; k += 1.5) {
    const p = L.thr.clone().addScaledVector(L.dir, -300).addScaledVector(L.right, k);
    p.y = Math.max(gy(p.x, p.z), terrain.seaY + 1) + 0.6;
    lights.push({ p, c: W });
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2.2) });
  const lmesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), lightMat, lights.length);
  const m4 = new THREE.Matrix4();
  lights.forEach((l, i) => {
    m4.makeTranslation(l.p.x, l.p.y, l.p.z);
    lmesh.setMatrixAt(i, m4);
    lmesh.setColorAt(i, l.c);
  });
  scene.add(lmesh);
  const rabbit: THREE.Mesh[] = [];
  const rabbitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 14, 14) });
  for (let d = 900; d >= 330; d -= 30) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), rabbitMat);
    const p = L.thr.clone().addScaledVector(L.dir, -d);
    s.position.set(p.x, Math.max(gy(p.x, p.z), terrain.seaY + 1) + 1.4, p.z);
    s.visible = false;
    scene.add(s);
    rabbit.push(s);
  }
  const papi: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const p = L.papi.clone().addScaledVector(L.right, -i * 9);
    m.position.set(p.x, 0.9, p.z);
    m.rotation.y = rotY;
    scene.add(m);
    papi.push(m);
  }
  const papiAngles = [3.5, 3.17, 2.83, 2.5];
  const papiRed = new THREE.Color(10, 0.5, 0.3), papiWhite = new THREE.Color(10, 10, 9);

  // biruta — gira conforme o vento real
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xff6a10, side: THREE.DoubleSide, emissive: 0x663010, emissiveIntensity: 0 });
  const sockG = new THREE.Group();
  {
    const p = L.thr.clone().addScaledVector(L.dir, 350).addScaledVector(L.right, L.active.wid / 2 + 70);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 9, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(p.x, 4.5, p.z);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 12, 1, true).rotateZ(-Math.PI / 2), sockMat);
    sock.position.set(2.2, 0, 0);
    sockG.add(sock);
    sockG.position.set(p.x, 8.6, p.z);
    scene.add(pole, sockG);
  }

  // ---------------------------------------------------------- edificações destrutíveis
  let towerAlive = true;
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1b2836, roughness: 0.1, metalness: 0.85, emissive: 0xffcf8a, emissiveIntensity: 0 });
  const towerGlass = new THREE.MeshStandardMaterial({ color: 0x23455e, roughness: 0.06, metalness: 0.9, emissive: 0x3a5a70, emissiveIntensity: 0 });
  const UPV = new THREE.Vector3(0, 1, 0);

  function building(o: {
    name: string; a: number; o: number; w: number; h: number; d: number; color: number; hp: number; points: number;
    team?: Team; arch?: boolean; glass?: boolean; extra?: (g: THREE.Group) => void; onDie?: () => void; onLive?: () => void;
  }): Damageable {
    const p = at(o.a, o.o);
    const y0 = gy(p.x, p.z);
    const g = new THREE.Group();
    g.position.set(p.x, y0, p.z);
    g.rotation.y = rotY;
    const base = new THREE.Color(o.color);
    const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.78, metalness: 0.18 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mat);
    box.position.y = o.h / 2;
    g.add(box);
    if (o.arch) {
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(o.d / 2, o.d / 2, o.w, 22, 1, false, 0, Math.PI), mat);
      roof.rotation.z = Math.PI / 2;
      roof.position.y = o.h;
      g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, o.h * 0.85, o.d * 0.8), new THREE.MeshStandardMaterial({ color: 0x3b4148, metalness: 0.6, roughness: 0.4 }));
      door.position.set(-o.w / 2, o.h * 0.43, 0);
      g.add(door);
    }
    if (o.glass) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.3, o.h * 0.32, o.d + 0.3), winMat);
      band.position.y = o.h * 0.6;
      g.add(band);
    }
    o.extra?.(g);
    g.traverse((ob) => {
      const m = ob as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    scene.add(g);
    const rubble = new THREE.Group();
    rubble.position.copy(g.position);
    rubble.rotation.y = rotY;
    const rb = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.95, Math.max(2, o.h * 0.13), o.d * 0.95), rubbleMat);
    rb.position.y = Math.max(1, o.h * 0.065);
    rubble.add(rb);
    for (let i = 0; i < 6; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.25, o.h * 0.08 + 1, o.d * 0.3), rubbleMat);
      slab.position.set((Math.random() - 0.5) * o.w * 0.7, o.h * 0.12, (Math.random() - 0.5) * o.d * 0.7);
      slab.rotation.set(Math.random() - 0.5, Math.random() * 3, Math.random() - 0.5);
      rubble.add(slab);
    }
    rubble.visible = false;
    scene.add(rubble);
    const top = new THREE.Vector3(p.x, y0 + o.h * 0.7, p.z);
    let smoking = false;
    const hTot = o.h + (o.arch ? o.d / 2 : 0);
    const d = registry.add({
      id: `bld-${o.name}-${o.a}-${o.o}`, name: o.name, kind: "building", team: o.team ?? "friendly",
      center: new THREE.Vector3(p.x, y0 + hTot / 2, p.z), half: new THREE.Vector3(o.w / 2, hTot / 2, o.d / 2), rotY,
      radius: Math.hypot(o.w, hTot, o.d) / 2, hp: o.hp, points: o.points, heat: 0.12, respawnMs: 150000,
      onDestroyed: () => {
        g.visible = false;
        rubble.visible = true;
        fx.explosion(top, Math.max(o.w, o.d) * 0.3, { groundY: y0 });
        scars.scorch(new THREE.Vector3(p.x, y0, p.z), UPV, Math.max(o.w, o.d) * 1.5);
        fx.burn(new THREE.Vector3(p.x, y0 + 2, p.z), Math.max(6, Math.min(o.w, o.d) * 0.28), 55000);
        o.onDie?.();
      },
      onRespawn: () => {
        g.visible = true;
        rubble.visible = false;
        smoking = false;
        mat.color.copy(base);
        o.onLive?.();
      },
    });
    d.onHit = () => {
      // fachada enegrece conforme o dano acumulado
      mat.color.copy(base).multiplyScalar(0.3 + 0.7 * Math.max(0, d.hp / d.maxHp));
      if (!smoking && d.hp < d.maxHp * 0.55) {
        smoking = true;
        fx.burn(top, 5, 30000, undefined, true);
      }
    };
    return d;
  }

  building({
    name: "TORRE DE CONTROLE", a: 120, o: 130, w: 12, h: 40, d: 12, color: 0xc4c9cf, hp: 420, points: -600,
    extra: (g) => {
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 7.5, 7, 10), towerGlass);
      cab.position.y = 43.5;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 10.5, 1, 10), new THREE.MeshStandardMaterial({ color: 0x9aa1a8 }));
      roof.position.y = 47.5;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 9, 6), new THREE.MeshStandardMaterial({ color: 0xd8d8d8 }));
      ant.position.y = 52.5;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
      dome.position.set(4, 49.5, 0);
      g.add(cab, roof, ant, dome);
    },
    onDie: () => { towerAlive = false; },
    onLive: () => { towerAlive = true; },
  });
  const towerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.3, 0.2) }));
  {
    const p = at(120, 130);
    towerBeacon.position.set(p.x, gy(p.x, p.z) + 57.5, p.z);
    scene.add(towerBeacon);
  }
  L.tower.copy(at(120, 130)).setY(gy(L.tower.x, L.tower.z) + 45);
  building({ name: "TERMINAL DE PASSAGEIROS", a: -90, o: 160, w: 230, h: 17, d: 52, color: 0xa7adb5, hp: 900, points: -800, glass: true });
  building({ name: "HANGAR 1", a: 240, o: 115, w: 70, h: 14, d: 60, color: 0x7b8088, hp: 520, points: -300, arch: true });
  building({ name: "HANGAR 2", a: 325, o: 115, w: 70, h: 14, d: 60, color: 0x6b7a6e, hp: 520, points: -300, arch: true });
  building({ name: "CORPO DE BOMBEIROS", a: -250, o: 110, w: 40, h: 9, d: 26, color: 0xb04a3a, hp: 260, points: -250 });

  // tanques de combustível (explodem em cadeia)
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.45, metalness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const p = at(210 + i * 32, 215);
    const y0 = gy(p.x, p.z);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 13, 22), tankMat);
    tank.position.set(p.x, y0 + 6.5, p.z);
    tank.castShadow = tank.receiveShadow = true;
    scene.add(tank);
    const burnt = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11, 3, 16, 1, true), rubbleMat);
    burnt.position.set(p.x, y0 + 1.5, p.z);
    burnt.visible = false;
    scene.add(burnt);
    const center = new THREE.Vector3(p.x, y0 + 6.5, p.z);
    registry.add({
      id: `fuel-${i}`, name: "TANQUE DE COMBUSTÍVEL", kind: "structure", team: "friendly", center, radius: 12, hp: 180, points: -200, heat: 0.4, respawnMs: 150000,
      onDestroyed: () => {
        tank.visible = false;
        burnt.visible = true;
        fx.explosion(center, 46, { groundY: y0 });
        scars.scorch(new THREE.Vector3(p.x, y0, p.z), UPV, 46);
        fx.burn(center.clone().setY(y0 + 3), 14, 70000);
        setTimeout(() => registry.explode(center, 55, 260, "blast", true, performance.now()), 260);
      },
      onRespawn: () => { tank.visible = true; burnt.visible = false; },
    });
  }

  // aeronaves estacionadas
  const parked: [string, number][] = ap.military ? [["f16", -150], ["f16", -95], ["a10", -30], ["fa18", 40]] : [["b737", -170], ["b737", -95], ["c172", -30], ["c172", -10]];
  for (const [id, a] of parked) {
    const spec = byId(id);
    const model = buildAircraft(spec);
    const p = at(a, 45);
    const y0 = gy(p.x, p.z);
    model.group.position.set(p.x, y0 + spec.gearHeight, p.z);
    model.group.rotation.y = Math.atan2(L.out.x, L.out.z);
    for (const s of model.strobes) s.visible = false;
    scene.add(model.group);
    const center = model.group.position.clone();
    registry.add({
      id: `parked-${a}`, name: `${spec.short} ESTACIONADO`, kind: "aircraft", team: "friendly", center, radius: spec.span * 0.42,
      hp: spec.hp, points: -350, heat: 0.25, respawnMs: 160000,
      onDestroyed: () => {
        model.group.visible = false;
        fx.explosion(center, spec.span * 0.6, { groundY: y0 });
        scars.scorch(new THREE.Vector3(center.x, y0, center.z), UPV, spec.span * 1.6);
        fx.burn(center.clone().setY(y0 + 1), spec.span * 0.25, 60000);
      },
      onRespawn: () => { model.group.visible = true; },
    });
  }
  for (let i = 0; i < 2; i++) {
    const p = at(60 + i * 25, 95);
    const y0 = gy(p.x, p.z);
    const g = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xd8c22a }));
    cab.position.set(0, 1.5, -3.2);
    const tk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.5, roughness: 0.35 }));
    tk.position.set(0, 1.7, 0.8);
    g.add(cab, tk);
    g.position.set(p.x, y0, p.z);
    g.rotation.y = rotY;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(g);
    const center = new THREE.Vector3(p.x, y0 + 1.6, p.z);
    registry.add({
      id: `truck-${i}`, name: "CAMINHÃO-TANQUE", kind: "vehicle", team: "friendly", center, half: new THREE.Vector3(4.5, 1.6, 1.4), rotY,
      radius: 5, hp: 45, points: -80, heat: 0.4, respawnMs: 120000,
      onDestroyed: () => {
        g.visible = false;
        fx.explosion(center, 14, { groundY: y0 });
        scars.scorch(new THREE.Vector3(p.x, y0, p.z), UPV, 16);
        fx.burn(center, 4, 40000);
      },
      onRespawn: () => { g.visible = true; },
    });
  }

  // ---------------------------------------------------------- cidade e floresta (procedural)
  const treeAlive: boolean[] = [];
  const treePos: THREE.Vector3[] = [];
  if (procedural) {
    const nB = quality === "low" ? 220 : quality === "medium" ? 360 : 480;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const city = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.15 }), nB);
    city.castShadow = city.receiveShadow = true;
    const base = new THREE.Vector3(L.active.cx, 0, L.active.cz).addScaledVector(L.out, -4600).addScaledVector(L.dir, 1200);
    const palette = [0x8f9aa5, 0x7d8894, 0xa5a89b, 0x6e7a88, 0x99917f, 0xb7b1a3, 0x5d6672];
    const col = new THREE.Color(), rubbleCol = new THREE.Color(0x2c2926), q = new THREE.Quaternion();
    let k = 0;
    for (let tries = 0; tries < nB * 5 && k < nB; tries++) {
      const x = base.x + (Math.random() - 0.5) * 5200, z = base.z + (Math.random() - 0.5) * 4200;
      if (terrain.flatWeight(x, z) > 0.12 || terrain.isWaterRaw(x, z) || insideRunway(L, x, z, 500)) continue;
      const tall = Math.random() < 0.12;
      const h = tall ? 60 + Math.random() * 120 : 10 + Math.random() * 35;
      const w = 14 + Math.random() * 26, dd = 14 + Math.random() * 26;
      const y = gy(x, z) - 1;
      const pos = new THREE.Vector3(x, y, z), full = new THREE.Vector3(w, h, dd), low = new THREE.Vector3(w * 0.92, Math.max(3, h * 0.12), dd * 0.92);
      m4.compose(pos, q, full);
      city.setMatrixAt(k, m4);
      const baseCol = palette[k % palette.length];
      city.setColorAt(k, col.setHex(baseCol));
      const idx = k;
      const dmg = registry.add({
        id: `city-${k}`, name: tall ? "ARRANHA-CÉU" : "EDIFÍCIO", kind: "building", team: "neutral",
        center: new THREE.Vector3(x, y + h / 2, z), half: new THREE.Vector3(w / 2, h / 2, dd / 2), radius: Math.hypot(w, h, dd) / 2,
        hp: tall ? 420 : 170, points: -25, heat: 0.08, respawnMs: 200000,
        onDestroyed: () => {
          m4.compose(pos, q, low);
          city.setMatrixAt(idx, m4);
          city.setColorAt(idx, rubbleCol);
          city.instanceMatrix.needsUpdate = true;
          if (city.instanceColor) city.instanceColor.needsUpdate = true;
          fx.explosion(new THREE.Vector3(x, y + h * 0.5, z), Math.max(w, dd) * 0.45, { groundY: y });
          scars.scorch(new THREE.Vector3(x, y + 1, z), UPV, Math.max(w, dd) * 1.6);
          fx.burn(new THREE.Vector3(x, y + 3, z), Math.max(5, w * 0.3), 50000);
        },
        onRespawn: () => {
          m4.compose(pos, q, full);
          city.setMatrixAt(idx, m4);
          city.setColorAt(idx, col.setHex(baseCol));
          city.instanceMatrix.needsUpdate = true;
          if (city.instanceColor) city.instanceColor.needsUpdate = true;
        },
      });
      dmg.onHit = () => {
        const f = 0.3 + 0.7 * Math.max(0, dmg.hp / dmg.maxHp);
        city.setColorAt(idx, col.setHex(baseCol).multiplyScalar(f));
        if (city.instanceColor) city.instanceColor.needsUpdate = true;
      };
      k++;
    }
    city.count = k;
    scene.add(city);

    const nT = quality === "low" ? 700 : quality === "medium" ? 1300 : 2000;
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
      nT
    );
    trees.castShadow = true;
    const tc = new THREE.Color();
    let t = 0;
    for (let tries = 0; tries < nT * 4 && t < nT; tries++) {
      const ang = Math.random() * Math.PI * 2, rad = 1500 + Math.random() * 10500;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (terrain.flatWeight(x, z) > 0.3 || terrain.isWaterRaw(x, z) || insideRunway(L, x, z, 300)) continue;
      const y = gy(x, z);
      if (y > 1000) continue;
      const th = 9 + Math.random() * 14;
      m4.compose(new THREE.Vector3(x, y - 0.5, z), q, new THREE.Vector3(th * 0.42, th, th * 0.42));
      trees.setMatrixAt(t, m4);
      trees.setColorAt(t, tc.setHSL(0.27 + Math.random() * 0.06, 0.45, 0.17 + Math.random() * 0.08));
      treePos.push(new THREE.Vector3(x, y, z));
      treeAlive.push(true);
      t++;
    }
    trees.count = t;
    scene.add(trees);
    registry.explosionListeners.push((center, r) => {
      const rr = (r * 1.3) ** 2;
      let changed = false;
      for (let i = 0; i < treePos.length; i++) {
        if (!treeAlive[i] || treePos[i].distanceToSquared(center) > rr) continue;
        treeAlive[i] = false;
        m4.compose(treePos[i], q, new THREE.Vector3(0.001, 0.001, 0.001));
        trees.setMatrixAt(i, m4);
        changed = true;
        if (Math.random() < 0.3) fx.burn(treePos[i].clone().setY(treePos[i].y + 2), 3, 15000);
      }
      if (changed) trees.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------- ambiente dinâmico (hora + clima)
  let lastElev = 999, lastOver = -1, lastRegen = 0;
  const skyUniforms = [sky.material.uniforms, sky2.material.uniforms];
  const cloudTintC = new THREE.Color();
  /** regulagem do brilho do sol (glare) — 0.15 (suave) a 1.85 (forte) */
  let glare = 1.0;
  const _shC = new THREE.Vector3();
  const _shX = new THREE.Vector3();
  const _shY = new THREE.Vector3();

  let lastDate = new Date();
  let lastWx: Weather = wx0;

  function setEnvironment(date: Date, wx: Weather) {
    lastDate = date;
    lastWx = wx;
    const sp = solarPosition(date, ap.lat, ap.lon);
    const elev = sp.elev;
    const sv = sunVec(elev, sp.az);
    sunDir.set(sv[0], sv[1], sv[2]);
    const mv = sunVec(THREE.MathUtils.clamp(38 + Math.max(0, -elev) * 0.25, 20, 62), sp.az + 180);
    moonDir.set(mv[0], mv[1], mv[2]);
    const daylight = smooth(-6, 6, elev);
    const dark = 1 - smooth(-9, 2, elev);
    const warm = (1 - smooth(2, 28, elev)) * smooth(-5, 3, elev);
    const over = THREE.MathUtils.clamp(wx.cloud * 0.8 + Math.min(1, wx.precip / 3 + wx.snow) * 0.5, 0, 1);
    st.elev = elev; st.dark = dark; st.daylight = daylight; st.over = over;

    for (const u of skyUniforms) {
      u.turbidity.value = 2 + warm * 4 + over * 6;
      u.rayleigh.value = Math.max(0.35, 0.9 + warm * 1.3 - over * 0.5);
      u.mieCoefficient.value = 0.003 + over * 0.008;
      u.mieDirectionalG.value = 0.75;
      u.sunPosition.value.copy(sunDir);
    }
    (overDome.material as THREE.MeshBasicMaterial).opacity = over * 0.9 * (0.25 + 0.75 * daylight);
    (overDome.material as THREE.MeshBasicMaterial).color.copy(mixC(0x12161d, 0xa3abb3, daylight)).lerp(new THREE.Color(0xb98d72), warm * 0.4);

    // luz direcional: Sol ou Lua
    const sunI = 2.1 * smooth(-1, 14, elev) * (1 - 0.82 * over);
    const moonI = 0.5 * dark * (1 - 0.5 * over);
    if (sunI >= moonI) {
      sun.color.copy(mixC(0xfff3e4, 0xff9c55, warm));
      sun.intensity = sunI * (0.55 + 0.45 * glare);
      lightDir.copy(sunDir);
    } else {
      sun.color.set(0x9db4e0);
      sun.intensity = moonI;
      lightDir.copy(moonDir);
    }
    hemi.color.copy(mixC(0x20304f, 0xa7c3e6, daylight));
    hemi.groundColor.copy(mixC(0x0b0b0e, 0x4a4a3a, daylight));
    hemi.intensity = (0.2 + 0.18 * daylight) * (1 + 0.35 * over);
    scene.environmentIntensity = (0.1 + 0.2 * daylight) * (1 - 0.25 * over);

    // névoa: cor do horizonte + visibilidade real
    const dayFog = mixC(0x9db6cc, 0xd1a283, warm);
    const fogC = mixC(0x070b18, 0x070b18, 0).lerp(dayFog, daylight);
    fogC.lerp(mixC(0x05070c, 0x8d959c, daylight), over * 0.7);
    (scene.fog as THREE.FogExp2).color.copy(fogC);
    (scene.background as THREE.Color).copy(fogC);
    const vis = Math.max(500, Math.min(wx.visM, 45000));
    const baseDens = THREE.MathUtils.clamp(1.2 / vis, 2.6e-5, 2.4e-3);
    st.baseFogDensity = baseDens;
    st.baseFogColor.copy(fogC);
    (scene.fog as THREE.FogExp2).density = baseDens;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.72, 0.4, daylight) * (1 + 0.25 * over) * (0.78 + 0.22 * glare);

    // nuvens dinâmicas
    cloudTintC.copy(mixC(0x28304a, 0xffffff, daylight)).lerp(new THREE.Color(0xffb892), warm * 0.5);
    cloudTintC.lerp(mixC(0x1a1d24, 0x7f868e, daylight), over * 0.6);
    clouds.setWeather(wx);
    clouds.setAppearance(cloudTintC, 0.58 + 0.38 * Math.max(wx.cloud, over));

    // noite: estrelas, lua, luzes
    starMat.opacity = dark * (1 - over);
    nightGroup.visible = dark > 0.03;
    moonMat.opacity = dark * (1 - 0.75 * over);
    moon.position.copy(moonDir).multiplyScalar(28000);
    lightMat.color.setScalar(THREE.MathUtils.lerp(2.2, 9, dark));
    winMat.emissiveIntensity = dark * 0.9;
    towerGlass.emissiveIntensity = dark * 0.6;
    sockMat.emissiveIntensity = dark * 0.6;
    for (const m of waterMats) m.color.copy(mixC(0x08141f, 0x1d4a63, daylight));
    scars.setBrightness(0.3 + 0.7 * daylight);

    // reflexos (PMREM) só quando o céu mudou o bastante
    const now = performance.now();
    if (Math.abs(elev - lastElev) > 1.2 || Math.abs(over - lastOver) > 0.1) {
      if (now - lastRegen > 2000 || lastElev === 999) {
        lastElev = elev;
        lastOver = over;
        lastRegen = now;
        envRT?.dispose();
        envRT = pmrem.fromScene(envScene, 0, 0.1, 5000);
        scene.environment = envRT.texture;
      }
    }
  }
  setEnvironment(new Date(), wx0);

  const cloudFogC = new THREE.Color();
  return {
    sun, hemi, lightDir, layout: L, clouds, state: st,
    towerAlive: () => towerAlive,
    setEnvironment,
    setGlare(k: number) {
      glare = THREE.MathUtils.clamp(k, 0.15, 1.85);
      lastElev = 999; // força recálculo imediato na próxima chamada
      lastOver = -1;
      setEnvironment(lastDate, lastWx);
    },
    updateShadow(anchor: THREE.Vector3) {
      const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
      const d = lightDir;
      const rx = _shX.set(0, 1, 0).cross(d).normalize();
      const ry = _shY.crossVectors(d, rx).normalize();
      // projeta o jogador no plano da luz e QUANTIZA o centro da shadow camera à
      // grade de texels: o mapa de sombras só se move em saltos de 1 texel inteiros,
      // mantendo os padrões de filtro PCF idênticos entre quadros → sem tremulação.
      const ax = anchor.dot(rx), ay = anchor.dot(ry);
      const qx = Math.round(ax / texel) * texel;
      const qy = Math.round(ay / texel) * texel;
      _shC.copy(anchor).addScaledVector(rx, qx - ax).addScaledVector(ry, qy - ay);
      sun.target.position.copy(_shC);
      sun.target.updateMatrixWorld();
      sun.position.copy(_shC).addScaledVector(d, 3000);
      sun.updateMatrixWorld();
    },
    update(dt, t, camera, eye, wind, playerPos, inCloud = 0, isCB = false) {
      sky.position.copy(camera.position);
      overDome.position.copy(camera.position);
      nightGroup.position.copy(camera.position);
      clouds.update(dt, t / 1000, (playerPos ?? camera.position).x, (playerPos ?? camera.position).z, wind);
      // imersão dentro de nuvens densas / cumulonimbus: visibilidade cai abruptamente
      const fog = scene.fog as THREE.FogExp2;
      if (inCloud > 0.02) {
        const dense = (isCB ? 0.0085 : 0.0045) * inCloud;
        fog.density = Math.max(st.baseFogDensity, dense);
        cloudFogC.copy(st.baseFogColor).lerp(new THREE.Color(isCB ? 0x3b424d : 0xdbe3ec).multiplyScalar(0.18 + 0.82 * st.daylight), inCloud * 0.85);
        fog.color.copy(cloudFogC);
        (scene.background as THREE.Color).copy(cloudFogC);
      } else {
        fog.density = st.baseFogDensity;
        fog.color.copy(st.baseFogColor);
        (scene.background as THREE.Color).copy(st.baseFogColor);
      }
      if (waterNormal) {
        waterNormal.offset.x += dt * 0.012;
        waterNormal.offset.y += dt * 0.006;
      }
      // biruta aponta para onde o vento sopra e se levanta com a intensidade
      const ws = Math.hypot(wind.x, wind.z);
      if (ws > 0.2) sockG.rotation.y = Math.atan2(-wind.z, wind.x);
      sockG.rotation.z = -THREE.MathUtils.clamp(1 - ws / 7, 0, 1) * 1.1;
      const phase = (t % 500) / 500;
      const k = Math.floor(phase * (rabbit.length + 6));
      rabbit.forEach((s, i) => (s.visible = i === k));
      towerBeacon.visible = Math.sin(t * 0.004) > 0;
      const rel = eye.clone().sub(L.papi);
      const along = -rel.dot(L.dir);
      const horiz = Math.max(1, Math.hypot(rel.x, rel.z));
      const ang = along > 0 ? THREE.MathUtils.radToDeg(Math.atan2(eye.y - 1, horiz)) : -1;
      papi.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.copy(ang > papiAngles[i] ? papiWhite : papiRed));
    },
  };
}