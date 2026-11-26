import * as THREE from "three";
import type { Quality } from "./terrain";
import type { Scars } from "./scars";

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  return canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.22, "rgba(255,255,255,0.85)");
    g.addColorStop(0.55, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

function blobs(c: CanvasRenderingContext2D, s: number, count: number, spread: number, alpha: number, shade = false) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * s * spread;
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r * (shade ? 0.7 : 1);
    const rr = s * (0.12 + Math.random() * 0.2);
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    const v = shade ? Math.round(255 - Math.max(0, (y - s * 0.4) / s) * 120) : 200 + Math.floor(Math.random() * 55);
    g.addColorStop(0, `rgba(${v},${v},${Math.min(255, v + 6)},${alpha})`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
}

export function smokeTexture() {
  return canvasTex(128, (c, s) => blobs(c, s, 22, 0.22, 0.34));
}

export function cloudTexture() {
  return canvasTex(128, (c, s) => blobs(c, s, 30, 0.26, 0.3, true));
}

function craterTexture() {
  return canvasTex(128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(14,11,9,0.95)");
    g.addColorStop(0.45, "rgba(30,24,18,0.85)");
    g.addColorStop(0.75, "rgba(45,38,30,0.35)");
    g.addColorStop(1, "rgba(45,38,30,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = `rgba(10,8,6,${0.2 + Math.random() * 0.3})`;
      c.beginPath();
      const a = Math.random() * Math.PI * 2, r = s * (0.2 + Math.random() * 0.25);
      c.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 2 + Math.random() * 6, 0, Math.PI * 2);
      c.fill();
    }
  });
}

export interface PSpawn {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number; s0: number; s1: number;
  c0: [number, number, number, number];
  c1: [number, number, number, number];
  drag?: number; grav?: number; rot?: number; rotV?: number;
}

/** Partículas em billboards instanciados (1 draw call por camada). */
export class ParticleLayer {
  readonly mesh: THREE.Mesh;
  uniforms!: Record<string, THREE.IUniform>;
  readonly max: number;
  n = 0;
  private geo: THREE.InstancedBufferGeometry;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array;
  private sz: Float32Array; private c0: Float32Array; private c1: Float32Array;
  private rot: Float32Array; private dg: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aSize: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute; private aRot: THREE.InstancedBufferAttribute;

  constructor(max: number, tex: THREE.Texture, additive: boolean, fog: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max * 2);
    this.sz = new Float32Array(max * 2);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.rot = new Float32Array(max * 2);
    this.dg = new Float32Array(max * 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", this.aPos);
    g.setAttribute("iSize", this.aSize);
    g.setAttribute("iCol", this.aCol);
    g.setAttribute("iRot", this.aRot);
    g.instanceCount = 0;
    this.geo = g;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.map = { value: tex };
    uniforms.tint = { value: new THREE.Color(1, 1, 1) };
    uniforms.opacity = { value: 1 };
    this.uniforms = uniforms;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      fog,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute float iSize; attribute vec4 iCol; attribute float iRot;
        varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vCol = iCol;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iRot), s = sin(iRot);
          vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          mvPosition.xy += p * iSize;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 tint; uniform float opacity;
        varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(vCol.rgb * t.rgb * tint, vCol.a * t.a * opacity);
          if (gl_FragColor.a < 0.004) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 10;
  }

  spawn(p: PSpawn) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0; this.vel[i * 3 + 1] = p.vy ?? 0; this.vel[i * 3 + 2] = p.vz ?? 0;
    this.life[i * 2] = p.life; this.life[i * 2 + 1] = p.life;
    this.sz[i * 2] = p.s0; this.sz[i * 2 + 1] = p.s1;
    this.c0.set(p.c0, i * 4);
    this.c1.set(p.c1, i * 4);
    this.rot[i * 2] = p.rot ?? Math.random() * 6.28; this.rot[i * 2 + 1] = p.rotV ?? (Math.random() - 0.5) * 0.6;
    this.dg[i * 2] = p.drag ?? 0; this.dg[i * 2 + 1] = p.grav ?? 0;
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.life.copyWithin(i * 2, j * 2, j * 2 + 2);
    this.sz.copyWithin(i * 2, j * 2, j * 2 + 2);
    this.c0.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.c1.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.rot.copyWithin(i * 2, j * 2, j * 2 + 2);
    this.dg.copyWithin(i * 2, j * 2, j * 2 + 2);
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i * 2] -= dt;
      if (this.life[i * 2] <= 0) this.kill(i);
      else i++;
    }
    const size = this.aSize.array as Float32Array, col = this.aCol.array as Float32Array, rot = this.aRot.array as Float32Array;
    for (let k = 0; k < this.n; k++) {
      const t = 1 - this.life[k * 2] / this.life[k * 2 + 1];
      const damp = Math.max(0, 1 - this.dg[k * 2] * dt);
      this.vel[k * 3] *= damp;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * damp - this.dg[k * 2 + 1] * dt;
      this.vel[k * 3 + 2] *= damp;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.rot[k * 2] += this.rot[k * 2 + 1] * dt;
      const e = 1 - (1 - t) * (1 - t);
      size[k] = this.sz[k * 2] + (this.sz[k * 2 + 1] - this.sz[k * 2]) * e;
      rot[k] = this.rot[k * 2];
      const fadeIn = Math.min(1, t * 12 + 0.08);
      for (let c = 0; c < 4; c++) {
        const v = this.c0[k * 4 + c] + (this.c1[k * 4 + c] - this.c0[k * 4 + c]) * t;
        col[k * 4 + c] = c === 3 ? v * fadeIn : v;
      }
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aRot.needsUpdate = true;
  }
}

