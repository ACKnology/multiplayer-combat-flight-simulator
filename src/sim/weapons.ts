import * as THREE from "three";
import { groundHeight, isWater, type Terrain } from "./terrain";
import { segSphere, type DamageRegistry, type Damageable, type WeaponType } from "./damage";
import type { FX } from "./fx";
import type { Layout } from "./world";
import type { Scars } from "./scars";

type PKind = "bullet" | "bomb" | "ir" | "radio";

export interface Decoy {
  id: number;
  kind: "flare" | "chaff";
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  ttl: number;
  owner: string;
  trailT: number;
}

interface Seeker {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dec: Decoy | null;
  decided: Set<number>;
}

interface Projectile extends Seeker {
  kind: PKind;
  mesh: THREE.Object3D;
  prev: THREE.Vector3;
  ttl: number;
  age: number;
  target: Damageable | null;
  tgtPrev: THREE.Vector3;
  lastRef: THREE.Vector3 | null;
  trailT: number;
  dmg: number;
}

interface Threat extends Seeker {
  type: "ir" | "radar";
  mesh: THREE.Object3D;
  prev: THREE.Vector3;
  age: number;
  by: string;
  trailT: number;
  lost: boolean;
}

interface Mover {
  d: Damageable;
  obj: THREE.Object3D;
  cx: number; cz: number; r: number; ang: number; speed: number; alt: number; air: boolean;
}

interface Wreck { pos: THREE.Vector3; vel: THREE.Vector3; alive: boolean }

export interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
  heat: number;
  onGround: boolean;
  agl: number;
  g: number;
  radius: number;
}

export interface Warning { kind: "lock" | "ir" | "radar"; dist: number; by: string }

export interface WeaponCallbacks {
  onEvent: (text: string) => void;
  onSound: (kind: "boom" | "impact", dist: number, size: number) => void;
  onThreat: (text: string) => void;
  onPlayerHit: (dmg: number, by: string) => void;
}

const FWD = new THREE.Vector3(0, 0, -1);

