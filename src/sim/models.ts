import * as THREE from "three";
import type { AircraftSpec } from "./aircraft";

/**
 * Stub de canvas para ambientes sem DOM (Node/testes). No navegador usa o
 * document real; em teste devolve um objeto com a API mínima usada abaixo.
 */
const canvas2d = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    return { canvas: c, ctx: c.getContext("2d")! };
  }
  const noop = () => undefined;
  const ctx = {
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, fill: noop, stroke: noop,
    roundRect: noop, fillText: noop, measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    setTransform: noop, save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    drawImage: noop, putImageData: noop, createImageData: (() => ({ data: new Uint8ClampedArray(4) })) as never,
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0 } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
};

export interface AircraftModel {
  group: THREE.Group;
  gear: THREE.Group;
  ab: THREE.Group[];
  nozzleGlow: THREE.Mesh[];
  prop: THREE.Object3D | null;
  propDisc: THREE.Mesh | null;
  strobes: THREE.Object3D[];
  beacons: THREE.Object3D[];
  /** luzes de navegação (vermelho/verde nas pontas + branco na cauda) */
  nav: THREE.Object3D[];
  /** conjuntos de luz de pouso/táxi (lente + halo) */
  landing: THREE.Object3D[];
  /** painéis móveis de spoiler / freio aerodinâmico */
  spoilers: THREE.Object3D[];
  stores: { bomb: THREE.Object3D[]; missileIR: THREE.Object3D[]; missileRAD: THREE.Object3D[] };
  wingtips: THREE.Vector3[];
  exhausts: THREE.Vector3[];
  landingLight: THREE.Mesh | null;
}

// ---------------- materiais ----------------
const paint = (c: number, rough = 0.42, metal = 0.3) =>
  new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: metal, clearcoat: 0.55, clearcoatRoughness: 0.3 });
const matte = (c: number, rough = 0.75, metal = 0.25) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
const glowMat = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
const glass = (c: number) =>
  new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.04, metalness: 0.85, clearcoat: 1, transparent: true, opacity: 0.88 });

// ---------------- geometrias utilitárias ----------------
/** corpo de revolução ao longo de Z. perfil: [posição (+ = nariz), raio] ordenado da cauda para o nariz */
function lathe(profile: [number, number][], m: THREE.Material, seg = 22, sy = 1, sx = 1): THREE.Mesh {
  const g = new THREE.LatheGeometry(profile.map(([p, r]) => new THREE.Vector2(Math.max(r, 0.001), p)), seg);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, 1);
  return mesh;
}

/** asa trapezoidal: bordo de ataque da raiz na origem, envergadura +X, corda para trás (+Z), espessura para cima */
function wingGeo(halfSpan: number, root: number, tip: number, sweep: number, thick: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(halfSpan, -sweep);
  s.lineTo(halfSpan, -sweep - tip);
  s.lineTo(0, -root);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.35, bevelSize: thick * 0.45, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick / 2, 0);
  return g;
}

function wingPair(geo: THREE.BufferGeometry, m: THREE.Material, x0: number, y: number, z: number, dihedral = 0): THREE.Group {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(geo, m);
    w.scale.x = side;
    w.position.set(side * x0, y, z);
    w.rotation.z = side * dihedral;
    g.add(w);
  }
  return g;
}

/** deriva: bordo de ataque da raiz na origem, corda para trás (+Z), altura +Y */
function finGeo(height: number, root: number, tip: number, sweep: number, thick: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(root, 0);
  s.lineTo(sweep + tip, height);
  s.lineTo(sweep, height);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(thick / 2, 0, 0);
  return g;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

function tube(r1: number, r2: number, len: number, m: THREE.Material, open = false) {
  const g = new THREE.CylinderGeometry(r1, r2, len, 18, 1, open);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

// ---------------- armamento ----------------
function irMissile() {
  const g = new THREE.Group();
  const body = tube(0.064, 0.064, 2.9, matte(0xd9d9d2, 0.5, 0.4));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.064, 0.3, 10).rotateX(-Math.PI / 2), matte(0x2b2b2b, 0.3, 0.5));
  nose.position.z = -1.6;
  g.add(body, nose);
  const finM = matte(0xa8a8a0);
  for (let i = 0; i < 4; i++) {
    for (const [z, s] of [[1.25, 0.42], [-1.05, 0.26]] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, s, s * 0.9), finM);
      fin.position.z = z;
      fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
      fin.translateY(s / 2);
      g.add(fin);
    }
  }
  return g;
}