interface Emitter {
  pos: THREE.Vector3; until: number; size: number; acc: number; smokeOnly: boolean;
  follow?: () => THREE.Vector3 | null;
}

const R = (a: number, b: number) => a + Math.random() * (b - a);

export class FX {
  readonly fire: ParticleLayer;
  readonly smoke: ParticleLayer;
  private scene: THREE.Scene;
  private lights: { l: THREE.PointLight; t: number; max: number; peak: number }[] = [];
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private decalGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private decalMat: THREE.MeshBasicMaterial;
  private ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  private rings: { m: THREE.Mesh; t: number; max: number; size: number }[] = [];
  private emitters: Emitter[] = [];
  private maxDecals: number;

  constructor(scene: THREE.Scene, quality: Quality) {
    this.scene = scene;
    const lo = quality === "low";
    this.fire = new ParticleLayer(lo ? 700 : 1600, glowTexture(), true, false);
    this.smoke = new ParticleLayer(lo ? 1000 : 2600, smokeTexture(), false, true);
    scene.add(this.fire.mesh, this.smoke.mesh);
    this.decalMat = new THREE.MeshBasicMaterial({
      map: craterTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.maxDecals = lo ? 30 : 70;
    // pool fixo de luzes (evita recompilar shaders)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 600, 2);
      scene.add(l);
      this.lights.push({ l, t: 0, max: 1, peak: 0 });
    }
  }

  flash(p: THREE.Vector3, size: number, dur = 0.35) {
    const slot = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    slot.l.position.copy(p);
    slot.l.distance = size * 18;
    slot.peak = 2.5 * (size * 4) ** 2;
    slot.t = dur;
    slot.max = dur;
  }

  /** cicatrizes permanentes (crateras/chamuscados) ficam a cargo de Scars */
  scars: Scars | null = null;

  decal(x: number, y: number, z: number, r: number) {
    this.scars?.blast(x, y, z, r / 0.7);
  }

  explosion(p: THREE.Vector3, size: number, o: { groundY?: number; water?: boolean } = {}) {
    this.flash(p, size);
    // núcleo
    this.fire.spawn({ x: p.x, y: p.y, z: p.z, life: 0.2, s0: size * 1.1, s1: size * 2.4, c0: [9, 7, 5, 1], c1: [3, 1.5, 0.6, 0] });
    // bola de fogo
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(R(0.2, 0.9) * size);
      this.fire.spawn({
        x: p.x, y: p.y, z: p.z, vx: v.x, vy: Math.abs(v.y) * 0.8 + size * 0.15, vz: v.z,
        life: R(0.5, 1.15), s0: size * R(0.35, 0.6), s1: size * R(1.0, 1.7),
        c0: [5, 2.4, 0.7, 1], c1: [1.4, 0.25, 0.05, 0], drag: 2.2,
      });
    }
    // brasas
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(R(0.6, 1.6) * size);
      this.fire.spawn({
        x: p.x, y: p.y, z: p.z, vx: v.x, vy: Math.abs(v.y) + size * 0.4, vz: v.z, life: R(0.9, 2.0),
        s0: R(0.6, 1.4), s1: 0.2, c0: [6, 3, 1, 1], c1: [2, 0.4, 0.1, 0], grav: 9.8, drag: 0.4,
      });
    }
    // fumaça
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(R(0.1, 0.45) * size);
      const g = R(0.08, 0.16);
      this.smoke.spawn({
        x: p.x + v.x * 0.5, y: p.y + v.y * 0.5, z: p.z + v.z * 0.5, vx: v.x, vy: Math.abs(v.y) * 0.5 + size * 0.12, vz: v.z,
        life: R(3, 6.5), s0: size * R(0.5, 0.8), s1: size * R(2.2, 3.4), c0: [g, g * 0.95, g * 0.9, 0.85], c1: [0.42, 0.4, 0.38, 0],
        drag: 0.7, grav: -1.2,
      });
    }
    // destroços
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(R(0.5, 1.4) * size);
      this.smoke.spawn({
        x: p.x, y: p.y, z: p.z, vx: v.x, vy: Math.abs(v.y) + size * 0.5, vz: v.z, life: R(1.4, 2.6),
        s0: R(0.5, 1.6), s1: R(0.4, 1.2), c0: [0.05, 0.045, 0.04, 1], c1: [0.05, 0.045, 0.04, 0.9], grav: 9.8, drag: 0.15, rotV: R(-6, 6),
      });
    }
    if (o.water) {
      for (let i = 0; i < 26; i++) {
        this.smoke.spawn({
          x: p.x + R(-1, 1) * size * 0.3, y: p.y, z: p.z + R(-1, 1) * size * 0.3,
          vx: R(-1, 1) * size * 0.2, vy: R(0.8, 1.9) * size, vz: R(-1, 1) * size * 0.2,
          life: R(1.5, 2.8), s0: size * 0.3, s1: size * R(0.9, 1.4), c0: [2.2, 2.3, 2.4, 0.9], c1: [1.6, 1.7, 1.8, 0], grav: 9.8, drag: 0.3,
        });
      }
    } else if (o.groundY !== undefined && p.y - o.groundY < size * 0.8) {
      this.decal(p.x, o.groundY, p.z, size * 0.7);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.smoke.spawn({
          x: p.x, y: o.groundY + 1, z: p.z, vx: Math.cos(a) * size * 1.6, vy: R(1, 4), vz: Math.sin(a) * size * 1.6,
          life: R(1.8, 3), s0: size * 0.4, s1: size * 1.5, c0: [0.5, 0.42, 0.32, 0.7], c1: [0.6, 0.52, 0.42, 0], drag: 1.6,
        });
      }
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.8), transparent: true, opacity: 0.55, depthWrite: false })
      );
      ring.position.set(p.x, o.groundY + 0.8, p.z);
      this.scene.add(ring);
      this.rings.push({ m: ring, t: 0, max: 0.6, size });
    }
  }

  spark(p: THREE.Vector3) {
    this.fire.spawn({ x: p.x, y: p.y, z: p.z, life: 0.12, s0: 2.2, s1: 4, c0: [8, 6, 3, 1], c1: [3, 1, 0.2, 0] });
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(R(15, 40));
      this.fire.spawn({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: R(0.2, 0.45), s0: 0.6, s1: 0.1, c0: [8, 5, 2, 1], c1: [3, 1, 0.2, 0], grav: 9.8 });
    }
  }

  dust(p: THREE.Vector3, water: boolean) {
    for (let i = 0; i < 4; i++) {
      this.smoke.spawn({
        x: p.x, y: p.y + 0.5, z: p.z, vx: R(-3, 3), vy: water ? R(8, 16) : R(3, 9), vz: R(-3, 3), life: R(0.8, 1.6),
        s0: 1.5, s1: R(4, 7), c0: water ? [2.1, 2.2, 2.3, 0.8] : [0.55, 0.47, 0.36, 0.75], c1: water ? [1.6, 1.7, 1.8, 0] : [0.6, 0.53, 0.43, 0],
        drag: 1.2, grav: water ? 9.8 : 0,
      });
    }
  }

  /** rastro de míssil */
  trail(p: THREE.Vector3) {
    this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: R(-0.5, 0.5), vy: R(0, 1), vz: R(-0.5, 0.5), life: R(2.2, 3.4), s0: 1.4, s1: R(6, 9), c0: [2.0, 2.0, 2.0, 0.55], c1: [1.4, 1.4, 1.45, 0], drag: 0.5 });
    this.fire.spawn({ x: p.x, y: p.y, z: p.z, life: 0.07, s0: 1.8, s1: 0.8, c0: [9, 5, 2, 1], c1: [4, 1, 0.2, 0] });
  }

  /** fumaça genérica (motor danificado, vórtices, etc.) */
  puff(p: THREE.Vector3, rgb: [number, number, number], alpha: number, s0: number, s1: number, life: number, v?: THREE.Vector3) {
    this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: v?.x ?? 0, vy: v?.y ?? 0, vz: v?.z ?? 0, life, s0, s1, c0: [rgb[0], rgb[1], rgb[2], alpha], c1: [rgb[0], rgb[1], rgb[2], 0], drag: 0.8 });
  }

  flame(p: THREE.Vector3, s: number) {
    this.fire.spawn({ x: p.x + R(-0.3, 0.3) * s, y: p.y, z: p.z + R(-0.3, 0.3) * s, vy: R(2, 6), life: R(0.3, 0.7), s0: s * R(0.6, 1), s1: s * 0.2, c0: [5, 2.2, 0.6, 1], c1: [1.5, 0.3, 0.05, 0] });
  }

  /** foco de incêndio persistente */
  burn(p: THREE.Vector3, size: number, ms: number, follow?: () => THREE.Vector3 | null, smokeOnly = false) {
    this.emitters.push({ pos: p.clone(), until: performance.now() + ms, size, acc: 0, smokeOnly, follow });
  }

  update(dt: number) {
    const now = performance.now();
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (now > e.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      if (e.follow) {
        const f = e.follow();
        if (!f) {
          this.emitters.splice(i, 1);
          continue;
        }
        e.pos.copy(f);
      }
      e.acc += dt;
      const fade = Math.min(1, (e.until - now) / 4000);
      while (e.acc > 0.05) {
        e.acc -= 0.05;
        if (!e.smokeOnly) {
          this.flame(e.pos, e.size * 0.8 * fade + 0.5);
          this.flame(e.pos, e.size * 0.6 * fade + 0.5);
        }
        if (Math.random() < 0.55) {
          const g = R(0.06, 0.14);
          this.smoke.spawn({
            x: e.pos.x + R(-0.4, 0.4) * e.size, y: e.pos.y + e.size * 0.5, z: e.pos.z + R(-0.4, 0.4) * e.size,
            vx: R(-1, 1) + 2, vy: R(4, 8), vz: R(-1, 1), life: R(5, 9), s0: e.size * 0.8, s1: e.size * R(3, 4.5),
            c0: [g, g, g, 0.7 * fade + 0.1], c1: [0.35, 0.34, 0.33, 0], drag: 0.25, grav: -0.4,
          });
        }
      }
    }
    for (const s of this.lights) {
      if (s.t <= 0) {
        s.l.intensity = 0;
        continue;
      }
      s.t -= dt;
      s.l.intensity = Math.max(0, s.peak * (s.t / s.max) ** 2);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.max;
      r.m.scale.setScalar(r.size * (0.6 + k * 5));
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.m);
        (r.m.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    this.fire.update(dt);
    this.smoke.update(dt);
  }
}