export class WeaponSystem {
  projectiles: Projectile[] = [];
  decoys: Decoy[] = [];
  warning: Warning | null = null;
  eye = new THREE.Vector3();
  private threats: Threat[] = [];
  private sams: { d: Damageable; cd: number; tracking: boolean }[] = [];
  private decoyId = 1;
  private movers: Mover[] = [];
  private wrecks: Wreck[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.08, 0.08, 10, 5).rotateX(Math.PI / 2);
  private tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 2.2) });
  private bombGeo = new THREE.CapsuleGeometry(0.21, 1.5, 4, 10).rotateX(Math.PI / 2);
  private bombMat = new THREE.MeshStandardMaterial({ color: 0x4b5638, roughness: 0.6 });

  constructor(
    private scene: THREE.Scene,
    private registry: DamageRegistry,
    private fx: FX,
    private scars: Scars,
    private cb: WeaponCallbacks
  ) {}

  // ------------------------------------------------------------------ alvos hostis
  buildTargets(L: Layout, terrain: Terrain) {
    const center = new THREE.Vector3(L.active.cx, 0, L.active.cz);
    const tc = center.clone().addScaledVector(L.right, 7000).addScaledVector(L.dir, 1500);
    const rotY = Math.atan2(-L.dir.z, L.dir.x);
    const olive = new THREE.MeshStandardMaterial({ color: 0x4d5639, roughness: 0.8 });
    const sand = new THREE.MeshStandardMaterial({ color: 0x8a7d5c, roughness: 0.85 });
    const hulk = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 1 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x6f7781, roughness: 0.55, metalness: 0.4 });

    const place = (obj: THREE.Object3D, p: THREE.Vector3, name: string, half: THREE.Vector3, hp: number, points: number, heat: number, sea = false) => {
      const y = sea ? terrain.seaY : groundHeight(p.x, p.z);
      obj.position.set(p.x, y, p.z);
      obj.rotation.y = rotY;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      this.scene.add(obj);
      const wreck = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2 * 0.9, Math.max(0.8, half.y * 0.7), half.z * 2 * 0.9), hulk);
      wreck.position.set(p.x, y + half.y * 0.35, p.z);
      wreck.rotation.y = rotY + 0.2;
      wreck.visible = false;
      this.scene.add(wreck);
      const d = this.registry.add({
        id: `tgt-${name}-${Math.round(p.x)}-${Math.round(p.z)}`, name, kind: sea ? "ship" : "vehicle", team: "hostile",
        center: new THREE.Vector3(p.x, y + half.y, p.z), half, rotY, radius: half.length(), hp, points, heat, respawnMs: 90000,
        onDestroyed: () => {
          obj.visible = false;
          wreck.visible = !sea;
          const c = new THREE.Vector3(p.x, y + half.y, p.z);
          this.fx.explosion(c, Math.max(10, half.length() * 1.2), sea ? { water: true } : { groundY: y });
          if (!sea) this.scars.scorch(new THREE.Vector3(p.x, y, p.z), this.scars.normalAt(p.x, p.z), Math.max(12, half.length() * 3));
          this.fx.burn(c, Math.max(3, half.x * 0.6), sea ? 30000 : 45000);
        },
        onRespawn: () => {
          obj.visible = true;
          wreck.visible = false;
        },
      });
      return d;
    };

    if (terrain.isWaterRaw(tc.x, tc.z)) {
      for (let i = 0; i < 3; i++) {
        const big = i < 2;
        const g = new THREE.Group();
        const L2 = big ? 120 : 45, B = big ? 14 : 7;
        const hull = new THREE.Mesh(new THREE.BoxGeometry(L2, big ? 8 : 4, B), grey);
        hull.position.y = 2;
        const bow = new THREE.Mesh(new THREE.ConeGeometry(B / 2, big ? 22 : 9, 4).rotateZ(-Math.PI / 2), grey);
        bow.position.set(L2 / 2 + (big ? 11 : 4.5), 2, 0);
        const sup = new THREE.Mesh(new THREE.BoxGeometry(L2 * 0.3, big ? 12 : 5, B * 0.7), grey);
        sup.position.y = big ? 12 : 6;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, big ? 18 : 8, 6), grey);
        mast.position.set(0, big ? 26 : 12, 0);
        g.add(hull, bow, sup, mast);
        const p = tc.clone().addScaledVector(L.dir, (i - 1) * 520).addScaledVector(L.right, (i % 2) * 300);
        const d = place(g, p, big ? `FRAGATA ${i + 1}` : "LANCHA DE PATRULHA", new THREE.Vector3(L2 / 2 + 6, big ? 10 : 5, B / 2), big ? 700 : 220, big ? 800 : 300, 0.7, true);
        this.movers.push({ d, obj: g, cx: p.x, cz: p.z, r: 260 + i * 120, ang: i * 2, speed: (big ? 7 : 14) / (260 + i * 120), alt: 0, air: false });
        if (big) this.sams.push({ d, cd: 10 + i * 6, tracking: false });
      }
    } else {
      const tank = () => {
        const g = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.5, 3.6), olive);
        hull.position.y = 1.1;
        const tur = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.95, 2.4), olive);
        tur.position.y = 2.3;
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 4.2, 8).rotateZ(Math.PI / 2), olive);
        gun.position.set(3.3, 2.35, 0);
        const ex = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.2) }));
        ex.position.set(-3.1, 1.6, 0.8);
        g.add(hull, tur, gun, ex);
        return g;
      };
      const truck = () => {
        const g = new THREE.Group();
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2.4), sand);
        cab.position.set(2.6, 1.5, 0);
        const bed = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 2.5), olive);
        bed.position.set(-0.6, 1.7, 0);
        g.add(cab, bed);
        return g;
      };
      for (let i = 0; i < 8; i++) {
        const isTank = i % 3 !== 2;
        const p = tc.clone().addScaledVector(L.dir, (i - 4) * 42).addScaledVector(L.right, (i % 2) * 8);
        place(isTank ? tank() : truck(), p, isTank ? `BLINDADO ${i + 1}` : `CAMINHÃO ${i + 1}`, isTank ? new THREE.Vector3(3.4, 1.3, 1.9) : new THREE.Vector3(3.3, 1.4, 1.3), isTank ? 120 : 45, isTank ? 150 : 80, isTank ? 0.75 : 0.5);
      }
      // dois sítios SAM (um IR, um radar) protegem o comboio
      for (let k = 0; k < 2; k++) {
        const sam = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 3.4), olive);
        base.position.y = 1;
        const rack = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 2.6), sand);
        rack.position.set(0, 3, 0);
        rack.rotation.z = 0.45;
        sam.add(base, rack);
        const d = place(sam, tc.clone().addScaledVector(L.right, 520 + k * 120).addScaledVector(L.dir, k * 220 - 80), `SÍTIO SAM ${k + 1}`, new THREE.Vector3(3.6, 2.2, 1.8), 160, 320, 0.6);
        this.sams.push({ d, cd: 8 + k * 9, tracking: false });
      }
      const radar = new THREE.Group();
      const mastR = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 8, 8), grey);
      mastR.position.y = 4;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), grey);
      dish.position.y = 8.5;
      dish.rotation.x = Math.PI / 2;
      radar.add(mastR, dish);
      place(radar, tc.clone().addScaledVector(L.right, 560).addScaledVector(L.dir, 60), "RADAR DE BUSCA", new THREE.Vector3(3, 5, 3), 110, 260, 0.45);
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 11, 18), new THREE.MeshStandardMaterial({ color: 0xa9a28f, metalness: 0.4, roughness: 0.5 }));
        t.position.y = 5.5;
        const g = new THREE.Group();
        g.add(t);
        const p = tc.clone().addScaledVector(L.right, 900).addScaledVector(L.dir, 420 + i * 26);
        const d = place(g, p, "DEPÓSITO INIMIGO", new THREE.Vector3(9, 5.5, 9), 160, 220, 0.5);
        const prev = d.onDestroyed;
        d.onDestroyed = (w, at) => {
          prev?.(w, at);
          setTimeout(() => this.registry.explode(d.center.clone(), 40, 220, "blast", true, performance.now()), 220);
        };
      }
      const bunker = new THREE.Group();
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 18), sand);
      b1.position.y = 3;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), olive);
      b2.position.set(4, 8, 0);
      bunker.add(b1, b2);
      place(bunker, tc.clone().addScaledVector(L.dir, -650), "BUNKER DE COMANDO", new THREE.Vector3(13, 5.5, 9), 520, 400, 0.2);
    }

    const droneMat = new THREE.MeshStandardMaterial({ color: 0x7a2e2e, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const fus = new THREE.Mesh(new THREE.ConeGeometry(0.8, 6, 10).rotateX(-Math.PI / 2), droneMat);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 1.6), droneMat);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 1.2), droneMat);
      tail.position.set(0, 0.6, 2.6);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2, 0.5) }));
      glow.position.z = 3;
      g.add(fus, wing, tail, glow);
      this.scene.add(g);
      const alt = 600 + i * 260;
      const d = this.registry.add({
        id: `drone-${i}`, name: `DRONE HOSTIL ${i + 1}`, kind: "drone", team: "hostile", center: new THREE.Vector3(),
        radius: 5.5, hp: 40, points: 500, heat: 1, respawnMs: 50000,
        onDestroyed: () => {
          g.visible = false;
          this.fx.explosion(d.center.clone(), 9);
          const w: Wreck = { pos: d.center.clone(), vel: new THREE.Vector3(0, -5, 0), alive: true };
          this.wrecks.push(w);
          this.fx.burn(w.pos, 2.5, 20000, () => (w.alive ? w.pos : null));
        },
        onRespawn: () => { g.visible = true; },
      });
      this.movers.push({ d, obj: g, cx: tc.x, cz: tc.z, r: 1800 + i * 700, ang: i * 2.1, speed: 45 / (1800 + i * 700), alt, air: true });
    }
  }

  // ------------------------------------------------------------------ contramedidas
  dispenseFlares(pos: THREE.Vector3, vel: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3, count: number, owner = "me") {
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const v = vel.clone().multiplyScalar(0.88)
        .addScaledVector(up, -5 - Math.random() * 3)
        .addScaledVector(right, side * (6 + Math.random() * 4));
      v.x += (Math.random() - 0.5) * 3;
      v.z += (Math.random() - 0.5) * 3;
      this.decoys.push({
        id: this.decoyId++, kind: "flare", owner, age: 0, ttl: 5 + Math.random() * 1.5, trailT: 0,
        pos: pos.clone().addScaledVector(up, -1.2).addScaledVector(right, side * 0.9), vel: v,
      });
    }
  }

  dispenseChaff(pos: THREE.Vector3, vel: THREE.Vector3, up: THREE.Vector3, owner = "me") {
    this.decoys.push({
      id: this.decoyId++, kind: "chaff", owner, age: 0, ttl: 7, trailT: 0,
      pos: pos.clone().addScaledVector(up, -1.2), vel: vel.clone().multiplyScalar(0.55).addScaledVector(up, -2),
    });
  }

  private updateDecoys(dt: number) {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.age += dt;
      let dead = d.age > d.ttl;
      if (d.kind === "flare") {
        d.vel.y -= 4.5 * dt;
        d.vel.multiplyScalar(Math.max(0, 1 - 0.55 * dt));
        d.pos.addScaledVector(d.vel, dt);
        const fade = 1 - (d.age / d.ttl) * 0.45;
        this.fx.fire.spawn({ x: d.pos.x, y: d.pos.y, z: d.pos.z, life: 0.1, s0: 3.6 * fade, s1: 2.4 * fade, c0: [14, 10, 6, 1], c1: [5, 2.5, 0.8, 0] });
        d.trailT -= dt;
        if (d.trailT <= 0) {
          d.trailT = 0.035;
          this.fx.smoke.spawn({
            x: d.pos.x, y: d.pos.y, z: d.pos.z, vx: (Math.random() - 0.5) * 1.5, vy: 0.4, vz: (Math.random() - 0.5) * 1.5,
            life: 3 + Math.random(), s0: 0.9, s1: 5 + Math.random() * 2, c0: [1.9, 1.9, 1.9, 0.38], c1: [1.4, 1.4, 1.45, 0], drag: 0.4,
          });
        }
        if (d.pos.y <= groundHeight(d.pos.x, d.pos.z) + 0.5) dead = true;
      } else {
        d.vel.multiplyScalar(Math.max(0, 1 - 0.9 * dt));
        d.vel.y -= 0.8 * dt;
        d.pos.addScaledVector(d.vel, dt);
        if (d.age < 1.6) {
          for (let k = 0; k < 3; k++) {
            this.fx.smoke.spawn({
              x: d.pos.x + (Math.random() - 0.5) * 3, y: d.pos.y + (Math.random() - 0.5) * 3, z: d.pos.z + (Math.random() - 0.5) * 3,
              vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9, vz: (Math.random() - 0.5) * 9,
              life: 3.5 + Math.random() * 1.5, s0: 1.2, s1: 13 + Math.random() * 8, c0: [2.6, 2.6, 2.8, 0.26], c1: [2, 2, 2.2, 0], drag: 1.2,
            });
          }
        }
      }
      if (dead) this.decoys.splice(i, 1);
    }
  }

  /** o buscador é seduzido por uma isca próxima ao alvo (decisão única por isca) */
  private seduce(m: Seeker, kind: "flare" | "chaff", owner: string, primary: THREE.Vector3, pBase: number, cone: number): THREE.Vector3 | null {
    const fwd = m.vel.clone().normalize();
    if (m.dec) {
      if (this.decoys.includes(m.dec)) {
        if (fwd.angleTo(m.dec.pos.clone().sub(m.pos)) < 1.25) return m.dec.pos;
      }
      m.dec = null;
    }
    for (const d of this.decoys) {
      if (d.kind !== kind || d.owner !== owner || m.decided.has(d.id)) continue;
      if (fwd.angleTo(d.pos.clone().sub(m.pos)) > cone) continue;
      if (d.pos.distanceTo(primary) > (kind === "flare" ? 700 : 500)) continue;
      m.decided.add(d.id);
      if (Math.random() < pBase) {
        m.dec = d;
        return d.pos;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ disparos do jogador
  fireCannon(pos: THREE.Vector3, dir: THREE.Vector3, inherit: THREE.Vector3, spread: number, dmg: number) {
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * spread;
    d.y += (Math.random() - 0.5) * spread;
    d.z += (Math.random() - 0.5) * spread;
    d.normalize();
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    this.scene.add(mesh);
    this.projectiles.push(this.mkProj("bullet", mesh, pos, d.multiplyScalar(1000).add(inherit), 2.4, null, dmg));
  }

  private mkProj(kind: PKind, mesh: THREE.Object3D, pos: THREE.Vector3, vel: THREE.Vector3, ttl: number, target: Damageable | null, dmg: number): Projectile {
    return {
      kind, mesh, pos: pos.clone(), prev: pos.clone(), vel, ttl, age: 0, target, tgtPrev: target ? target.center.clone() : new THREE.Vector3(),
      lastRef: null, trailT: 0, dmg, dec: null, decided: new Set(),
    };
  }

  fireBomb(pos: THREE.Vector3, vel: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.projectiles.push(this.mkProj("bomb", mesh, pos, vel.clone(), 70, null, 450));
  }

  private missileMesh(nose: number, len: number, r: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdcdcd5, roughness: 0.45, metalness: 0.3 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r, r * 5, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: nose, roughness: 0.4 }));
    tip.position.z = -len / 2 - r * 2.5;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r * 1.6, len * 0.7, 10).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5, 1.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.position.z = len / 2 + len * 0.35;
    g.add(body, tip, flame);
    return g;
  }

  findIRLock(pos: THREE.Vector3, fwd: THREE.Vector3, minCos = 0.9): Damageable | null {
    let best: Damageable | null = null;
    let bestScore = -1;
    for (const t of this.registry.items) {
      if (!t.alive || t.heat < 0.3 || t.kind === "building") continue;
      const to = t.center.clone().sub(pos);
      const dist = to.length();
      if (dist > 9000 || dist < 60) continue;
      const cos = to.divideScalar(dist).dot(fwd);
      if (cos < minCos) continue;
      const s = t.heat * (cos - minCos + 0.05) * (1.15 - dist / 10000);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return best;
  }

  fireIR(pos: THREE.Vector3, dir: THREE.Vector3, vel: THREE.Vector3, target: Damageable) {
    const mesh = this.missileMesh(0x2b2b2b, 2.9, 0.064);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push(this.mkProj("ir", mesh, pos, vel.clone().addScaledVector(dir, 40), 22, target, 140));
    this.cb.onEvent(`FOX-2! Míssil IR disparado contra ${target.name}`);
  }

  fireRadio(pos: THREE.Vector3, dir: THREE.Vector3, vel: THREE.Vector3) {
    const mesh = this.missileMesh(0x1f5fa8, 3.6, 0.09);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push(this.mkProj("radio", mesh, pos, vel.clone().addScaledVector(dir, 30), 40, null, 190));
    this.cb.onEvent("Míssil guiado por rádio no ar — mantenha a mira sobre o alvo (comando por linha de visada)");
  }

  missiles() {
    return [...this.projectiles.filter((p) => p.kind === "ir" || p.kind === "radio").map((p) => p.pos), ...this.threats.map((t) => t.pos)];
  }

  // ------------------------------------------------------------------ impactos
  private detonate(p: Projectile, at: THREE.Vector3, hit: { item: Damageable; normal: THREE.Vector3 } | null, now: number) {
    const w: WeaponType = p.kind === "bullet" ? "bullet" : p.kind;
    const direct = hit?.item ?? null;
    const solid = direct && ["building", "structure", "vehicle", "ship"].includes(direct.kind);
    if (p.kind === "bullet") {
      if (direct) {
        this.registry.damage(direct, p.dmg, at, "bullet", true, now);
        this.fx.spark(at);
        if (solid && hit) this.scars.wall(at, hit.normal);
      } else {
        const water = isWater(at.x, at.z);
        this.fx.dust(at, water);
        if (!water) {
          this.scars.ground(at);
          if (Math.random() < 0.3) this.fx.spark(at);
        }
      }
      return;
    }
    const size = p.kind === "bomb" ? 34 : p.kind === "radio" ? 18 : 14;
    const blastR = p.kind === "bomb" ? 48 : p.kind === "radio" ? 24 : 18;
    const blastDmg = p.kind === "bomb" ? 380 : p.kind === "radio" ? 120 : 90;
    if (direct) this.registry.damage(direct, p.dmg, at, w, true, now);
    const gy = groundHeight(at.x, at.z);
    const water = isWater(at.x, at.z) && at.y - gy < 5;
    this.fx.explosion(at, size, water ? { water: true } : { groundY: gy });
    if (solid && hit) {
      this.scars.scorch(at, hit.normal, size * 1.5);
      for (let i = 0; i < 4; i++) this.scars.wall(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * size * 0.4, (Math.random() - 0.5) * size * 0.3, (Math.random() - 0.5) * size * 0.4)), hit.normal, 0.8 + Math.random() * 1.6);
    }
    this.registry.explode(at, blastR, blastDmg, w, true, now);
    this.cb.onSound("boom", at.distanceTo(this.eye), size);
  }

  // ------------------------------------------------------------------ ameaças hostis
  private launchThreat(d: Damageable, type: "ir" | "radar") {
    const mesh = this.missileMesh(0x7a2e2e, 3.2, 0.1);
    const pos = d.center.clone().add(new THREE.Vector3(0, 4, 0));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.threats.push({
      type, mesh, pos, prev: pos.clone(), vel: new THREE.Vector3(0, 70, 0), age: 0, by: d.name, trailT: 0, lost: false, dec: null, decided: new Set(),
    });
    this.fx.puff(pos, [2, 2, 2], 0.7, 4, 18, 3);
    this.cb.onThreat(`⚠ ${d.name} lançou um míssil ${type === "ir" ? "IR (calor) — solte FLARES (Z)" : "guiado por RADAR — solte CHAFF (N)"}!`);
  }

  private removeThreat(i: number) {
    this.scene.remove(this.threats[i].mesh);
    this.threats.splice(i, 1);
  }

  private updateThreats(dt: number, now: number, player: PlayerState) {
    // sítios SAM engajam o jogador em voo
    for (const s of this.sams) {
      s.tracking = false;
      if (!s.d.alive || !player.alive) continue;
      const dist = s.d.center.distanceTo(player.pos);
      s.tracking = dist < 8000 && !player.onGround && player.agl > 25;
      s.cd -= dt;
      if (s.tracking && s.cd <= 0 && dist > 700) {
        s.cd = 13 + Math.random() * 8;
        this.launchThreat(s.d, Math.random() < 0.5 ? "ir" : "radar");
      }
    }
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const t = this.threats[i];
      t.age += dt;
      t.prev.copy(t.pos);
      const burn = t.age < 5;
      let speed = t.vel.length();
      speed = burn ? Math.min(680, speed + 250 * dt) : speed * (1 - 0.07 * dt);
      const fwd = t.vel.clone().normalize();
      let aim: THREE.Vector3 | null = null;
      if (!t.lost && t.age > 0.7) {
        let base = t.type === "ir" ? 0.72 : 0.62;
        if (player.g > 3.5) base += 0.14;
        if (t.type === "radar" && player.agl < 60) base += 0.1;
        aim = this.seduce(t, t.type === "ir" ? "flare" : "chaff", "me", player.pos, Math.min(0.95, base), t.type === "ir" ? 0.75 : 1.1);
        if (!aim && player.alive) {
          const to = player.pos.clone().sub(t.pos);
          if (fwd.angleTo(to) < (t.type === "ir" ? 0.95 : 1.25)) {
            const tgo = to.length() / Math.max(speed, 100);
            aim = player.pos.clone().addScaledVector(player.vel, tgo * 0.85);
          } else t.lost = true;
        }
      }
      if (t.age <= 0.7) {
        // lançamento vertical, depois curva para o alvo
        aim = player.pos;
      }
      if (aim) {
        const want = aim.clone().sub(t.pos).normalize();
        const turn = Math.min(fwd.angleTo(want), ((t.age < 0.7 ? 6 : 24) * 9.81 / Math.max(speed, 120)) * dt);
        const axis = new THREE.Vector3().crossVectors(fwd, want);
        if (axis.lengthSq() > 1e-8) fwd.applyAxisAngle(axis.normalize(), turn);
      }
      t.vel.copy(fwd.multiplyScalar(speed));
      t.pos.addScaledVector(t.vel, dt);
      t.mesh.position.copy(t.pos);
      t.mesh.quaternion.setFromUnitVectors(FWD, t.vel.clone().normalize());
      t.trailT -= dt;
      if (burn && t.trailT <= 0) {
        t.trailT = 0.03;
        this.fx.trail(t.pos);
      }
      // impacto no jogador (colisão varrida)
      if (player.alive && segSphere(t.prev, t.pos, player.pos, 8 + player.radius) !== null) {
        const dmg = 38 + Math.random() * 22;
        this.fx.explosion(t.pos.clone(), 12);
        this.cb.onSound("boom", 0, 14);
        this.cb.onPlayerHit(dmg, t.by);
        this.removeThreat(i);
        continue;
      }
      // fusível de proximidade em isca
      if (t.dec && t.pos.distanceTo(t.dec.pos) < 14) {
        this.fx.explosion(t.pos.clone(), 9);
        this.cb.onSound("boom", t.pos.distanceTo(this.eye), 9);
        if (player.alive && t.pos.distanceTo(player.pos) < 22) this.cb.onPlayerHit(8 + Math.random() * 8, `${t.by} (estilhaços)`);
        this.cb.onThreat("✔ Míssil enganado pela contramedida!");
        this.removeThreat(i);
        continue;
      }
      const gy = groundHeight(t.pos.x, t.pos.z);
      if (t.pos.y <= gy + 0.5 || t.age > 22) {
        const gnd = t.pos.y <= gy + 0.5;
        const at = t.pos.clone();
        if (gnd) at.y = gy + 1;
        this.fx.explosion(at, 10, gnd ? { groundY: gy } : {});
        this.cb.onSound("boom", at.distanceTo(this.eye), 10);
        this.removeThreat(i);
        continue;
      }
      void now;
    }
    // alerta no painel (RWR / MAW)
    let w: Warning | null = null;
    for (const t of this.threats) {
      const d = t.pos.distanceTo(player.pos);
      if (!w || d < w.dist) w = { kind: t.type, dist: d, by: t.by };
    }
    if (!w) {
      for (const s of this.sams) {
        if (!s.tracking) continue;
        const d = s.d.center.distanceTo(player.pos);
        if (!w || d < w.dist) w = { kind: "lock", dist: d, by: s.d.name };
      }
    }
    this.warning = player.alive ? w : null;
  }

  // ------------------------------------------------------------------ atualização
  update(dt: number, guide: { origin: THREE.Vector3; dir: THREE.Vector3 } | null, now: number, player: PlayerState) {
    for (const m of this.movers) {
      if (!m.d.alive) continue;
      m.ang += m.speed * dt;
      const x = m.cx + Math.cos(m.ang) * m.r, z = m.cz + Math.sin(m.ang) * m.r;
      const y = m.air ? groundHeight(m.cx, m.cz) + m.alt + Math.sin(now * 0.0005 + m.r) * 40 : m.obj.position.y;
      const dir = new THREE.Vector3(-Math.sin(m.ang), 0, Math.cos(m.ang));
      m.obj.position.set(x, y, z);
      if (m.air) {
        m.obj.quaternion.setFromUnitVectors(FWD, dir);
        m.obj.rotateZ(-0.35);
        m.d.center.set(x, y, z);
      } else {
        m.obj.rotation.y = Math.atan2(-dir.z, dir.x);
        m.d.rotY = m.obj.rotation.y;
        m.d.center.set(x, y + (m.d.half?.y ?? 4), z);
      }
    }
    for (const w of this.wrecks) {
      if (!w.alive) continue;
      w.vel.y -= 9.81 * dt;
      w.pos.addScaledVector(w.vel, dt);
      const gy = groundHeight(w.pos.x, w.pos.z);
      if (w.pos.y <= gy) {
        w.alive = false;
        this.fx.explosion(w.pos.clone().setY(gy + 2), 12, { groundY: gy });
      }
    }
    this.wrecks = this.wrecks.filter((w) => w.alive);

    this.updateDecoys(dt);
    this.updateThreats(dt, now, player);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.ttl -= dt;
      p.age += dt;
      p.prev.copy(p.pos);

      if (p.kind === "bomb") {
        p.vel.y -= 9.81 * dt;
        p.vel.multiplyScalar(1 - 0.015 * dt);
        p.mesh.quaternion.setFromUnitVectors(FWD, p.vel.clone().normalize());
      } else if (p.kind === "ir" || p.kind === "radio") {
        const burn = p.age < 3.2;
        let speed = p.vel.length();
        speed = burn ? Math.min(p.kind === "ir" ? 860 : 760, speed + 320 * dt) : speed * (1 - 0.04 * dt);
        const fwd = p.vel.clone().normalize();
        const acc = new THREE.Vector3();
        const maxA = (p.kind === "ir" ? 32 : 20) * 9.81;
        if (p.kind === "ir" && p.target && p.target.alive) {
          let tgt: THREE.Vector3 = p.target.center;
          if (p.target.kind === "remote" && p.target.owner) {
            const aim = this.seduce(p, "flare", p.target.owner, p.target.center, 0.7, 0.8);
            if (aim) tgt = aim;
          }
          const tv = p.lastRef === tgt ? tgt.clone().sub(p.tgtPrev).divideScalar(Math.max(dt, 1e-3)) : new THREE.Vector3();
          p.lastRef = tgt;
          p.tgtPrev.copy(tgt);
          const r = tgt.clone().sub(p.pos);
          const dist = r.length();
          if (fwd.dot(r.clone().divideScalar(dist)) < 0.45) {
            p.target = null;
          } else {
            const vrel = tv.sub(p.vel);
            const omega = r.clone().cross(vrel).divideScalar(Math.max(dist * dist, 1));
            const vc = -r.clone().divideScalar(dist).dot(vrel);
            acc.copy(omega.cross(r.clone().divideScalar(dist))).multiplyScalar(4 * Math.max(vc, 150));
            acc.addScaledVector(r.clone().divideScalar(dist).sub(fwd), 30);
          }
          if (p.target && p.dec && dist < 10) {
            // enganado por uma isca: detona longe do alvo
            this.fx.explosion(p.pos.clone(), 9);
            this.cb.onSound("boom", p.pos.distanceTo(this.eye), 9);
            this.cb.onEvent("Seu míssil foi enganado por flares!");
            this.remove(i);
            continue;
          }
          if (p.target && !p.dec && dist < p.target.radius + 9) {
            this.detonate(p, p.pos.clone(), { item: p.target, normal: p.pos.clone().sub(p.target.center).normalize() }, now);
            this.remove(i);
            continue;
          }
        } else if (p.kind === "radio" && guide) {
          const rel = p.pos.clone().sub(guide.origin);
          const along = Math.max(rel.dot(guide.dir), 0) + 450;
          const aim = guide.origin.clone().addScaledVector(guide.dir, along);
          acc.copy(aim.sub(p.pos).normalize().sub(fwd)).multiplyScalar(speed * 2.2);
        }
        if (acc.length() > maxA) acc.setLength(maxA);
        p.vel.addScaledVector(acc, dt).setLength(speed);
        p.mesh.quaternion.setFromUnitVectors(FWD, p.vel.clone().normalize());
        p.trailT -= dt;
        if (burn && p.trailT <= 0) {
          p.trailT = 0.022;
          this.fx.trail(p.pos);
        }
      }

      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      if (p.age > 0.04) {
        const hit = this.registry.segmentHit(p.prev, p.pos, p.kind === "bullet" ? 0.6 : 1.8);
        if (hit) {
          this.detonate(p, hit.point, hit, now);
          this.remove(i);
          continue;
        }
      }
      const floor = groundHeight(p.pos.x, p.pos.z);
      if (p.pos.y <= floor) {
        const k = (p.prev.y - floor) / Math.max(1e-6, p.prev.y - p.pos.y);
        const at = p.prev.clone().lerp(p.pos, THREE.MathUtils.clamp(k, 0, 1));
        at.y = floor + 0.5;
        this.detonate(p, at, null, now);
        this.remove(i);
        continue;
      }
      if (p.ttl <= 0) {
        if (p.kind !== "bullet") this.detonate(p, p.pos.clone(), null, now);
        this.remove(i);
      }
    }
  }

  private remove(i: number) {
    this.scene.remove(this.projectiles[i].mesh);
    this.projectiles.splice(i, 1);
  }
}