function radMissile() {
  const g = new THREE.Group();
  g.add(tube(0.09, 0.09, 3.65, matte(0xf2f2ee, 0.45, 0.3)));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 12).rotateX(-Math.PI / 2), matte(0xe8e2d0, 0.4, 0.2));
  nose.position.z = -2.05;
  g.add(nose);
  const finM = matte(0xc9c9c2);
  for (let i = 0; i < 4; i++) {
    for (const [z, s] of [[1.5, 0.5], [0.1, 0.36]] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, s, s), finM);
      fin.position.z = z;
      fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
      fin.translateY(s / 2);
      g.add(fin);
    }
  }
  return g;
}

function bombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.5, 6, 12).rotateX(Math.PI / 2), matte(0x4b5638, 0.65, 0.3));
  g.add(body);
  const ring = tube(0.205, 0.205, 0.06, matte(0xd4b23a));
  ring.position.z = -0.55;
  g.add(ring);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.45), matte(0x3f4830));
    fin.position.z = 1.0;
    fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    fin.translateY(0.2);
    g.add(fin);
  }
  return g;
}

// ---------------- efeitos ----------------
function makeAB(r: number): THREE.Group {
  const g = new THREE.Group();
  const add = (mat: THREE.Material) => mat;
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(r, r * 9, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, r * 4.5),
    add(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.25, 0.45), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  );
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.6, r * 5, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, r * 2.5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 4.5, 2.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  g.add(outer, core);
  const dm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r * (0.34 - i * 0.05), 10, 8), dm);
    d.scale.z = 1.6;
    d.position.z = r * (1.4 + i * 1.7);
    g.add(d);
  }
  g.visible = false;
  return g;
}

function nozzleGlow(r: number) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.1, 0.35), transparent: true, opacity: 0.2, depthWrite: false })
  );
  return m;
}

function light(x: number, y: number, z: number, c: THREE.Material, r = 0.1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), c);
  m.position.set(x, y, z);
  return m;
}

const RED = () => glowMat(7, 0.3, 0.2);
const GREEN = () => glowMat(0.3, 7, 0.6);
const WHITE = () => glowMat(8, 8, 8);

// ---------------- halos de luz (visíveis de longe e de dia) ----------------
let haloTex: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const { canvas: c, ctx: g } = canvas2d();
  c.width = c.height = 64;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.22, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

/** lente + halo aditivo — o halo é o que torna a luz visível a quilômetros */
function lamp(x: number, y: number, z: number, c: [number, number, number], size: number, r = 0.1): THREE.Group {
  const g = new THREE.Group();
  g.add(light(0, 0, 0, glowMat(...c), r));
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture(), color: new THREE.Color(c[0], c[1], c[2]), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.95,
    })
  );
  halo.scale.setScalar(size);
  g.add(halo);
  g.position.set(x, y, z);
  return g;
}

