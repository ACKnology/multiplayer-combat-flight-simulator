import * as THREE from "three";
import { byId, type AircraftSpec } from "./aircraft";
import { buildAircraft, makeLabel, type AircraftModel } from "./models";
import { groundHeight } from "./terrain";
import type { Layout } from "./world";
import type { DamageRegistry, Damageable } from "./damage";
import type { FX } from "./fx";

type Phase = "hold" | "lineup" | "takeoff" | "climb" | "crosswind" | "downwind" | "base" | "final" | "flare" | "rollout" | "exit" | "taxiback";

interface WP {
  pos: THREE.Vector3;
  speed: number;
  phase: Phase;
  radius: number;
  radio?: [string, string][];
}

export interface TrafficPlane {
  id: string;
  callsign: string;
  spec: AircraftSpec;
  model: AircraftModel;
  label: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  bank: number;
  prevHdg: number;
  wps: WP[];
  wpIndex: number;
  holdTimer: number;
  goAround: boolean;
  state: "ok" | "falling" | "dead";
  respawnAt: number;
  spin: number;
  dmg: Damageable;
}

export interface PlayerCtx { pos: THREE.Vector3; onGround: boolean; onRunway: boolean }

const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const GROUND: Phase[] = ["hold", "lineup", "takeoff", "rollout", "exit", "taxiback"];
const RUNWAY_USE: Phase[] = ["lineup", "takeoff", "flare", "rollout"];

export class TrafficSystem {
  planes: TrafficPlane[] = [];
  private scene: THREE.Scene;
  private L: Layout;
  private registry: DamageRegistry;
  private fx: FX;
  private onRadio: (callsign: string, text: string, kind: "pilot" | "atc") => void;
  private queue: { at: number; callsign: string; text: string; kind: "pilot" | "atc" }[] = [];
  private tpl: Record<string, string>;
  private labels = true;

  constructor(
    scene: THREE.Scene, L: Layout, registry: DamageRegistry, fx: FX,
    ctx: { atcName: string; gnd: string; wind: string },
    configs: [string, string][],
    onRadio: (callsign: string, text: string, kind: "pilot" | "atc") => void
  ) {
    this.scene = scene;
    this.L = L;
    this.registry = registry;
    this.fx = fx;
    this.onRadio = onRadio;
    this.tpl = { "{TWR}": `Torre ${ctx.atcName}`, "{RWY}": L.activeIdent, "{GND}": ctx.gnd, "{WIND}": ctx.wind };
    const starts = [0, 6, 4];
    configs.forEach(([id, callsign], idx) => {
      const spec = byId(id);
      const model = buildAircraft(spec);
      const label = makeLabel(callsign, "#86efac", spec.short);
      model.group.add(label);
      scene.add(model.group);
      const wps = this.circuit(spec);
      const start = starts[idx % starts.length];
      const wp = wps[start];
      const pos = wp.pos.clone();
      if (GROUND.includes(wp.phase)) pos.y = groundHeight(pos.x, pos.z) + spec.gearHeight;
      const next = wps[(start + 1) % wps.length].pos;
      const vel = GROUND.includes(wp.phase) ? new THREE.Vector3() : next.clone().sub(pos).setLength(wp.speed);
      const plane: TrafficPlane = {
        id: `ai-${idx}`, callsign, spec, model, label, pos, vel, quat: new THREE.Quaternion(), bank: 0, prevHdg: 0,
        wps, wpIndex: start, holdTimer: 10 + idx * 15, goAround: false, state: "ok", respawnAt: 0, spin: 0,
        dmg: null as unknown as Damageable,
      };
      plane.dmg = registry.add({
        id: plane.id, name: callsign, kind: "aircraft", team: "friendly", center: pos.clone(), radius: spec.span * 0.42,
        hp: spec.hp * 0.8, points: -500, heat: spec.afterburner ? 0.95 : 0.8, respawnMs: 0,
        onDestroyed: () => this.shotDown(plane),
      });
      if (vel.lengthSq() > 1) this.orient(plane, 1, true);
      this.planes.push(plane);
    });
  }

