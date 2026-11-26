import * as THREE from "three";
import { ParticleLayer, cloudTexture } from "./fx";
import type { Quality } from "./terrain";
import type { Weather } from "./weather";

export interface CloudCell {
  id: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  kind: "cumulus" | "stratus" | "cb";
  intensity: number; // 0..1 (reflete precipitação / eco de radar WX)
  puffs: { ox: number; oy: number; oz: number; s: number; phase: number; dark: number }[];
  seed: number;
}

export interface CloudSample {
  density: number; // 0 = céu aberto, 1 = dentro de nuvem espessa
  isCB: boolean;
  turb: number; // 0..1 intensidade de turbulência na nuvem
}

export interface WeatherRadarCell {
  x: number;
  z: number;
  radius: number;
  intensity: number; // 0.1..1.0 -> verde / amarelo / vermelho
  isCB: boolean;
}

const R = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

/**
 * Campo dinâmico de nuvens:
 * - Camadas de cumulus, stratus e cumulonimbus conforme a meteorologia (real ou fixa)
 * - Deriva pelo vento real e reciclagem contínua ao redor da aeronave
 * - Evolução orgânica das bordas
 * - Detecção de entrada em nuvens densas (névoa + turbulência + perda de visibilidade)
 * - Fonte única para a camada meteorológica (WX) da Janela do Radar
 */
export class CloudField {
  readonly mesh: THREE.Mesh;
  private layer: ParticleLayer;
  private cells: CloudCell[] = [];
  private radius = 22000;
  private nextId = 1;
  private tint = new THREE.Color(1, 1, 1);
  private opacity = 0.85;
  private wx: Weather;
  private quality: Quality;

  constructor(quality: Quality, wx: Weather) {
    this.quality = quality;
    this.wx = wx;
    const maxPuffs = quality === "low" ? 260 : quality === "medium" ? 520 : 820;
    this.layer = new ParticleLayer(maxPuffs, cloudTexture(), false, true);
    this.mesh = this.layer.mesh;
    this.mesh.renderOrder = 8;
    this.rebuild(0, 0, wx);
  }