// ---------------- prefixo (matrícula) nas asas e no leme ----------------
let REG = "";
function regTexture(text: string): THREE.CanvasTexture {
  const { canvas: c, ctx: g } = canvas2d();
  c.width = 512;
  c.height = 160;
  g.clearRect(0, 0, 512, 160);
  g.font = "bold 108px 'Rajdhani', 'IBM Plex Sans', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(16,18,22,0.94)";
  g.fillText(text.toUpperCase().slice(0, 12), 256, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _m3 = new THREE.Matrix4();

/** orienta um decal sobre a superfície: Y = normal, X = direção do texto */
function basisFrom(normal: THREE.Vector3, textDir: THREE.Vector3): THREE.Quaternion {
  const y = normal.clone().normalize();
  let x = textDir.clone().sub(y.clone().multiplyScalar(y.dot(textDir)));
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  _m3.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m3);
}

// ---------------- construtor ----------------
class Builder {
  g = new THREE.Group();
  gear = new THREE.Group();
  m: AircraftModel;
  constructor() {
    this.m = {
      group: this.g, gear: this.gear, ab: [], nozzleGlow: [], prop: null, propDisc: null, strobes: [], beacons: [], nav: [], landing: [], spoilers: [],
      stores: { bomb: [], missileIR: [], missileRAD: [] }, wingtips: [], exhausts: [], landingLight: null,
    };
    this.g.add(this.gear);
  }
  add<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
    o.position.set(x, y, z);
    this.g.add(o);
    return o;
  }
  navLights(x: number, y: number, z: number, tail: [number, number, number]) {
    const size = Math.max(1.5, x * 0.55);
    const nl = lamp(-x, y, z, [7, 0.3, 0.2], size);
    const nr = lamp(x, y, z, [0.3, 7, 0.6], size);
    const nt = lamp(...tail, [8, 8, 8], size * 0.7);
    this.g.add(nl, nr, nt);
    this.m.nav.push(nl, nr, nt);
    const s1 = lamp(-x, y, z + 0.15, [8, 8, 8], size * 1.4, 0.12);
    const s2 = lamp(x, y, z + 0.15, [8, 8, 8], size * 1.4, 0.12);
    const s3 = lamp(tail[0], tail[1], tail[2], [8, 8, 8], size * 1.4, 0.12);
    this.m.strobes.push(s1, s2, s3);
    this.g.add(s1, s2, s3);
    this.m.wingtips.push(new THREE.Vector3(-x, y, z + 0.3), new THREE.Vector3(x, y, z + 0.3));
  }
  beacon(x: number, y: number, z: number) {
    this.m.beacons.push(this.add(lamp(x, y, z, [8, 0.2, 0.1], Math.max(1.6, Math.abs(y) * 0.9), 0.14)));
  }
  /** painéis de spoiler articulados no bordo dianteiro (levantam para cima/trás ao abrir) */
  spoilers(x: number, y: number, z: number, w: number, c: number, m: THREE.Material) {
    for (const side of [-1, 1]) {
      const piv = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, c), m);
      panel.position.set(0, 0.03, c * 0.5);
      piv.add(panel);
      piv.position.set(side * x, y, z);
      this.g.add(piv);
      this.m.spoilers.push(piv);
    }
  }
  gearSet(h: number, wheelR: number, legs: [number, number][], twin = false) {
    const strutM = matte(0xb8bec6, 0.35, 0.85), tireM = matte(0x16181c, 0.92, 0.05), hubM = matte(0x9aa1a8, 0.4, 0.8);
    for (const [x, z] of legs) {
      const top = -h * 0.3;
      const wy = -h + wheelR;
      this.gear.add(rod(new THREE.Vector3(x, top, z), new THREE.Vector3(x, wy, z), 0.06 + wheelR * 0.12, strutM));
      for (const off of twin ? [-wheelR * 0.42, wheelR * 0.42] : [0]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 0.62, 18).rotateZ(Math.PI / 2), tireM);
        w.position.set(x + off, wy, z);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, wheelR * 0.66, 12).rotateZ(Math.PI / 2), hubM);
        hub.position.copy(w.position);
        this.gear.add(w, hub);
      }
    }
    const ll = light(legs[0][0], -h * 0.45, legs[0][1] - 0.15, glowMat(9, 9, 8), 0.1);
    this.gear.add(ll);
    this.m.landingLight = ll;
    // lente de pouso/táxi + halos dianteiros (visíveis também fora do trem)
    const beam = new THREE.Group();
    beam.add(lamp(legs[0][0], -h * 0.45, legs[0][1] - 0.2, [9, 9, 8], 3.2, 0.13));
    beam.add(lamp(0, 0.2, -this.span() * 0.32, [9, 9, 8], 2.6, 0.12));
    this.g.add(beam);
    this.m.landing.push(beam);
  }
  private span() {
    return this.m.wingtips.length >= 2 ? Math.abs(this.m.wingtips[1].x - this.m.wingtips[0].x) / 2 : 6;
  }

  /** escreve o prefixo na parte de cima das asas e nos dois lados do leme */
  registration() {
    const text = REG.trim();
    if (!text) return;
    try {
      this.g.updateMatrixWorld(true);
      // os halos são sprites: o Raycaster exige câmera para eles — desliga o raycast
      this.g.traverse((o) => {
        if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).raycast = () => undefined;
      });
    const mat = new THREE.MeshBasicMaterial({
      map: regTexture(text), transparent: true, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, opacity: 0.92,
    });
    const tips = this.m.wingtips;
    const rayAt = (origin: THREE.Vector3, dir: THREE.Vector3) => {
      _ray.set(origin, dir);
      _ray.far = 4000;
      return _ray.intersectObject(this.g, true)[0] ?? null;
    };
    // ---- asas: raio vertical; texto corre no sentido da envergadura (lê-se de cima)
    const span = this.span();
    if (tips.length >= 2) {
      const w = span * 0.52, h = Math.max(0.45, span * 0.12);
      const zc = tips[0].z;
      for (const side of [-1, 1]) {
        const x = side * span * 0.56;
        const top = rayAt(new THREE.Vector3(x, Math.max(60, span * 8), zc), _down);
        if (!top) continue;
        const d = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        d.quaternion.copy(basisFrom(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
        d.position.copy(top.point).add(new THREE.Vector3(0, 0.03, 0));
        this.g.add(d);
      }
    }
    // ---- leme: raios laterais; texto lido da esquerda para a direita por cada observador
    const finProbe = this.m.strobes[this.m.strobes.length - 1]?.position ?? new THREE.Vector3(0, 3, 7);
    const yFin = Math.max(1.2, finProbe.y * 0.6);
    const zFin = finProbe.z;
    const probe = Math.max(8, span * 0.8);
    for (const side of [-1, 1]) {
      const hit = rayAt(new THREE.Vector3(side * probe, yFin, zFin), new THREE.Vector3(-side, 0, 0));
      if (!hit) continue;
      const fw = Math.max(1.8, span * 0.5), fh = Math.max(0.6, span * 0.17);
      const d = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), mat);
      d.quaternion.copy(basisFrom(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, side)));
      d.position.copy(hit.point).add(new THREE.Vector3(side * 0.02, 0, 0));
      this.g.add(d);
    }
    } catch (e) {
      console.warn("prefixo: falha ao aplicar decalque", e);
    }
  }
  store(kind: "bomb" | "missileIR" | "missileRAD", x: number, y: number, z: number, pylon = true) {
    const o = kind === "bomb" ? bombMesh() : kind === "missileIR" ? irMissile() : radMissile();
    if (pylon) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 1.2), matte(0x5a636d));
      p.position.set(x, y + 0.26, z);
      this.g.add(p);
    }
    this.add(o, x, y, z);
    this.m.stores[kind].push(o);
  }
  engine(x: number, y: number, z: number, r: number) {
    const noz = tube(r * 1.08, r, r * 2.2, matte(0x3b3f45, 0.35, 0.9), true);
    this.add(noz, x, y, z + r * 1.1);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 18), matte(0x15171a, 0.9, 0.2));
    this.add(inner, x, y, z + 0.4);
    const glow = nozzleGlow(r * 0.9);
    this.add(glow, x, y, z + 0.45);
    this.m.nozzleGlow.push(glow);
    const ab = makeAB(r * 0.92);
    this.add(ab, x, y, z + r * 2.1);
    this.m.ab.push(ab);
    this.m.exhausts.push(new THREE.Vector3(x, y, z + r * 2.4));
  }
  pilot(y: number, z: number) {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), matte(0x2a3036, 0.5, 0.2));
    this.add(helmet, 0, y, z);
  }
  finish(): AircraftModel {
    this.g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      const lit = mat instanceof THREE.MeshStandardMaterial;
      mesh.castShadow = lit;
      mesh.receiveShadow = lit;
    });
    if (REG.trim()) this.registration();
    REG = "";
    return this.m;
  }
}

