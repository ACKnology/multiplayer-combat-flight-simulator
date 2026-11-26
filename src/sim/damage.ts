import * as THREE from "three";

export type DmgKind = "building" | "vehicle" | "ship" | "aircraft" | "drone" | "remote" | "structure";
export type Team = "hostile" | "friendly" | "neutral";
export type WeaponType = "bullet" | "bomb" | "ir" | "radio" | "collision" | "blast";

export interface Damageable {
  id: string;
  name: string;
  kind: DmgKind;
  team: Team;
  center: THREE.Vector3;
  half: THREE.Vector3 | null; // caixa orientada (rotação em Y); null = esfera
  rotY: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  heat: number; // assinatura infravermelha 0..1
  points: number;
  respawnMs: number;
  deadUntil: number;
  owner?: string; // id do jogador remoto
  lastHit: number;
  onHit?: (dmg: number, at: THREE.Vector3, w: WeaponType) => void;
  onDestroyed?: (w: WeaponType, at: THREE.Vector3) => void;
  onRespawn?: () => void;
}

export type DamageableInit = Partial<Damageable> & Pick<Damageable, "id" | "name" | "kind" | "center" | "radius" | "hp">;

export interface HitResult { item: Damageable; point: THREE.Vector3; t: number; normal: THREE.Vector3 }

function hitNormal(d: Damageable, p: THREE.Vector3): THREE.Vector3 {
  if (d.half) {
    const l = toLocal(p, d, new THREE.Vector3());
    const rx = Math.abs(l.x) / d.half.x, ry = Math.abs(l.y) / d.half.y, rz = Math.abs(l.z) / d.half.z;
    let nx = 0, ny = 0, nz = 0;
    if (rx >= ry && rx >= rz) nx = Math.sign(l.x) || 1;
    else if (ry >= rz) ny = Math.sign(l.y) || 1;
    else nz = Math.sign(l.z) || 1;
    const c = Math.cos(d.rotY), s = Math.sin(d.rotY);
    return new THREE.Vector3(nx * c + nz * s, ny, -nx * s + nz * c);
  }
  const n = p.clone().sub(d.center);
  return n.lengthSq() > 1e-6 ? n.normalize() : new THREE.Vector3(0, 1, 0);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function toLocal(p: THREE.Vector3, d: Damageable, out: THREE.Vector3) {
  const x = p.x - d.center.x, y = p.y - d.center.y, z = p.z - d.center.z;
  const c = Math.cos(d.rotY), s = Math.sin(d.rotY);
  return out.set(x * c - z * s, y, x * s + z * c);
}

function segAABB(a: THREE.Vector3, b: THREE.Vector3, h: THREE.Vector3, pad: number): number | null {
  let tmin = 0, tmax = 1;
  const o = [a.x, a.y, a.z], d = [b.x - a.x, b.y - a.y, b.z - a.z], hh = [h.x + pad, h.y + pad, h.z + pad];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -hh[i] || o[i] > hh[i]) return null;
    } else {
      let t1 = (-hh[i] - o[i]) / d[i], t2 = (hh[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function segSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A < 1e-9) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

export class DamageRegistry {
  items: Damageable[] = [];
  explosionListeners: ((c: THREE.Vector3, r: number, dmg: number, w: WeaponType) => void)[] = [];
  destroyListeners: ((d: Damageable, w: WeaponType, byPlayer: boolean) => void)[] = [];
  remoteHit: ((owner: string, dmg: number, w: WeaponType) => void) | null = null;

  add(init: DamageableInit): Damageable {
    const d: Damageable = {
      team: "neutral", half: null, rotY: 0, maxHp: init.hp, alive: true, heat: 0.1, points: 50,
      respawnMs: 90000, deadUntil: 0, lastHit: 0, ...init,
    };
    this.items.push(d);
    return d;
  }

  remove(d: Damageable) {
    const i = this.items.indexOf(d);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** distância do ponto à superfície do item */
  distanceTo(d: Damageable, p: THREE.Vector3): number {
    if (d.half) {
      toLocal(p, d, _a);
      const qx = Math.max(Math.abs(_a.x) - d.half.x, 0), qy = Math.max(Math.abs(_a.y) - d.half.y, 0), qz = Math.max(Math.abs(_a.z) - d.half.z, 0);
      return Math.hypot(qx, qy, qz);
    }
    return Math.max(0, d.center.distanceTo(p) - d.radius);
  }

  /** primeiro item atingido ao longo do segmento a→b (colisão varrida) */
  segmentHit(a: THREE.Vector3, b: THREE.Vector3, pad: number, ignore?: Damageable | null): HitResult | null {
    let best: HitResult | null = null;
    const len = a.distanceTo(b);
    for (const d of this.items) {
      if (!d.alive || d === ignore) continue;
      // rejeição rápida por esfera envolvente
      const reach = d.radius + pad + len;
      if (d.center.distanceToSquared(a) > reach * reach) continue;
      let t: number | null;
      if (d.half) {
        toLocal(a, d, _a);
        toLocal(b, d, _b);
        t = segAABB(_a, _b, d.half, pad);
      } else {
        t = segSphere(a, b, d.center, d.radius + pad);
      }
      if (t !== null && (!best || t < best.t)) {
        const point = a.clone().lerp(b, t);
        best = { item: d, t, point, normal: hitNormal(d, point) };
      }
    }
    return best;
  }

  /** ponto dentro de algum item sólido (colisão da aeronave com prédios/veículos) */
  pointInside(p: THREE.Vector3, pad: number, kinds: DmgKind[]): Damageable | null {
    for (const d of this.items) {
      if (!d.alive || !kinds.includes(d.kind)) continue;
      if (this.distanceTo(d, p) <= pad) return d;
    }
    return null;
  }

  damage(d: Damageable, dmg: number, at: THREE.Vector3, w: WeaponType, byPlayer: boolean, now: number): boolean {
    if (!d.alive || dmg <= 0) return false;
    d.lastHit = now;
    if (d.kind === "remote") {
      if (d.owner && this.remoteHit) this.remoteHit(d.owner, dmg, w);
      d.onHit?.(dmg, at, w);
      return false;
    }
    d.hp -= dmg;
    d.onHit?.(dmg, at, w);
    if (d.hp <= 0) {
      d.alive = false;
      d.hp = 0;
      d.deadUntil = d.respawnMs > 0 ? now + d.respawnMs : Infinity;
      d.onDestroyed?.(w, at);
      for (const l of this.destroyListeners) l(d, w, byPlayer);
      return true;
    }
    return false;
  }

  explode(c: THREE.Vector3, r: number, dmg: number, w: WeaponType, byPlayer: boolean, now: number) {
    for (const d of [...this.items]) {
      if (!d.alive) continue;
      const dist = this.distanceTo(d, c);
      if (dist > r) continue;
      const k = Math.max(0.15, Math.pow(1 - dist / r, 0.7));
      this.damage(d, dmg * k, c, w, byPlayer, now);
    }
    for (const l of this.explosionListeners) l(c, r, dmg, w);
  }

  update(now: number) {
    for (const d of this.items) {
      if (!d.alive && d.kind !== "remote" && now >= d.deadUntil) {
        d.alive = true;
        d.hp = d.maxHp;
        d.onRespawn?.();
      }
    }
  }
}