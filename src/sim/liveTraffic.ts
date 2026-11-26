import * as THREE from "three";
import { byId, type AircraftSpec } from "./aircraft";
import { buildAircraft, makeLabel, type AircraftModel } from "./models";
import type { GeoFrame } from "./geo";
import { groundHeight } from "./terrain";
import { resolveAdsbIdentity, type ResolvedIdentity } from "@/lib/aircraft/identity";
import type { DamageRegistry, Damageable } from "./damage";
import type { FX } from "./fx";
import type { AdsbAircraft } from "@/app/api/adsb/route";

export interface LiveFlightInfo {
  hex: string; cs: string; type: string; reg: string; desc: string; squawk: string;
  altFt: number; gsKt: number; vsFpm: number; distKm: number;
  onGround: boolean; emergency: boolean;
  lat: number; lon: number; trackDeg: number;
  /** identidade resolvida pelo Aircraft Registry (geometria/livery/confiança) */
  identity?: ResolvedIdentity | null;
}

export interface LiveFollowState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  span: number;
  isJet: boolean;
  info: LiveFlightInfo;
}

export type LiveStatusKind = "loading" | "live" | "offline";

export interface LiveInfo {
  on: boolean;
  status: LiveStatusKind;
  source: string;
  ageSec: number;
  count: number; // renderizados
  total: number; // recebidos no raio
  flights: LiveFlightInfo[];
}

interface LiveModel {
  group: THREE.Group;
  gear: THREE.Object3D;
  prop: THREE.Object3D | null;
  strobes: THREE.Object3D[];
  beacons: THREE.Object3D[];
  rotor?: THREE.Object3D;
  tailRotor?: THREE.Object3D;
  span: number;
  gearH: number;
}

interface Entry {
  hex: string;
  model: LiveModel;
  identity?: ResolvedIdentity;
  poolKey: string;
  label: THREE.Sprite;
  dmg: Damageable;
  data: AdsbAircraft;
  pos: THREE.Vector3; // posição renderizada
  target: THREE.Vector3; // última posição reportada (avança por dead-reckoning)
  vel: THREE.Vector3;
  vsMs: number;
  trackRad: number;
  bank: number;
  pitch: number;
  lastFix: number;
  prevTrack: number;
  prevFixT: number;
  trailT: number;
}

const MAX_MODELS = 36;
const RENDER_DIST = 48000;
const LABEL_DIST = 30000;
const POLL_MS = 6000;
const FT = 3.28084;
const clamp = THREE.MathUtils.clamp;

const HELI_TYPES = /^(H60|UH60|SH60|MH60|H500|H269|R22|R44|R66|B06|B407|B429|B412|B430|AS50|AS55|AS65|AS32|EC20|EC25|EC30|EC35|EC45|EC55|A109|A119|A139|A169|A189|S76|S92|S61|S64|MD52|MD60|EXPL|GAZL|PUMA|LYNX|MERL|NH90|CH47|H47|MI8|MI17|MI24|KA52)/;
const FIGHTER_TYPES = /^(F15|F16|F18|F22|F35|FA18|EUFI|TYPH|TOR|GRIP|JAS39|MIR2|M200|RFAL|J10|J11|J20|KFIR|F5|F4|HAR|AV8)/;
const RUSSIAN_TYPES = /^(SU27|SU30|SU33|SU34|SU35|SU57|MIG2|MIG3|TU95|TU160|TU22)/;

/** escolhe o modelo 3D mais próximo do tipo real reportado pelo transponder */
/**
 * Resolve o registro ADS-B em uma entrada do Aircraft Registry central.
 * O tipo ICAO é a referência principal para a geometria; o callsign apenas
 * ajuda a identificar o operador/livery (nunca a geometria).
 */
function specFor(a: AdsbAircraft): { key: string; spec: AircraftSpec; scale: number; identity: ResolvedIdentity } {
  const identity = resolveAdsbIdentity({
    hex: a.hex,
    type: a.type,
    registration: a.reg,
    callsign: a.flight,
    category: a.category,
    groundSpeedKts: a.gsKt,
  });
  return { key: `${identity.proceduralSpec}:${identity.scale}`, spec: byId(identity.proceduralSpec), scale: identity.scale, identity };
}