// ---------------- F-16C ----------------
function buildF16(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body), accent = paint(s.colors.accent), dark = matte(0x2a2f35, 0.6, 0.5);
  b.add(lathe([[-7.5, 0.5], [-6.8, 0.6], [-5.2, 0.74], [-2.5, 0.83], [0.5, 0.86], [2.8, 0.8], [4.4, 0.62], [5.7, 0.42], [6.7, 0.22], [7.5, 0.03]], body, 24));
  const radome = lathe([[5.7, 0.43], [6.7, 0.22], [7.5, 0.03]], accent, 20);
  radome.scale.setScalar(1.005);
  b.add(radome);
  b.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 6.2), body), 0, -0.08, 0.7);
  const intake = b.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.72, 3.0), body), 0, -0.8, -1.2);
  intake.castShadow = true;
  b.add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.6, 0.05), matte(0x0b0c0e)), 0, -0.8, -2.72);
  const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glass(s.colors.canopy));
  cp.scale.set(0.42, 0.44, 1.55);
  b.add(cp, 0, 0.72, -3.3);
  b.pilot(0.85, -3.2);
  b.add(wingPair(wingGeo(1.0, 4.4, 0.25, 3.9, 0.08), body, 0.55, -0.05, -4.6));
  b.add(wingPair(wingGeo(4.15, 3.9, 1.0, 3.5, 0.12), body, 0.83, -0.05, -0.6));
  b.spoilers(2.2, 0.02, 1.8, 1.3, 0.65, dark);
  for (const sd of [-1, 1]) b.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 2.4), dark), sd * 4.98, 0, 3.0);
  b.add(new THREE.Mesh(finGeo(2.75, 3.2, 1.2, 2.4, 0.12), body), 0, 0.5, 3.6);
  b.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 1.2), accent), 0, 3.2, 6.6);
  b.add(wingPair(wingGeo(2.05, 2.0, 0.8, 1.4, 0.08), body, 0.75, -0.1, 5.3));
  for (const sd of [-1, 1]) {
    const vf = new THREE.Mesh(finGeo(0.6, 1.4, 0.7, 0.5, 0.06), body);
    vf.rotation.z = Math.PI + sd * 0.4;
    b.add(vf, sd * 0.6, -0.55, 5.0);
  }
  b.engine(0, -0.02, 7.4, 0.5);
  b.store("missileIR", -5.05, 0.02, 2.6, false);
  b.store("missileIR", 5.05, 0.02, 2.6, false);
  b.store("missileIR", -3.9, -0.42, 2.0);
  b.store("missileIR", 3.9, -0.42, 2.0);
  b.store("missileRAD", -2.95, -0.5, 1.2);
  b.store("missileRAD", 2.95, -0.5, 1.2);
  b.store("bomb", -1.95, -0.6, 0.8);
  b.store("bomb", 1.95, -0.6, 0.8);
  b.gearSet(s.gearHeight, 0.34, [[0, -4.0], [-1.15, 0.9], [1.15, 0.9]]);
  b.navLights(5.0, 0.05, 2.4, [0, 3.35, 6.4]);
  b.beacon(0, 0.95, 1.5);
  return b.finish();
}