  /** Reconstrói o campo inicial ao redor de (cx, cz) de acordo com o clima */
  rebuild(cx: number, cz: number, wx: Weather) {
    this.wx = wx;
    this.cells = [];
    const maxCells = this.quality === "low" ? 26 : this.quality === "medium" ? 48 : 72;
    const cover = clamp(wx.cloud, 0.08, 1);
    const n = Math.max(6, Math.round(maxCells * (0.18 + cover * 0.95)));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * this.radius;
      this.cells.push(this.makeCell(cx + Math.cos(ang) * dist, cz + Math.sin(ang) * dist, wx));
    }
    this.syncParticles(0);
  }

  setWeather(wx: Weather) {
    const diff = Math.abs(wx.cloud - this.wx.cloud) > 0.25 || wx.thunder !== this.wx.thunder;
    this.wx = wx;
    if (diff && this.cells.length) {
      const c = this.cells[0];
      this.rebuild(c.x, c.z, wx);
    }
  }

  setAppearance(tint: THREE.Color, opacity: number) {
    this.tint.copy(tint);
    this.opacity = opacity;
    (this.layer.uniforms.tint.value as THREE.Color).copy(tint);
    this.layer.uniforms.opacity.value = opacity;
  }

  private makeCell(x: number, z: number, wx: Weather): CloudCell {
    const stormy = wx.thunder || wx.precip > 2.5 || wx.snow > 0.8;
    const wet = wx.precip > 0.08 || wx.snow > 0.05 || wx.cloud > 0.6;
    let kind: CloudCell["kind"] = "cumulus";
    if (stormy && Math.random() < 0.45) kind = "cb";
    else if (wet && Math.random() < 0.4) kind = "stratus";
    else if (wx.cloud > 0.75 && Math.random() < 0.16) kind = "cb";

    const puffs: CloudCell["puffs"] = [];
    let rx = 450, ry = 180, rz = 450, y = 1200, intensity = 0.08;

    if (kind === "cb") {
      // Cumulonimbus: torre vertical alta, base baixa escura e bigorna
      y = R(900, 1450);
      rx = R(650, 1200);
      rz = R(650, 1200);
      ry = R(750, 1300);
      intensity = clamp(0.55 + wx.precip / 10 + (wx.thunder ? 0.35 : 0.15), 0.5, 1.0);
      const count = this.quality === "low" ? 8 : 13;
      for (let i = 0; i < count; i++) {
        const hFrac = i / (count - 1);
        const spread = hFrac > 0.78 ? 1.25 : 0.55; // bigorna no topo
        puffs.push({
          ox: (Math.random() - 0.5) * rx * spread,
          oy: (hFrac - 0.35) * ry * 1.4,
          oz: (Math.random() - 0.5) * rz * spread,
          s: R(480, 820) * (0.85 + 0.35 * (1 - Math.abs(hFrac - 0.4))),
          phase: Math.random() * 6.28,
          dark: hFrac < 0.32 ? 0.55 : hFrac < 0.65 ? 0.78 : 1.0, // base escura!
        });
      }
    } else if (kind === "stratus") {
      y = R(650, 1150);
      rx = R(750, 1300);
      rz = R(750, 1300);
      ry = R(180, 280);
      intensity = clamp(0.2 + wx.precip / 6 + wx.cloud * 0.25, 0.18, 0.72);
      const count = this.quality === "low" ? 6 : 9;
      for (let i = 0; i < count; i++) {
        puffs.push({
          ox: (Math.random() - 0.5) * rx * 1.1,
          oy: (Math.random() - 0.5) * ry * 0.7,
          oz: (Math.random() - 0.5) * rz * 1.1,
          s: R(460, 760),
          phase: Math.random() * 6.28,
          dark: 0.78,
        });
      }
    } else {
      y = R(1050, 2300);
      rx = R(420, 780);
      rz = R(420, 780);
      ry = R(200, 360);
      intensity = clamp(wx.cloud * 0.25 + wx.precip * 0.12, 0.05, 0.45);
      const count = this.quality === "low" ? 5 : 8;
      for (let i = 0; i < count; i++) {
        const oy = (Math.random() - 0.4) * ry;
        puffs.push({
          ox: (Math.random() - 0.5) * rx * 0.9,
          oy,
          oz: (Math.random() - 0.5) * rz * 0.9,
          s: R(300, 560),
          phase: Math.random() * 6.28,
          dark: oy < 0 ? 0.86 : 1.0,
        });
      }
    }

    return { id: this.nextId++, x, y, z, rx, ry, rz, kind, intensity, puffs, seed: Math.random() * 100 };
  }

  /** Atualiza posição das nuvens pelo vento real, recicla fora do raio e anima puffs */
  update(dt: number, nowSec: number, px: number, pz: number, wind: THREE.Vector3) {
    const rMax = this.radius * 1.08;
    // nuvens em altitude derivam um pouco mais rápido que o vento de superfície
    const wx = wind.x * 1.35 + (Math.hypot(wind.x, wind.z) < 0.8 ? 4.5 : 0);
    const wz = wind.z * 1.35 + (Math.hypot(wind.x, wind.z) < 0.8 ? 1.8 : 0);

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      c.x += wx * dt;
      c.z += wz * dt;
      // pequena flutuação vertical orgânica
      c.y += Math.sin(nowSec * 0.12 + c.seed) * 2.2 * dt;

      const dx = c.x - px, dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > rMax) {
        // reposiciona do lado de onde o vento sopra (upwind) para fluxo contínuo!
        const windLen = Math.hypot(wx, wz) || 1;
        const ux = -wx / windLen, uz = -wz / windLen;
        const ang = Math.atan2(uz, ux) + (Math.random() - 0.5) * 2.1;
        const dist = this.radius * R(0.82, 0.98);
        this.cells[i] = this.makeCell(px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist, this.wx);
      }
    }
    this.syncParticles(nowSec);
  }

  private syncParticles(nowSec: number) {
    // limpa e repopula (apenas ~300–700 instâncias, leva < 0.1 ms)
    this.layer.n = 0;
    const baseCol = 2.05;
    for (const c of this.cells) {
      const puffWind = Math.sin(nowSec * 0.25 + c.seed) * 18;
      for (const p of c.puffs) {
        const pulse = 1 + 0.08 * Math.sin(nowSec * 0.35 + p.phase);
        const br = baseCol * p.dark;
        const col: [number, number, number, number] = [br, br, br * 1.02, c.kind === "cb" ? 0.95 : 0.88];
        this.layer.spawn({
          x: c.x + p.ox + puffWind,
          y: c.y + p.oy,
          z: c.z + p.oz - puffWind * 0.5,
          life: 100,
          s0: p.s * pulse,
          s1: p.s * pulse,
          c0: col,
          c1: col,
          rot: p.phase + nowSec * 0.015,
          rotV: 0,
        });
      }
    }
    this.layer.update(10); // t = 0.1 => fadeIn = 1.0 (opacidade cheia)
  }

  /** Verifica se o ponto `pos` está dentro de alguma nuvem e retorna densidade/turbulência */
  sample(pos: THREE.Vector3): CloudSample {
    let bestD = 0;
    let isCB = false;
    let turb = 0;
    for (const c of this.cells) {
      const dx = (pos.x - c.x) / (c.rx * 0.85);
      const dy = (pos.y - c.y) / (c.ry * 0.75);
      const dz = (pos.z - c.z) / (c.rz * 0.85);
      const q2 = dx * dx + dy * dy + dz * dz;
      if (q2 >= 1.25) continue;
      const d = clamp(1 - Math.sqrt(q2) / 1.12, 0, 1);
      const dPow = Math.pow(d, 0.75) * (c.kind === "cb" ? 1.0 : c.kind === "stratus" ? 0.88 : 0.72);
      if (dPow > bestD) {
        bestD = dPow;
        if (c.kind === "cb") isCB = true;
        turb = Math.max(turb, dPow * (c.kind === "cb" ? 1.0 : c.kind === "stratus" ? 0.45 : 0.35));
      } else if (c.kind === "cb" && d > 0.1) {
        isCB = true;
        turb = Math.max(turb, d);
      }
    }
    return { density: clamp(bestD, 0, 1), isCB, turb: clamp(turb, 0, 1) };
  }

  /** Retorna células com eco de chuva/tempestade para a camada WX do Radar */
  weatherCells(): WeatherRadarCell[] {
    const out: WeatherRadarCell[] = [];
    for (const c of this.cells) {
      if (c.intensity < 0.1 && this.wx.cloud < 0.25) continue;
      out.push({
        x: c.x,
        z: c.z,
        radius: Math.max(c.rx, c.rz) * 0.95,
        intensity: c.intensity,
        isCB: c.kind === "cb",
      });
    }
    return out;
  }
}