function buildHeli(): LiveModel {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xb8412e, roughness: 0.35, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.5, metalness: 0.5 });
  const fus = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), body);
  fus.scale.set(1.25, 1.35, 2.9);
  fus.position.y = 1.6;
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshPhysicalMaterial({ color: 0x27455e, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.85 })
  );
  glass.scale.set(1.05, 1.0, 1.4);
  glass.position.set(0, 1.75, -1.9);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 5.4, 10).rotateX(Math.PI / 2), body);
  boom.position.set(0, 1.9, 4.4);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.7), body);
  fin.position.set(0, 2.6, 6.9);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.55), body);
  stab.position.set(0, 1.95, 5.9);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 8), dark);
  mast.position.set(0, 3.1, 0);
  const rotor = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.05, 0.34), dark);
    blade.rotation.y = (i * Math.PI) / 2;
    rotor.add(blade);
  }
  rotor.position.set(0, 3.45, 0);
  const tailRotor = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.16), dark);
    b.rotation.x = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  tailRotor.position.set(0.28, 2.7, 6.9);
  const skids = new THREE.Group();
  for (const s of [-0.95, 0.95]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 8).rotateX(Math.PI / 2), dark);
    skid.position.set(s, 0.12, -0.3);
    const strutA = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), dark);
    strutA.position.set(s * 0.8, 0.7, -1.1);
    strutA.rotation.z = s * 0.35;
    const strutB = strutA.clone();
    strutB.position.z = 0.7;
    skids.add(skid, strutA, strutB);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.4, 0.3) }));
  beacon.position.set(0, 3.0, 6.9);
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.5, 0.5) }));
  navL.position.set(-1.3, 1.5, -0.5);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 6, 1) }));
  navR.position.set(1.3, 1.5, -0.5);
  g.add(fus, glass, boom, fin, stab, mast, rotor, tailRotor, skids, beacon, navL, navR);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, gear: skids, prop: null, strobes: [], beacons: [beacon], rotor, tailRotor, span: 11.5, gearH: 0.15 };
}

const emergencyOf = (a: AdsbAircraft) => a.squawk === "7500" || a.squawk === "7600" || a.squawk === "7700";

/**
 * Tráfego aéreo REAL via ADS-B (adsb.fi / OpenSky), no estilo FlightRadar24:
 * posições, altitudes, velocidades e rumos verdadeiros, atualizados a cada 6 s
 * com dead-reckoning entre transmissões. Tecla U liga/desliga.
 */
export class LiveTraffic {
  enabled = true;
  private entries = new Map<string, Entry>();
  private pool = new Map<string, LiveModel[]>();
  private downed = new Set<string>();
  private timer = 0;
  private status: LiveStatusKind = "loading";
  private source = "";
  private lastOk = 0;
  private total = 0;
  private fetching = false;
  private announced = false;
  private playerPos = new THREE.Vector3();
  private followHex: string | null = null;
  private disposed = false;

  constructor(
    private scene: THREE.Scene,
    private frame: GeoFrame,
    private registry: DamageRegistry,
    private fx: FX,
    private elevM: number,
    private lat: number,
    private lon: number,
    private onEvent: (text: string) => void
  ) {
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    for (const e of this.entries.values()) {
      e.model.group.visible = this.enabled;
      e.label.visible = false;
    }
    if (this.enabled) void this.poll();
    return this.enabled;
  }