// ---------------- A-10C ----------------
function buildA10(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body, 0.6, 0.2), dark = matte(0x2b302a, 0.6, 0.4);
  b.add(lathe([[-8.1, 0.3], [-7, 0.45], [-5, 0.7], [-1, 0.88], [2.5, 0.92], [4.6, 0.82], [6.4, 0.58], [7.6, 0.32], [8.1, 0.12]], body, 22, 1.05));
  const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), glass(s.colors.canopy));
  cp.scale.set(0.46, 0.5, 1.3);
  b.add(cp, 0, 0.85, -5.2);
  b.pilot(1.0, -5.1);
  b.add(tube(0.1, 0.1, 1.5, matte(0x1f2124, 0.4, 0.8)), -0.15, -0.35, -8.6);
  b.add(wingPair(wingGeo(7.9, 3.0, 1.7, 0.5, 0.22), body, 0.85, -0.38, -0.9, 0.04));
  b.spoilers(3.6, -0.14, 0.6, 2.1, 0.75, dark);
  for (const sd of [-1, 1]) {
    b.add(lathe([[-1.7, 0.42], [-1.2, 0.62], [1.2, 0.64], [1.7, 0.56]], body, 18), sd * 1.45, 1.05, 3.4);
    b.add(new THREE.Mesh(new THREE.CircleGeometry(0.55, 16).rotateY(Math.PI), matte(0x15171a)), sd * 1.45, 1.05, 1.68);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 1.6), body), sd * 1.0, 0.62, 3.3);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 1.8), dark), sd * 2.4, -0.62, 0.1);
  }
  b.add(wingPair(wingGeo(2.95, 1.8, 1.45, 0.25, 0.12), body, 0, 0.3, 6.4));
  for (const sd of [-1, 1]) b.add(new THREE.Mesh(finGeo(2.6, 1.85, 1.2, 0.5, 0.12), body), sd * 2.95, -0.55, 6.25);
  for (const sd of [-1, 1]) b.engine(sd * 1.45, 1.05, 4.4, 0.42);
  for (const x of [2.6, 3.5, 4.4]) for (const sd of [-1, 1]) b.store("bomb", sd * x, -0.85, 0.2);
  b.store("missileIR", -6.3, -0.62, 0.3);
  b.store("missileIR", 6.3, -0.62, 0.3);
  b.store("missileRAD", -5.4, -0.7, 0.2);
  b.store("missileRAD", 5.4, -0.7, 0.2);
  b.gearSet(s.gearHeight, 0.4, [[0.35, -5.8], [-2.4, 0.4], [2.4, 0.4]]);
  b.navLights(8.75, -0.3, 0.6, [0, 2.1, 7.6]);
  b.beacon(0, 0.95, 0.5);
  return b.finish();
}