  setLabels(on: boolean) {
    this.labels = on;
    for (const p of this.planes) p.label.visible = on && p.state === "ok";
  }

  private circuit(spec: AircraftSpec): WP[] {
    const L = this.L;
    const left = L.right.clone().negate();
    const W = (a: number, c: number, h: number) => L.thr.clone().addScaledVector(L.dir, a).addScaledVector(left, c).setY(h);
    const len = L.active.len;
    const ts = L.out.dot(left) > 0 ? 1 : -1;
    const taxi = ts * (L.active.wid / 2 + 110);
    const vR = spec.stallSpeed * 1.35, vC = Math.min(spec.maxSpeed * 0.5, spec.stallSpeed * 2.4), vF = spec.stallSpeed * 1.3;
    const big = spec.id === "b737", small = spec.id === "c172";
    const pw = small ? 1300 : big ? 2900 : 2000, ph = small ? 300 : big ? 600 : 450;
    const ext = big ? 3200 : 2200, fin = small ? 2000 : big ? 4500 : 3200;
    const roll = Math.min(len * 0.72, 1700);
    return [
      { pos: W(90, taxi, 0), speed: 0, phase: "hold", radius: 16, radio: [["{CS}", "{TWR}, {CS} no ponto de espera da pista {RWY}, pronto para decolagem."], ["TWR", "{CS}, vento {WIND}, pista {RWY}, autorizado alinhar e decolar."]] },
      { pos: W(130, 0, 0), speed: 8, phase: "lineup", radius: 12 },
      { pos: W(len * 0.62, 0, 0), speed: vR, phase: "takeoff", radius: 70 },
      { pos: W(len + ext * 0.6, 0, ph * 0.6), speed: vC, phase: "climb", radius: 200, radio: [["TWR", "{CS}, após a decolagem curva à esquerda, mantenha o circuito de tráfego."]] },
      { pos: W(len + ext, pw * 0.5, ph), speed: vC, phase: "crosswind", radius: 230 },
      { pos: W(len + ext * 0.5, pw, ph), speed: vC, phase: "downwind", radius: 250 },
      { pos: W(-fin * 0.5, pw, ph), speed: vC * 0.9, phase: "downwind", radius: 250, radio: [["{CS}", "{TWR}, {CS} na perna do vento, trem baixado e travado, pouso completo."]] },
      { pos: W(-fin, pw * 0.55, ph * 0.75), speed: vF * 1.2, phase: "base", radius: 230, radio: [["TWR", "{CS}, pista {RWY}, vento {WIND}, autorizado pouso."]] },
      { pos: W(-fin, 0, Math.tan((3 * Math.PI) / 180) * fin + 15), speed: vF, phase: "final", radius: 170 },
      { pos: W(260, 0, 6), speed: vF * 0.95, phase: "flare", radius: 80 },
      { pos: W(roll, 0, 0), speed: 12, phase: "rollout", radius: 55, radio: [["TWR", "{CS}, livre a próxima à direita, chame o Solo {GND}. Bem-vindo."]] },
      { pos: W(roll + 60, taxi, 0), speed: 9, phase: "exit", radius: 26 },
      { pos: W(90, taxi, 0), speed: 10, phase: "taxiback", radius: 18 },
    ];
  }

  private queueRadio(p: TrafficPlane, lines: [string, string][], now: number) {
    lines.forEach(([who, text], i) => {
      let t = text.replace(/\{CS\}/g, p.callsign);
      for (const [k, v] of Object.entries(this.tpl)) t = t.split(k).join(v);
      const isAtc = who === "TWR";
      this.queue.push({ at: now + 500 + i * 3400, callsign: isAtc ? this.tpl["{TWR}"].toUpperCase() : p.callsign, text: t, kind: isAtc ? "atc" : "pilot" });
    });
  }