  private async poll() {
    if (this.fetching || this.disposed || !this.enabled) return;
    this.fetching = true;
    try {
      const r = await fetch(`/api/adsb?lat=${this.lat.toFixed(4)}&lon=${this.lon.toFixed(4)}&dist=30`);
      const j = await r.json();
      if (this.disposed) return;
      if (j.source === "offline") {
        if (this.status !== "offline") this.onEvent("📡 ADS-B indisponível no momento — o tráfego IA do aeroporto continua ativo. Nova tentativa em instantes.");
        this.status = "offline";
      } else {
        this.status = "live";
        this.source = j.source ?? "";
        this.lastOk = performance.now();
        this.total = j.total ?? (j.aircraft?.length || 0);
        this.ingest(j.aircraft ?? []);
        if (!this.announced) {
          this.announced = true;
          this.onEvent(`📡 ADS-B conectado (${this.source}): ${this.total} aeronaves reais num raio de 55 km. Posições ao vivo como no FlightRadar24 — U liga/desliga.`);
        }
      }
    } catch {
      if (this.status === "live" && performance.now() - this.lastOk > 20000) this.status = "offline";
    } finally {
      this.fetching = false;
    }
  }

  private acquire(key: string, spec: AircraftSpec, scale: number, reg = ""): LiveModel {
    const pooled = this.pool.get(key)?.pop();
    if (pooled) return pooled;
    if (key === "heli") return buildHeli();
    const m: AircraftModel = buildAircraft(spec, reg);
    if (scale !== 1) m.group.scale.multiplyScalar(scale);
    for (const b of m.stores.bomb) b.visible = false;
    for (const s of m.stores.missileIR) s.visible = false;
    for (const s of m.stores.missileRAD) s.visible = false;
    return {
      group: m.group, gear: m.gear, prop: m.prop, strobes: m.strobes, beacons: m.beacons,
      span: spec.span * scale, gearH: spec.gearHeight * scale,
    };
  }

  private release(e: Entry) {
    this.scene.remove(e.model.group);
    this.scene.remove(e.label);
    this.registry.remove(e.dmg);
    const arr = this.pool.get(e.poolKey) ?? [];
    if (arr.length < 10) arr.push(e.model);
    this.pool.set(e.poolKey, arr);
    this.entries.delete(e.hex);
  }