// ---------------- Su-35S ----------------
function buildSu35(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body, 0.45, 0.25), accent = paint(s.colors.accent, 0.45, 0.25), dark = matte(0x2d3238, 0.55, 0.6);
  b.add(lathe([[-2, 0.95], [1, 0.96], [4, 0.86], [6.5, 0.66], [8.8, 0.38], [10.4, 0.1], [10.9, 0.02]], body, 24, 0.95));
  b.add(lathe([[9.3, 0.24], [10.4, 0.1], [10.9, 0.02]], matte(0xb8bcb0, 0.5, 0.2), 18, 0.96));
  b.add(lathe([[-7, 0.5], [-4.5, 1.6], [1.5, 2.25], [4.5, 1.6], [6.5, 0.8]], body, 24, 0.3), 0, -0.1, 0);
  for (const sd of [-1, 1]) {
    b.add(lathe([[-10, 0.56], [-9.2, 0.63], [-3, 0.76], [2, 0.78], [3.6, 0.7]], body, 18), sd * 1.1, -0.45, 0);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.95, 2.4), body), sd * 1.1, -0.62, -4.4);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.05), matte(0x0b0c0e)), sd * 1.1, -0.62, -5.62);
  }
  b.add(lathe([[-11.6, 0.06], [-10.6, 0.3], [-7, 0.42]], body, 14));
  const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), glass(s.colors.canopy));
  cp.scale.set(0.5, 0.5, 1.75);
  b.add(cp, 0, 0.92, -6.0);
  b.pilot(1.05, -6.0);
  b.add(wingPair(wingGeo(5.5, 6.0, 1.6, 4.6, 0.16), body, 2.15, -0.15, -1.2));
  b.spoilers(3.8, -0.04, 2.4, 1.8, 0.85, dark);
  for (const sd of [-1, 1]) {
    b.add(new THREE.Mesh(finGeo(3.6, 3.4, 1.5, 2.6, 0.14), accent), sd * 2.0, 0.3, 4.8);
    const vf = new THREE.Mesh(finGeo(0.8, 1.6, 0.8, 0.5, 0.08), body);
    vf.rotation.z = Math.PI;
    b.add(vf, sd * 1.6, -0.9, 5.6);
  }
  b.add(wingPair(wingGeo(3.0, 3.0, 1.2, 2.2, 0.1), body, 2.4, -0.3, 6.8));
  for (const sd of [-1, 1]) b.engine(sd * 1.1, -0.45, 9.9, 0.6);
  for (const x of [7.75, 6.4, 5.2]) for (const sd of [-1, 1]) b.store("missileIR", sd * x, x > 7 ? 0 : -0.4, 1.4, x < 7);
  b.store("missileRAD", -1.1, -1.25, -1.2);
  b.store("missileRAD", 1.1, -1.25, -1.2);
  for (const x of [3.2, 4.2]) for (const sd of [-1, 1]) b.store("bomb", sd * x, -0.55, 1.0);
  b.gearSet(s.gearHeight, 0.46, [[0, -6.6], [-2.2, 1.6], [2.2, 1.6]]);
  b.navLights(7.75, -0.1, 3.4, [0, 3.95, 8.2]);
  b.beacon(0, 0.6, 1.0);
  void dark;
  return b.finish();
}