  private shotDown(p: TrafficPlane) {
    p.state = "falling";
    p.spin = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random());
    p.label.visible = false;
    this.fx.explosion(p.pos.clone(), p.spec.span * 0.45);
    this.fx.burn(p.pos, Math.max(2.5, p.spec.span * 0.12), 25000, () => (p.state === "falling" ? p.pos : null));
    this.queueRadio(p, [["TWR", `Atenção todas as estações: ${p.callsign} atingido! Emergência no setor, equipes de resgate acionadas.`]], performance.now());
  }

  private runwayBusy(except: TrafficPlane, player: PlayerCtx): boolean {
    if (player.onRunway) return true;
    const rel = player.pos.clone().sub(this.L.thr);
    const along = rel.dot(this.L.dir);
    const lateral = Math.abs(rel.dot(this.L.right));
    const playerFinal = !player.onGround && along < 0 && along > -5000 && lateral < 400 && player.pos.y < 450;
    if (playerFinal) return true;
    return this.planes.some((o) => {
      if (o === except || o.state !== "ok") return false;
      const ph = o.wps[o.wpIndex].phase;
      if (RUNWAY_USE.includes(ph)) return true;
      return ph === "final" && o.pos.distanceTo(this.L.thr) < 4500;
    });
  }

  private orient(p: TrafficPlane, dt: number, snap = false) {
    const speed = p.vel.length();
    if (speed < 0.5) return;
    const fwd = p.vel.clone().divideScalar(speed);
    // nariz em -Z: lookAt(eye=0, target=fwd) faz -Z apontar para fwd (corrige o voo "de ré")
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, UP));
    const hdg = Math.atan2(fwd.x, -fwd.z);
    let dh = hdg - p.prevHdg;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    p.prevHdg = hdg;
    const onGround = GROUND.includes(p.wps[p.wpIndex].phase) && p.state === "ok";
    const target = onGround ? 0 : THREE.MathUtils.clamp(Math.atan((speed * (dh / Math.max(dt, 1e-3))) / 9.81), -0.62, 0.62);
    p.bank = snap ? target : THREE.MathUtils.lerp(p.bank, target, 1 - Math.exp(-2.5 * dt));
    if (p.state === "falling") p.bank += p.spin * dt * 2;
    q.multiply(new THREE.Quaternion().setFromAxisAngle(ZAXIS, -p.bank));
    if (snap) p.quat.copy(q);
    else p.quat.slerp(q, 1 - Math.exp(-4 * dt));
  }

  private advance(p: TrafficPlane, now: number) {
    p.wpIndex = (p.wpIndex + 1) % p.wps.length;
    const wp = p.wps[p.wpIndex];
    if (wp.phase === "hold") p.holdTimer = 20 + Math.random() * 25;
    if (wp.phase === "climb") p.goAround = false;
    if (wp.radio) this.queueRadio(p, wp.radio, now);
  }

  update(dt: number, now: number, player: PlayerCtx) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (now >= this.queue[i].at) {
        const r = this.queue.splice(i, 1)[0];
        this.onRadio(r.callsign, r.text, r.kind);
      }
    }

    for (const p of this.planes) {
      if (p.state === "dead") {
        if (now >= p.respawnAt) {
          p.state = "ok";
          p.wpIndex = 0;
          p.holdTimer = 15;
          const wp = p.wps[0];
          p.pos.copy(wp.pos).setY(groundHeight(wp.pos.x, wp.pos.z) + p.spec.gearHeight);
          p.vel.set(0, 0, 0);
          p.model.group.visible = true;
          p.label.visible = this.labels;
          p.dmg.alive = true;
          p.dmg.hp = p.dmg.maxHp;
          p.bank = 0;
        }
        continue;
      }
      if (p.state === "falling") {
        p.vel.y -= 9.81 * dt;
        p.vel.multiplyScalar(1 - 0.08 * dt);
        p.pos.addScaledVector(p.vel, dt);
        this.orient(p, dt);
        p.model.group.position.copy(p.pos);
        p.model.group.quaternion.copy(p.quat);
        const gy = groundHeight(p.pos.x, p.pos.z);
        if (p.pos.y <= gy + 1) {
          p.state = "dead";
          p.respawnAt = now + 75000;
          p.model.group.visible = false;
          const at = p.pos.clone().setY(gy + 2);
          this.fx.explosion(at, p.spec.span * 0.9, { groundY: gy });
          this.fx.burn(at, p.spec.span * 0.2, 45000);
          this.registry.explode(at, 35, 160, "blast", false, now);
        }
        continue;
      }

      const wp = p.wps[p.wpIndex];
      const onGroundPhase = GROUND.includes(wp.phase);
      const target = wp.pos.clone();
      if (onGroundPhase) target.y = groundHeight(target.x, target.z) + p.spec.gearHeight;
      else if (!["final", "flare", "climb"].includes(wp.phase)) target.y = Math.max(target.y, groundHeight(target.x, target.z) + 150);

      // torre gerencia a separação
      if (wp.phase === "final" && !p.goAround && p.pos.distanceTo(this.L.thr) < 2400 && this.runwayBusy(p, player)) {
        p.goAround = true;
        this.queueRadio(p, [["TWR", "{CS}, ARREMETA! Pista ocupada. Suba e mantenha o circuito."], ["{CS}", "Arremetendo, {CS}."]], now);
        p.wpIndex = p.wps.findIndex((w) => w.phase === "climb");
        continue;
      }

      if (wp.phase === "hold") {
        p.holdTimer -= dt;
        p.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
        if (p.holdTimer <= 0) {
          if (this.runwayBusy(p, player)) p.holdTimer = 4;
          else this.advance(p, now);
        }
      } else {
        const to = target.clone().sub(p.pos);
        const dist = to.length();
        if (dist < wp.radius) {
          this.advance(p, now);
        } else {
          const desired = to.divideScalar(dist).multiplyScalar(wp.speed);
          const accel = wp.phase === "takeoff" ? 7 : wp.phase === "rollout" ? 5 : onGroundPhase ? 3 : 12;
          const dv = desired.sub(p.vel);
          const dvl = dv.length();
          if (dvl > accel * dt) dv.multiplyScalar((accel * dt) / dvl);
          p.vel.add(dv);
        }
      }
      p.pos.addScaledVector(p.vel, dt);
      const gy = groundHeight(p.pos.x, p.pos.z) + p.spec.gearHeight;
      if (p.pos.y < gy) {
        p.pos.y = gy;
        if (p.vel.y < 0) p.vel.y = 0;
      }
      if (onGroundPhase && wp.phase !== "takeoff") p.pos.y = gy;
      this.orient(p, dt);
      p.model.group.position.copy(p.pos);
      p.model.group.quaternion.copy(p.quat);
      p.model.gear.visible = p.spec.fixedGear || p.pos.y - gy < 200 || onGroundPhase;
      const speed = p.vel.length();
      if (p.model.prop) p.model.prop.rotation.z += dt * (15 + speed * 0.6);
      if (p.model.propDisc) (p.model.propDisc.material as THREE.MeshBasicMaterial).opacity = speed > 5 ? 0.14 : 0;
      for (const s of p.model.strobes) s.visible = !onGroundPhase && now % 1200 < 70;
      for (const b of p.model.beacons) b.visible = now % 1000 < 120;
      p.dmg.center.copy(p.pos);
      p.dmg.onHit = () => {
        if (p.dmg.hp < p.dmg.maxHp * 0.5) this.fx.puff(p.pos, [0.15, 0.14, 0.13], 0.7, 3, 10, 2.5);
      };
    }
  }

  dispose() {
    for (const p of this.planes) this.scene.remove(p.model.group);
  }
}