  private ingest(list: AdsbAircraft[]) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const a of list) {
      if (!a.hex || this.downed.has(a.hex)) continue;
      seen.add(a.hex);
      const w = this.frame.toWorld(a.lat, a.lon);
      const altY = a.onGround ? groundHeight(w.x, w.z) : a.altFt / FT - this.elevM;
      const trackRad = (a.trackDeg * Math.PI) / 180;
      const gsMs = a.gsKt / 1.94384;
      const vel = new THREE.Vector3(Math.sin(trackRad) * gsMs, 0, -Math.cos(trackRad) * gsMs);
      let e = this.entries.get(a.hex);
      if (!e) {
        if (this.entries.size >= MAX_MODELS) {
          // substitui o mais distante, se o novo estiver mais perto
          let far: Entry | null = null;
          let fd = 0;
          for (const x of this.entries.values()) {
            if (x.hex === this.followHex) continue;
            const d = x.pos.distanceToSquared(this.playerPos);
            if (d > fd) { fd = d; far = x; }
          }
          const nd = (w.x - this.playerPos.x) ** 2 + (w.z - this.playerPos.z) ** 2;
          if (!far || nd >= fd) continue;
          this.release(far);
        }
        const { key, spec, scale, identity } = specFor(a);
        const model = this.acquire(key, spec, scale, a.flight || a.reg || "");
        const cs = a.flight || a.reg || a.hex.toUpperCase();
        const label = makeLabel(cs, emergencyOf(a) ? "#f87171" : "#fcd34d", `${a.type || a.category || "ADS-B"}${a.reg ? " · " + a.reg : ""}`);
        label.position.y = model.span * 0.28 + 5;
        model.group.add(label);
        this.scene.add(model.group);
        const pos = new THREE.Vector3(w.x, altY + (a.onGround ? model.gearH : 0), w.z);
        model.group.position.copy(pos);
        const dmg = this.registry.add({
          id: `adsb-${a.hex}`, name: `${cs} (TRÁFEGO REAL)`, kind: "aircraft", team: "neutral",
          center: pos.clone(), radius: Math.max(6, model.span * 0.42), hp: 160, points: -500, heat: 0.8, respawnMs: 0,
        });
        e = {
          hex: a.hex, model, identity, poolKey: key, label, dmg, data: a, pos, target: pos.clone(), vel,
          vsMs: a.vsFpm / 196.85, trackRad, bank: 0, pitch: 0, lastFix: now, prevTrack: trackRad, prevFixT: now, trailT: 0,
        };
        dmg.onDestroyed = (_w, at) => {
          this.downed.add(a.hex);
          this.fx.explosion(at, Math.max(16, model.span * 0.9));
          this.fx.burn(at.clone(), 4, 20000);
          const ent = this.entries.get(a.hex);
          if (ent) this.release(ent);
        };
        this.entries.set(a.hex, e);
      } else {
        // correção suave: alvo salta para a posição real; renderização persegue
        e.target.set(w.x, altY + (a.onGround ? e.model.gearH : 0), w.z);
        if (e.pos.distanceToSquared(e.target) > 2500 * 2500) e.pos.copy(e.target);
        // inclinação em curva a partir da razão de guinada reportada
        let dT = trackRad - e.prevTrack;
        while (dT > Math.PI) dT -= 2 * Math.PI;
        while (dT < -Math.PI) dT += 2 * Math.PI;
        const dtFix = Math.max(1, (now - e.prevFixT) / 1000);
        const yawRate = dT / dtFix;
        e.bank = a.onGround ? 0 : clamp(Math.atan((gsMs * yawRate) / 9.81), -0.5, 0.5);
        e.prevTrack = trackRad;
        e.prevFixT = now;
        e.vel.copy(vel);
        e.vsMs = a.onGround ? 0 : a.vsFpm / 196.85;
        e.trackRad = trackRad;
        e.data = a;
        e.lastFix = now;
        e.dmg.name = `${a.flight || a.reg || a.hex.toUpperCase()} (TRÁFEGO REAL)`;
      }
    }
    // remove quem sumiu do feed (pousou fora do raio, transponder desligado…)
    for (const e of [...this.entries.values()]) {
      if (!seen.has(e.hex) && now - e.lastFix > 25000) this.release(e);
    }
  }

  update(dt: number, now: number, playerPos: THREE.Vector3, labelsOn: boolean, followHex: string | null = null) {
    this.playerPos.copy(playerPos);
    this.followHex = followHex;
    if (!this.enabled) return;
    for (const e of [...this.entries.values()]) {
      const ground = e.data.onGround;
      // dead-reckoning entre transmissões
      e.target.addScaledVector(e.vel, dt);
      if (!ground) e.target.y += e.vsMs * dt;
      e.pos.addScaledVector(e.vel, dt);
      if (!ground) e.pos.y += e.vsMs * dt;
      e.pos.lerp(e.target, 1 - Math.exp(-1.6 * dt));
      const gy = groundHeight(e.pos.x, e.pos.z);
      if (ground) e.pos.y = gy + e.model.gearH;
      else if (e.pos.y < gy + 8) e.pos.y = gy + 8;

      const dist = e.pos.distanceTo(playerPos);
      const vis = dist < RENDER_DIST || e.hex === followHex;
      e.model.group.visible = vis;
      e.dmg.alive = vis;
      if (!vis) continue;

      // atitude: rumo verdadeiro + inclinação de curva + arfagem pela razão de subida
      const gsMs = Math.max(e.vel.length(), 1);
      const pitchT = ground ? 0 : clamp(Math.atan2(e.vsMs, gsMs), -0.22, 0.3);
      e.pitch += (pitchT - e.pitch) * Math.min(1, 2 * dt);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.pitch, -e.trackRad, -e.bank, "YXZ"));
      e.model.group.quaternion.slerp(q, 1 - Math.exp(-3 * dt));
      e.model.group.position.copy(e.pos);
      e.dmg.center.copy(e.pos);
      e.dmg.rotY = -e.trackRad;

      const parked = ground && e.data.gsKt < 2;
      e.model.gear.visible = ground || e.pos.y - gy < 300;
      if (e.model.prop) e.model.prop.rotation.z += dt * (parked ? 0 : 45);
      if (e.model.rotor) e.model.rotor.rotation.y += dt * (parked ? 4 : 28);
      if (e.model.tailRotor) e.model.tailRotor.rotation.x += dt * (parked ? 8 : 55);
      for (const s of e.model.strobes) s.visible = !parked && now % 1300 < 70;
      for (const b of e.model.beacons) b.visible = !parked && now % 1000 < 120;
      e.label.visible = labelsOn && dist < LABEL_DIST;

      // esteira de condensação em altitude de cruzeiro
      if (!ground && e.pos.y > 8200 && dist < 26000) {
        e.trailT -= dt;
        if (e.trailT <= 0) {
          e.trailT = 0.16;
          const back = e.vel.clone().normalize().multiplyScalar(-e.model.span * 0.4);
          this.fx.puff(e.pos.clone().add(back), [2.3, 2.3, 2.4], 0.22, 2.5, 14, 7);
        }
      }
    }
  }

  /** contatos para o radar ATC e mapa real */
  contacts(): { hex: string; cs: string; type: string; lat: number; lon: number; pos: THREE.Vector3; vel: THREE.Vector3; altFt: number; gsKt: number; trackDeg: number; onGround: boolean }[] {
    if (!this.enabled) return [];
    return [...this.entries.values()]
      .filter((e) => e.model.group.visible)
      .map((e) => ({
        hex: e.hex,
        cs: e.data.flight || e.data.reg || e.hex.toUpperCase(),
        type: e.data.type || "ADSB",
        lat: e.data.lat,
        lon: e.data.lon,
        pos: e.pos,
        vel: e.vel,
        altFt: e.data.onGround ? this.elevM * FT : e.data.altFt,
        gsKt: e.data.gsKt,
        trackDeg: e.data.trackDeg,
        onGround: e.data.onGround,
      }));
  }

  private toInfo(e: Entry): LiveFlightInfo {
    return {
      hex: e.hex,
      cs: e.data.flight || e.data.reg || e.hex.toUpperCase(),
      type: e.data.type || e.data.category || "—",
      reg: e.data.reg,
      desc: e.data.desc,
      squawk: e.data.squawk,
      altFt: e.data.onGround ? this.elevM * FT : e.data.altFt,
      gsKt: Math.round(e.data.gsKt),
      vsFpm: Math.round(e.data.vsFpm),
      distKm: e.pos.distanceTo(this.playerPos) / 1000,
      onGround: e.data.onGround,
      emergency: emergencyOf(e.data),
      lat: e.data.lat,
      lon: e.data.lon,
      trackDeg: e.data.trackDeg,
      identity: e.identity ?? null,
    };
  }

  /** dados completos de um voo (para o painel Live ATC e telemetria) */
  getFlight(hex: string): LiveFlightInfo | null {
    const e = this.entries.get(hex);
    return e ? this.toInfo(e) : null;
  }

  /** estado 3D completo para a câmera de acompanhamento do voo ADS-B */
  getFollowView(hex: string): LiveFollowState | null {
    const e = this.entries.get(hex);
    if (!e) return null;
    return {
      pos: e.pos.clone(),
      quat: e.model.group.quaternion.clone(),
      vel: e.vel.clone(),
      span: e.model.span,
      isJet: e.poolKey !== "c172" && e.poolKey !== "heli",
      info: this.toInfo(e),
    };
  }

  info(): LiveInfo {
    const flights: LiveFlightInfo[] = [...this.entries.values()]
      .map((e) => this.toInfo(e))
      .sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.distKm - b.distKm)
      .slice(0, 10);
    return {
      on: this.enabled,
      status: this.status,
      source: this.source,
      ageSec: this.lastOk ? Math.round((performance.now() - this.lastOk) / 1000) : 0,
      count: this.entries.size,
      total: this.total,
      flights,
    };
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const e of [...this.entries.values()]) this.release(e);
    this.pool.clear();
  }
}