// ---------------- F/A-18E ----------------
function buildF18(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body, 0.45, 0.3), dark = matte(0x2a2f35, 0.6, 0.5);
  b.add(lathe([[-9.0, 0.5], [-8.0, 0.7], [-5, 0.9], [-1, 0.96], [2, 0.9], [4.5, 0.76], [6.5, 0.55], [8.3, 0.28], [9.2, 0.04]], body, 24, 0.95));
  b.add(wingPair(wingGeo(1.35, 6.2, 0.4, 5.6, 0.1), body, 0.6, 0.1, -5.6));
  const cp = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), glass(s.colors.canopy));
  cp.scale.set(0.45, 0.47, 1.65);
  b.add(cp, 0, 0.85, -5.0);
  b.pilot(0.98, -5.0);
  for (const sd of [-1, 1]) {
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 2.8), body), sd * 1.05, -0.28, -1.8);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.82, 0.05), matte(0x0b0c0e)), sd * 1.05, -0.28, -3.22);
  }
  b.add(wingPair(wingGeo(5.7, 4.8, 1.6, 2.6, 0.14), body, 1.1, 0, -1.2));
  b.spoilers(3.2, 0.08, 1.6, 1.7, 0.75, dark);
  for (const sd of [-1, 1]) {
    const f = new THREE.Mesh(finGeo(3.1, 2.9, 1.3, 2.2, 0.12), body);
    f.rotation.z = -sd * 0.35;
    b.add(f, sd * 1.15, 0.5, 4.6);
  }
  b.add(wingPair(wingGeo(2.9, 2.4, 1.0, 1.6, 0.1), body, 1.0, -0.05, 6.6));
  for (const sd of [-1, 1]) b.engine(sd * 0.56, -0.1, 8.9, 0.52);
  b.store("missileIR", -6.85, 0.02, 1.8, false);
  b.store("missileIR", 6.85, 0.02, 1.8, false);
  b.store("missileIR", -5.6, -0.4, 1.4);
  b.store("missileIR", 5.6, -0.4, 1.4);
  b.store("missileRAD", -4.4, -0.45, 0.9);
  b.store("missileRAD", 4.4, -0.45, 0.9);
  b.store("missileRAD", -0.95, -1.0, 0.2, false);
  b.store("missileRAD", 0.95, -1.0, 0.2, false);
  b.store("bomb", -3.0, -0.6, 0.6);
  b.store("bomb", 3.0, -0.6, 0.6);
  b.gearSet(s.gearHeight, 0.4, [[0, -6.2], [-1.6, 1.2], [1.6, 1.2]]);
  b.navLights(6.85, 0.05, 2.6, [0, 3.6, 7.9]);
  b.beacon(0, 0.95, 1.2);
  void dark;
  return b.finish();
}

// ---------------- Cessna 172 ----------------
function buildC172(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body, 0.35, 0.1), accent = paint(s.colors.accent, 0.35, 0.1), dark = matte(0x22262b, 0.6, 0.4);
  b.add(lathe([[-4.6, 0.06], [-3.5, 0.2], [-1.5, 0.45], [0, 0.6], [1.6, 0.62], [2.4, 0.56], [3.2, 0.46], [3.7, 0.3]], body, 20, 1.15));
  b.add(lathe([[2.4, 0.57], [3.2, 0.47], [3.72, 0.3]], accent, 18, 1.16));
  const win = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), glass(s.colors.canopy));
  win.scale.set(0.6, 0.42, 1.05);
  b.add(win, 0, 0.46, -0.9);
  b.pilot(0.55, -0.7);
  b.add(wingPair(wingGeo(5.5, 1.62, 1.15, 0.1, 0.16), body, 0, 0.98, -1.5, 0.03));
  b.spoilers(2.6, 1.14, -0.8, 1.5, 0.42, dark);
  b.add(new THREE.Mesh(new THREE.BoxGeometry(11.02, 0.17, 0.25), accent), 0, 0.98, -1.35);
  for (const sd of [-1, 1]) b.add(rod(new THREE.Vector3(sd * 0.62, -0.45, -0.7), new THREE.Vector3(sd * 2.6, 0.92, -0.8), 0.035, dark));
  b.add(new THREE.Mesh(finGeo(1.55, 1.5, 0.75, 0.95, 0.08), accent), 0, 0.2, 2.9);
  b.add(wingPair(wingGeo(1.75, 1.05, 0.7, 0.2, 0.07), body, 0, 0.12, 3.15));
  const prop = new THREE.Group();
  prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.9, 0.05), dark));
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 14).rotateX(-Math.PI / 2), accent);
  spinner.position.z = -0.18;
  prop.add(spinner);
  b.add(prop, 0, 0, -3.92);
  b.m.prop = prop;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.96, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide })
  );
  b.add(disc, 0, 0, -3.95);
  b.m.propDisc = disc;
  b.gearSet(s.gearHeight, 0.24, [[0, -3.0], [-1.18, 0.4], [1.18, 0.4]]);
  for (const [x, z] of [[0, -3.0], [-1.18, 0.4], [1.18, 0.4]]) {
    const pant = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), accent);
    pant.scale.set(0.17, 0.2, 0.42);
    pant.position.set(x, -s.gearHeight + 0.3, z);
    b.gear.add(pant);
  }
  b.navLights(5.5, 0.98, -0.5, [0, 1.75, 4.2]);
  b.beacon(0, 1.78, 3.9);
  return b.finish();
}

