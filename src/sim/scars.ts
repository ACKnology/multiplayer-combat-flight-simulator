import * as THREE from "three";
import { groundHeight, type Quality } from "./terrain";

const R = (a: number, b: number) => a + Math.random() * (b - a);
const Z = new THREE.Vector3(0, 0, 1);

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const craterTex = () =>
  canvasTex(256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(16,11,8,0.96)");
    g.addColorStop(0.42, "rgba(30,22,16,0.92)");
    g.addColorStop(0.58, "rgba(104,84,60,0.62)");
    g.addColorStop(0.75, "rgba(58,46,34,0.3)");
    g.addColorStop(1, "rgba(40,32,24,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * 6.283, r0 = s * R(0.2, 0.3), r1 = s * R(0.38, 0.5);
      c.strokeStyle = `rgba(12,9,7,${R(0.15, 0.4)})`;
      c.lineWidth = R(1, 3.5);
      c.beginPath();
      c.moveTo(s / 2 + Math.cos(a) * r0, s / 2 + Math.sin(a) * r0);
      c.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1);
      c.stroke();
    }
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * 6.283, r = s * R(0.1, 0.46);
      c.fillStyle = `rgba(10,8,6,${R(0.2, 0.5)})`;
      c.beginPath();
      c.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, R(1, 4), 0, 6.283);
      c.fill();
    }
  });

const scorchTex = () =>
  canvasTex(256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(6,5,4,0.82)");
    g.addColorStop(0.5, "rgba(10,8,6,0.5)");
    g.addColorStop(1, "rgba(10,8,6,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, r = s * R(0.05, 0.38);
      const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r, rr = s * R(0.05, 0.14);
      const gg = c.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, `rgba(8,6,5,${R(0.12, 0.3)})`);
      gg.addColorStop(1, "rgba(8,6,5,0)");
      c.fillStyle = gg;
      c.fillRect(0, 0, s, s);
    }
  });

const pockTex = () =>
  canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(8,6,4,1)");
    g.addColorStop(0.35, "rgba(24,18,13,0.92)");
    g.addColorStop(0.55, "rgba(150,130,100,0.38)");
    g.addColorStop(1, "rgba(120,100,80,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });

const holeTex = () =>
  canvasTex(128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(5,4,3,0.55)");
    g.addColorStop(1, "rgba(5,4,3,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.fillStyle = "rgba(4,3,3,0.96)";
    c.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283, r = s * R(0.08, 0.17);
      const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.283;
      c.strokeStyle = `rgba(6,5,4,${R(0.3, 0.6)})`;
      c.lineWidth = R(0.8, 2);
      c.beginPath();
      c.moveTo(s / 2, s / 2);
      c.lineTo(s / 2 + Math.cos(a) * s * R(0.2, 0.45), s / 2 + Math.sin(a) * s * R(0.2, 0.45));
      c.stroke();
    }
  });

class DecalLayer {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private idx = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qz = new THREE.Quaternion();
  constructor(readonly max: number, tex: THREE.Texture, order: number) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4 - order, polygonOffsetUnits: -8 - order * 2,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2 + order;
  }
  add(p: THREE.Vector3, nrm: THREE.Vector3, size: number, off = 0.2) {
    this.q.setFromUnitVectors(Z, nrm);
    this.qz.setFromAxisAngle(Z, Math.random() * 6.283);
    this.q.multiply(this.qz);
    this.m.compose(new THREE.Vector3().copy(p).addScaledVector(nrm, off), this.q, new THREE.Vector3(size, size, 1));
    this.mesh.setMatrixAt(this.idx, this.m);
    this.idx = (this.idx + 1) % this.max;
    this.n = Math.min(this.n + 1, this.max);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  setBrightness(b: number) {
    (this.mesh.material as THREE.MeshBasicMaterial).color.setScalar(b);
  }
}

/**
 * Cicatrizes permanentes (enquanto a simulação durar): crateras, chamuscados, marcas de tiro e
 * furos em paredes. Conformadas ao relevo e limitadas por buffers circulares grandes.
 */
export class Scars {
  private crat: DecalLayer;
  private scor: DecalLayer;
  private pock: DecalLayer;
  private hole: DecalLayer;
  /** crateras grandes (bombas) — perigo para o trem de pouso em pistas */
  bigCraters: { x: number; z: number; r: number }[] = [];
  total = 0;

  constructor(scene: THREE.Scene, quality: Quality) {
    const lo = quality === "low";
    this.scor = new DecalLayer(lo ? 300 : 900, scorchTex(), 0);
    this.crat = new DecalLayer(lo ? 200 : 600, craterTex(), 1);
    this.pock = new DecalLayer(lo ? 3000 : 9000, pockTex(), 2);
    this.hole = new DecalLayer(lo ? 1200 : 4000, holeTex(), 3);
    scene.add(this.scor.mesh, this.crat.mesh, this.pock.mesh, this.hole.mesh);
  }

  normalAt(x: number, z: number, e = 3): THREE.Vector3 {
    const hl = groundHeight(x - e, z), hr = groundHeight(x + e, z), hu = groundHeight(x, z - e), hd = groundHeight(x, z + e);
    return new THREE.Vector3(hl - hr, 2 * e, hu - hd).normalize();
  }

  /** impacto no solo de explosão com raio característico `size` */
  blast(x: number, y: number, z: number, size: number) {
    const n = this.normalAt(x, z, Math.max(2, size * 0.2));
    const p = new THREE.Vector3(x, y, z);
    const off = 0.25 + size * 0.012;
    this.scor.add(p, n, size * 2.3, off);
    if (size >= 8) {
      const dia = size * 0.62;
      this.crat.add(p, n, dia, off + 0.05);
      if (size >= 18) this.bigCraters.push({ x, z, r: dia * 0.5 });
    }
    // marcas secundárias de estilhaços ao redor
    const nPock = Math.min(26, Math.floor(size * 0.7));
    for (let i = 0; i < nPock; i++) {
      const a = Math.random() * 6.283, r = size * R(0.5, 1.5);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      this.pock.add(new THREE.Vector3(px, groundHeight(px, pz), pz), this.normalAt(px, pz, 1.5), R(0.5, 1.6), 0.15);
    }
    this.total++;
  }

  /** mancha de fuligem num ponto qualquer (ex.: base de prédio destruído, parede atingida) */
  scorch(p: THREE.Vector3, n: THREE.Vector3, diameter: number) {
    this.scor.add(p, n, diameter, 0.2 + diameter * 0.004);
    this.total++;
  }

  /** marca de projétil no solo */
  ground(p: THREE.Vector3) {
    const n = this.normalAt(p.x, p.z, 1.2);
    this.pock.add(p, n, R(0.6, 1.5), 0.12);
    this.total++;
  }

  /** furo/rachadura em parede ou carroceria */
  wall(p: THREE.Vector3, n: THREE.Vector3, size = R(0.5, 1.3)) {
    this.hole.add(p, n, size, 0.06);
    this.total++;
  }

  craterNear(x: number, z: number, margin: number) {
    for (const c of this.bigCraters) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + margin) ** 2) return c;
    return null;
  }

  setBrightness(b: number) {
    for (const l of [this.crat, this.scor, this.pock, this.hole]) l.setBrightness(b);
  }
}