// ---------------- Boeing 737-800 ----------------
function build737(s: AircraftSpec) {
  const b = new Builder();
  const body = paint(s.colors.body, 0.35, 0.25), accent = paint(s.colors.accent, 0.38, 0.25), dark = matte(0x2a2f35, 0.6, 0.5);
  const metal = matte(0xb8bdc2, 0.3, 0.9);
  b.add(lathe([[-19.8, 0.22], [-18.5, 0.75], [-16, 1.45], [-13, 1.88], [12, 1.9], [14.8, 1.8], [16.8, 1.5], [18.5, 0.95], [19.4, 0.45], [19.75, 0.04]], body, 28, 1.06));
  // faixa inferior com a cor da companhia
  const belly = lathe([[-15, 1.2], [-12, 1.85], [12, 1.87], [15, 1.6]], accent, 28, 1.06);
  belly.scale.x = 1.004;
  belly.position.y = -0.55;
  b.add(belly);
  b.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 1.2), matte(0x0d1117, 0.1, 0.8)), 0, 0.98, -17.55);
  const winGeo = new THREE.BoxGeometry(0.06, 0.34, 0.24), winMat = matte(0x111821, 0.15, 0.7);
  const wins = new THREE.InstancedMesh(winGeo, winMat, 60);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 30; i++)
    for (const sd of [-1, 1]) {
      m4.setPosition(sd * 1.98, 0.62, -13 + i * 0.86);
      wins.setMatrixAt(i * 2 + (sd > 0 ? 1 : 0), m4);
    }
  b.add(wins);
  b.add(wingPair(wingGeo(16.0, 7.2, 1.3, 9.0, 0.32), body, 1.9, -1.05, -3.2, 0.1));
  b.spoilers(7.5, -0.3, 2.5, 4.8, 1.05, dark);
  for (const sd of [-1, 1]) {
    const wl = new THREE.Mesh(finGeo(2.4, 1.6, 0.6, 1.0, 0.1), accent);
    wl.rotation.z = -sd * 0.15;
    b.add(wl, sd * 17.85, 0.55, 5.6);
    b.add(lathe([[-2.2, 0.72], [-1.5, 0.95], [1.4, 1.02], [2.2, 0.97]], metal, 22), sd * 5.6, -1.95, -3.6);
    b.add(new THREE.Mesh(new THREE.CircleGeometry(0.92, 22).rotateY(Math.PI), matte(0x14161a, 0.8, 0.3)), sd * 5.6, -1.95, -5.78);
    b.add(new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 16).rotateX(Math.PI / 2), dark), sd * 5.6, -1.95, -0.7);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 2.6), body), sd * 5.6, -1.25, -2.4);
  }
  b.add(new THREE.Mesh(finGeo(7.2, 6.2, 2.0, 4.8, 0.26), accent), 0, 1.4, 13.2);
  b.add(wingPair(wingGeo(6.4, 3.8, 1.2, 3.4, 0.16), body, 0.6, 0.95, 15.0));
  b.gearSet(s.gearHeight, 0.56, [[0, -15.2], [-2.86, 1.0], [2.86, 1.0]], true);
  b.navLights(17.9, 0.6, 6.4, [0, 2.2, 19.5]);
  b.beacon(0, 2.05, -1);
  b.beacon(0, -2.05, 1);
  b.m.exhausts.push(new THREE.Vector3(-5.6, -1.95, -0.2), new THREE.Vector3(5.6, -1.95, -0.2));
  return b.finish();
}

export function buildAircraft(spec: AircraftSpec, reg = ""): AircraftModel {
  REG = reg;
  switch (spec.id) {
    case "a10": return buildA10(spec);
    case "su35": return buildSu35(spec);
    case "fa18": return buildF18(spec);
    case "c172": return buildC172(spec);
    case "b737": return build737(spec);
    default: return buildF16(spec);
  }
}

/** rótulo com tamanho constante na tela (callsign) */
export function makeLabel(text: string, color = "#7dd3fc", sub = ""): THREE.Sprite {
  const { canvas: cv, ctx: ctx2 } = canvas2d();
  cv.width = 512;
  cv.height = 128;
  const ctx = ctx2;
  ctx.fillStyle = "rgba(6,12,22,0.72)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(40, 14, 432, sub ? 100 : 76, 14);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = "bold 46px 'Rajdhani', 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 52);
  if (sub) {
    ctx.font = "600 26px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(220,230,240,0.85)";
    ctx.fillText(sub, 256, 92);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false, toneMapped: false })
  );
  sprite.scale.set(0.15, 0.0375, 1);
  sprite.center.set(0.5, -0.9);
  sprite.renderOrder = 999;
  return sprite;
}