"use client";
import type { Snapshot } from "@/sim/engine";
import type { AircraftSpec } from "@/sim/aircraft";
import { WEAPON_LABEL } from "@/sim/aircraft";
import { Crosshair, Flame, Radar, TriangleAlert, Bomb, Rocket, RadioTower, Lightbulb } from "lucide-react";
import PanelShell from "./PanelShell";

const fmt = (n: number, d = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------- instrumentos SVG ----------
function Attitude({ pitch, roll, size = 150, digital = false }: { pitch: number; roll: number; size?: number; digital?: boolean }) {
  const r = size / 2;
  const py = Math.max(-40, Math.min(40, pitch)) * (r / 45);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-lg">
      <defs>
        <clipPath id={`att-${size}-${digital}`}>
          <circle cx={r} cy={r} r={r - 6} />
        </clipPath>
      </defs>
      <circle cx={r} cy={r} r={r - 2} fill="#0c1118" stroke={digital ? "#2f4f3f" : "#3a4250"} strokeWidth="3" />
      <g clipPath={`url(#att-${size}-${digital})`}>
        <g transform={`rotate(${-roll} ${r} ${r}) translate(0 ${py})`}>
          <rect x={-size} y={-size * 2} width={size * 3} height={size * 2 + r} fill={digital ? "#1c5c8f" : "#2d6da8"} />
          <rect x={-size} y={r} width={size * 3} height={size * 2} fill={digital ? "#6b4a1e" : "#7a5222"} />
          <line x1={-size} y1={r} x2={size * 2} y2={r} stroke="#e8eef2" strokeWidth="2" />
          {[-20, -10, 10, 20].map((d) => (
            <g key={d}>
              <line x1={r - 22} y1={r - d * (r / 45)} x2={r + 22} y2={r - d * (r / 45)} stroke="#dfe6ea" strokeWidth="1.4" />
              <text x={r + 28} y={r - d * (r / 45) + 4} fill="#dfe6ea" fontSize="9">{Math.abs(d)}</text>
            </g>
          ))}
        </g>
      </g>
      {/* símbolo da aeronave */}
      <path d={`M ${r - 34} ${r} l 22 0 l 6 7 l 6 -7 l 22 0`} stroke="#ffd23c" strokeWidth="3" fill="none" />
      <circle cx={r} cy={r} r="2.4" fill="#ffd23c" />
      {/* arco de roll */}
      {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => (
        <line key={a}
          x1={r + Math.sin((a * Math.PI) / 180) * (r - 8)} y1={r - Math.cos((a * Math.PI) / 180) * (r - 8)}
          x2={r + Math.sin((a * Math.PI) / 180) * (r - (a % 30 === 0 ? 18 : 13))} y2={r - Math.cos((a * Math.PI) / 180) * (r - (a % 30 === 0 ? 18 : 13))}
          stroke="#cfd6dc" strokeWidth={a === 0 ? 2.4 : 1.2} />
      ))}
      <polygon points={`${r},${10} ${r - 5},${20} ${r + 5},${20}`} fill="#ffd23c"
        transform={`rotate(${-roll} ${r} ${r})`} />
    </svg>
  );
}

function RoundDial({ label, value, unit, max, size = 108, digits = 0, danger = 0 }:
  { label: string; value: number; unit: string; max: number; size?: number; digits?: number; danger?: number }) {
  const r = size / 2;
  const ang = (Math.min(Math.max(value, 0), max) / max) * 300 - 150;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r - 2} fill="#0d1015" stroke="#3a4250" strokeWidth="3" />
      {Array.from({ length: 11 }).map((_, i) => {
        const a = ((i / 10) * 300 - 150) * (Math.PI / 180);
        const isDanger = danger > 0 && i / 10 >= danger;
        return (
          <g key={i}>
            <line x1={r + Math.sin(a) * (r - 7)} y1={r - Math.cos(a) * (r - 7)}
              x2={r + Math.sin(a) * (r - 14)} y2={r - Math.cos(a) * (r - 14)}
              stroke={isDanger ? "#ff5a4a" : "#cfd6dc"} strokeWidth="2" />
            <text x={r + Math.sin(a) * (r - 23)} y={r - Math.cos(a) * (r - 23) + 3}
              fill="#9aa4ae" fontSize="8" textAnchor="middle">{fmt((i / 10) * max)}</text>
          </g>
        );
      })}
      <g transform={`rotate(${ang} ${r} ${r})`}>
        <line x1={r} y1={r + 10} x2={r} y2={r - r + 16} stroke="#f2f5f7" strokeWidth="2.6" />
      </g>
      <circle cx={r} cy={r} r="4" fill="#5a636e" />
      <text x={r} y={r + 26} fill="#8d97a1" fontSize="9" textAnchor="middle" fontWeight="bold">{label}</text>
      <text x={r} y={r + 38} fill="#e8eef2" fontSize="10" textAnchor="middle" fontFamily="monospace">{fmt(value, digits)}{unit}</text>
    </svg>
  );
}

function Compass({ heading, size = 130, digital = false }: { heading: number; size?: number; digital?: boolean }) {
  const r = size / 2;
  const cards: [number, string][] = [[0, "N"], [90, "L"], [180, "S"], [270, "O"]];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r - 2} fill={digital ? "#08120c" : "#0d1015"} stroke={digital ? "#2f4f3f" : "#3a4250"} strokeWidth="3" />
      <g transform={`rotate(${-heading} ${r} ${r})`}>
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          return <line key={i} x1={r + Math.sin(a) * (r - 6)} y1={r - Math.cos(a) * (r - 6)}
            x2={r + Math.sin(a) * (r - (i % 3 === 0 ? 15 : 10))} y2={r - Math.cos(a) * (r - (i % 3 === 0 ? 15 : 10))}
            stroke="#aab4be" strokeWidth={i % 9 === 0 ? 2 : 1} />;
        })}
        {cards.map(([deg, txt]) => (
          <text key={deg} x={r + Math.sin((deg * Math.PI) / 180) * (r - 26)} y={r - Math.cos((deg * Math.PI) / 180) * (r - 26) + 5}
            fill={txt === "N" ? "#ff6a5a" : "#e8eef2"} fontSize="13" fontWeight="bold" textAnchor="middle"
            transform={`rotate(${deg} ${r + Math.sin((deg * Math.PI) / 180) * (r - 26)} ${r - Math.cos((deg * Math.PI) / 180) * (r - 26)})`}>{txt}</text>
        ))}
      </g>
      <polygon points={`${r},8 ${r - 5},18 ${r + 5},18`} fill="#ffd23c" />
      <rect x={r - 22} y={r - 10} width="44" height="20" rx="3" fill="#05080c" stroke="#3a4250" />
      <text x={r} y={r + 4} fill={digital ? "#5aff8a" : "#e8eef2"} fontSize="12" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
        {String(Math.round(heading) % 360).padStart(3, "0")}°
      </text>
    </svg>
  );
}

function Tape({ value, label, unit, step, digits = 0, height = 170, green = false }:
  { value: number; label: string; unit: string; step: number; digits?: number; height?: number; green?: boolean }) {
  const h = height, w = 74, mid = h / 2;
  const col = green ? "#5aff8a" : "#e8f2ea";
  const ticks: { v: number; y: number }[] = [];
  const base = Math.round(value / step) * step;
  for (let i = -5; i <= 5; i++) {
    const v = base + i * step;
    ticks.push({ v, y: mid - ((v - value) / step) * (h / 9) });
  }
  return (
    <svg width={w} height={h + 20} viewBox={`0 0 ${w} ${h + 20}`}>
      <text x={w / 2} y={11} fill="#8d97a1" fontSize="9" textAnchor="middle" fontWeight="bold">{label}</text>
      <rect x="2" y="16" width={w - 4} height={h} fill="rgba(6,12,9,0.82)" stroke="#2f4f3f" rx="4" />
      <clipPath id={`tape-${label}`}><rect x="2" y="16" width={w - 4} height={h} /></clipPath>
      <g clipPath={`url(#tape-${label})`} transform="translate(0 16)">
        {ticks.map(({ v, y }, i) => (
          <g key={i}>
            <line x1={w - 12} y1={y} x2={w - 4} y2={y} stroke="#5a7a66" strokeWidth="1.4" />
            <text x={w - 16} y={y + 3} fill="#7fa08c" fontSize="9" textAnchor="end" fontFamily="monospace">{fmt(v, digits)}</text>
          </g>
        ))}
      </g>
      <rect x="2" y={mid + 16 - 11} width={w - 4} height="22" fill="#05080c" stroke={col} strokeWidth="1.4" rx="3" />
      <text x={w - 8} y={mid + 20} fill={col} fontSize="13" fontFamily="monospace" fontWeight="bold" textAnchor="end">{fmt(value, digits)}</text>
      <text x={w / 2} y={h + 30} fill="#8d97a1" fontSize="8" textAnchor="middle">{unit}</text>
    </svg>
  );
}

function RadarScope({ snap }: { snap: Snapshot }) {
  const s = 132, r = s / 2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <rect x="1" y="1" width={s - 2} height={s - 2} rx="8" fill="#04120a" stroke="#2f4f3f" strokeWidth="2" />
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} cx={r} cy={r} r={(r - 8) * f} fill="none" stroke="#1c3a2a" strokeWidth="1" />
      ))}
      <line x1={r} y1="6" x2={r} y2={s - 6} stroke="#1c3a2a" />
      <line x1="6" y1={r} x2={s - 6} y2={r} stroke="#1c3a2a" />
      {/* varredura */}
      <g transform={`rotate(${(snap.time / 22) % 360} ${r} ${r})`}>
        <path d={`M ${r} ${r} L ${r} 8 A ${r - 8} ${r - 8} 0 0 1 ${r + 26} 12 Z`} fill="rgba(90,255,138,0.14)" />
        <line x1={r} y1={r} x2={r} y2="8" stroke="#5aff8a" strokeWidth="1.4" opacity="0.7" />
      </g>
      {snap.radar.map((b, i) => {
        const x = r + b.x * (r - 10), y = r - b.y * (r - 10);
        const color = b.kind === "hostile" ? "#ff5a4a" : b.kind === "player" ? "#4ab8ff" : "#5aff8a";
        return b.kind === "hostile"
          ? <polygon key={i} points={`${x},${y - 4} ${x + 4},${y} ${x},${y + 4} ${x - 4},${y}`} fill={color} />
          : <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill={color} />;
      })}
      <polygon points={`${r},${r - 6} ${r + 4},${r + 4} ${r - 4},${r + 4}`} fill="#ffd23c" />
      <text x={r} y={s - 5} fill="#4d7a5f" fontSize="7" textAnchor="middle">RDR 8KM · ▲VOCÊ ◆HOSTIL ■TRÁFEGO</text>
    </svg>
  );
}

function Bar({ label, value, color, warn = false }: { label: string; value: number; color: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-9 text-[9px] font-bold tracking-wider ${warn ? "text-red-400" : "text-slate-400"}`}>{label}</span>
      <div className="h-2.5 w-20 overflow-hidden rounded-sm bg-slate-800/80 ring-1 ring-slate-600/40">
        <div className="h-full transition-all duration-150" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Lamp({ on, label, color = "#5aff8a", icon }: { on: boolean; label: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex h-6 w-12 items-center justify-center rounded-sm border text-[8px] font-bold tracking-wide transition-colors"
        style={{
          borderColor: on ? color : "#3a4250",
          color: on ? "#08110b" : "#5a636e",
          background: on ? color : "rgba(15,20,28,0.8)",
          boxShadow: on ? `0 0 10px ${color}66` : "none",
        }}>
        {icon ?? label}
      </div>
      <span className="text-[7px] font-bold tracking-wider text-slate-500">{label}</span>
    </div>
  );
}

// ---------- HUD central (caças) ----------
export function GunsightHUD({ snap, spec }: { snap: Snapshot; spec: AircraftSpec }) {
  if (!spec.gunsight || snap.camera === "tower" || snap.crashed) return null;
  const green = "#7dffa8";
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg width="440" height="360" viewBox="0 0 440 360" style={{ filter: "drop-shadow(0 0 3px rgba(90,255,138,0.5))" }}>
        {/* retículo */}
        <circle cx="220" cy="180" r="34" fill="none" stroke={green} strokeWidth="1.4" opacity="0.9" />
        <circle cx="220" cy="180" r="2" fill={green} />
        <line x1="220" y1="138" x2="220" y2="152" stroke={green} strokeWidth="1.4" />
        <line x1="220" y1="208" x2="220" y2="222" stroke={green} strokeWidth="1.4" />
        <line x1="178" y1="180" x2="192" y2="180" stroke={green} strokeWidth="1.4" />
        <line x1="248" y1="180" x2="262" y2="180" stroke={green} strokeWidth="1.4" />
        {/* escada de pitch */}
        <g transform={`rotate(${-snap.rollDeg} 220 180) translate(0 ${snap.pitchDeg * 3.2})`} opacity="0.75">
          {[-20, -10, 10, 20].map((d) => (
            <g key={d}>
              <line x1="150" y1={180 - d * 3.2} x2="195" y2={180 - d * 3.2} stroke={green} strokeWidth="1" strokeDasharray={d < 0 ? "5 4" : ""} />
              <line x1="245" y1={180 - d * 3.2} x2="290" y2={180 - d * 3.2} stroke={green} strokeWidth="1" strokeDasharray={d < 0 ? "5 4" : ""} />
              <text x="140" y={183 - d * 3.2} fill={green} fontSize="9" textAnchor="end" fontFamily="monospace">{d}</text>
            </g>
          ))}
          <line x1="120" y1="180" x2="195" y2="180" stroke={green} strokeWidth="1.2" />
          <line x1="245" y1="180" x2="320" y2="180" stroke={green} strokeWidth="1.2" />
        </g>
        {/* dados laterais */}
        <text x="66" y="160" fill={green} fontSize="12" fontFamily="monospace" fontWeight="bold">{fmt(snap.ias)}</text>
        <text x="66" y="174" fill={green} fontSize="8" fontFamily="monospace">IAS KT</text>
        <text x="374" y="160" fill={green} fontSize="12" fontFamily="monospace" fontWeight="bold" textAnchor="end">{fmt(snap.altFt)}</text>
        <text x="374" y="174" fill={green} fontSize="8" fontFamily="monospace" textAnchor="end">ALT FT</text>
        <text x="374" y="196" fill={green} fontSize="10" fontFamily="monospace" textAnchor="end">M {snap.mach.toFixed(2)}</text>
        <text x="66" y="196" fill={green} fontSize="10" fontFamily="monospace">{snap.gForce.toFixed(1)}G</text>
        <text x="220" y="26" fill={green} fontSize="11" fontFamily="monospace" textAnchor="middle">
          {String(Math.round(snap.headingDeg) % 360).padStart(3, "0")}
        </text>
        <line x1="220" y1="32" x2="220" y2="40" stroke={green} />
        {/* trava IR */}
        {snap.lock && (
          <g>
            <rect x="180" y="252" width="80" height="34" fill="none" stroke={snap.weapon === "missileIR" ? "#ff5a4a" : green} strokeWidth="1.6">
              <animate attributeName="opacity" values="1;0.4;1" dur="0.8s" repeatCount="indefinite" />
            </rect>
            <text x="220" y="266" fill="#ff8a7a" fontSize="9" fontFamily="monospace" textAnchor="middle" fontWeight="bold">TRAVA IR</text>
            <text x="220" y="279" fill={green} fontSize="8" fontFamily="monospace" textAnchor="middle">
              {snap.lock.name} · {(snap.lock.dist / 1000).toFixed(1)}km
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------- avisos ----------
function Warnings({ snap }: { snap: Snapshot }) {
  const w: { txt: string; color: string }[] = [];
  if (snap.stall) w.push({ txt: "ESTOL", color: "#ff4a3a" });
  if (snap.overspeed) w.push({ txt: "SOBREVELOCIDADE", color: "#ff9a3c" });
  if (!snap.onGround && snap.aglFt < 400 && snap.vsFpm < -1600) w.push({ txt: "PULL UP", color: "#ff4a3a" });
  if (snap.airspaceWarning) w.push({ txt: "ZONA DE CONTROLE — CHAME A TORRE", color: "#ffd23c" });
  if (snap.fuelPct < 15) w.push({ txt: "COMBUSTÍVEL BAIXO", color: "#ff9a3c" });
  if (snap.threat?.kind === "ir") w.push({ txt: `MÍSSIL IR — FLARES (Z) · ${(snap.threat.dist / 1000).toFixed(1)} km`, color: "#ff3a2a" });
  else if (snap.threat?.kind === "radar") w.push({ txt: `MÍSSIL RADAR — CHAFF (N) · ${(snap.threat.dist / 1000).toFixed(1)} km`, color: "#ff3a2a" });
  else if (snap.threat?.kind === "lock") w.push({ txt: `RWR: ${snap.threat.by} ILUMINANDO — ${(snap.threat.dist / 1000).toFixed(1)} km`, color: "#ffb02a" });
  if (snap.inCloud > 0.25 && snap.inCB) w.push({ txt: "CUMULONIMBUS — TURBULÊNCIA SEVERA", color: "#fb7185" });
  else if (snap.inCloud > 0.45) w.push({ txt: "VOO POR INSTRUMENTOS (IMC — EM NUVEM)", color: "#7dd3fc" });
  if (snap.brake && snap.onGround) w.push({ txt: "FREIO ESTACIONÁRIO", color: "#ffd23c" });
  if (snap.engineFire) w.push({ txt: "FOGO NO MOTOR", color: "#ff4a3a" });
  else if (snap.hp < snap.hpMax * 0.55 && !snap.crashed) w.push({ txt: "DANO ESTRUTURAL", color: "#ff9a3c" });
  if (snap.repair > 0.02) w.push({ txt: `EQUIPE DE SOLO ${Math.round(snap.repair * 100)}%`, color: "#5aff8a" });
  if (!snap.towerAlive) w.push({ txt: "TORRE DESTRUÍDA — SEM ATC", color: "#ff9a3c" });
  if (w.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[16%] z-20 flex -translate-x-1/2 flex-col items-center gap-1">
      {w.map((x) => (
        <div key={x.txt} className="animate-pulse rounded border-2 px-4 py-1 font-mono text-sm font-black tracking-widest"
          style={{ borderColor: x.color, color: x.color, background: "rgba(10,8,8,0.72)" }}>
          ⚠ {x.txt}
        </div>
      ))}
    </div>
  );
}

// ---------- painel principal ----------
// ---------- faixa compacta (painel oculto) ----------
function CompactStrip({ snap, spec }: { snap: Snapshot; spec: AircraftSpec }) {
  const item = (label: string, value: string, warn = false) => (
    <div className="flex flex-col items-center px-3">
      <span className="text-[8px] font-bold tracking-widest text-slate-500">{label}</span>
      <span className={`font-mono text-sm font-bold ${warn ? "text-red-400" : "text-emerald-300"}`}>{value}</span>
    </div>
  );
  return (
    <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center divide-x divide-emerald-900/60 rounded-md border border-emerald-900/70 bg-[#04120a]/70 py-1 backdrop-blur-sm">
      {item("IAS", `${fmt(snap.ias)} kt`, snap.stall)}
      {item("ALT", `${fmt(snap.altFt)} ft`)}
      {item("V/S", `${snap.vsFpm >= 0 ? "+" : ""}${fmt(snap.vsFpm)}`)}
      {item("PROA", `${String(Math.round(snap.headingDeg) % 360).padStart(3, "0")}°`)}
      {item("POT", `${Math.round(snap.throttle * 100)}%${snap.afterburner ? " PC" : ""}`)}
      {item("G", snap.gForce.toFixed(1), snap.gForce > spec.gLimit)}
      {item("TREM", snap.gear ? "▼ BAIXO" : "▲ CIMA")}
      {item("FLAP", `${snap.flaps * 30}°`)}
      {item("SPOIL", `${Math.round(snap.spoiler * 100)}%`, snap.spoiler > 0.05)}
      {item("LEME", snap.rudderCoupled ? "ACOPL" : "INDEP")}
      {item("COMB", `${Math.round(snap.fuelPct)}%`, snap.fuelPct < 15)}
      {item("INTEG", `${Math.round((snap.hp / snap.hpMax) * 100)}%`, snap.hp < snap.hpMax * 0.5)}
    </div>
  );
}

function LightsPanel({ snap, onToggleSpoiler, onToggleRudder }: {
  snap: Snapshot;
  onToggleSpoiler?: () => void;
  onToggleRudder?: () => void;
}) {
  const items: { key: keyof Snapshot["lights"]; digit: string; label: string; color: string }[] = [
    { key: "nav", digit: "5", label: "NAV", color: "#ff5a4a" },
    { key: "beacon", digit: "6", label: "BCN", color: "#ff3a2a" },
    { key: "strobe", digit: "7", label: "STRB", color: "#ffffff" },
    { key: "landing", digit: "8", label: "POUSO", color: "#ffe9a8" },
  ];
  const on = (v: boolean) => v;
  void on;
  return (
    <PanelShell
      title="LUZES EXTERNAS"
      icon={<Lightbulb size={13} />}
      accent="slate"
      width={214}
      storageKey="lights"
      defaultPos={{ x: 12, y: 56 }}
      collapsedHint={<span className="font-mono text-[9px] text-slate-400">{snap.lights.nav ? "NAV" : "off"}</span>}
    >
      <div className="flex items-center justify-between gap-1.5 px-2 py-2">
        {items.map((it) => (
          <div key={it.key} className="flex flex-col items-center gap-0.5">
            <div
              className="flex h-6 w-[42px] items-center justify-center rounded-sm border font-mono text-[8px] font-bold tracking-wide transition-all"
              style={{
                borderColor: snap.lights[it.key] ? it.color : "#3a4250",
                color: snap.lights[it.key] ? "#0b0f14" : "#5a636e",
                background: snap.lights[it.key] ? it.color : "rgba(15,20,28,0.85)",
                boxShadow: snap.lights[it.key] ? `0 0 9px ${it.color}99` : "none",
              }}
            >
              {it.label}
            </div>
            <span className="font-mono text-[7px] text-slate-500">{it.digit}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-slate-800 px-2 py-1.5">
        <button
          onClick={onToggleSpoiler}
          title="Alternar Spoiler / Freio Aerodinâmico (tecla / ou 9)"
          className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-sm border font-mono text-[8px] font-bold tracking-wide transition-all"
          style={{
            borderColor: snap.spoiler > 0.05 ? "#ff9a3c" : "#3a4250",
            color: snap.spoiler > 0.05 ? "#0b0f14" : "#8d99a6",
            background: snap.spoiler > 0.05 ? "#ff9a3c" : "rgba(15,20,28,0.85)",
            boxShadow: snap.spoiler > 0.05 ? "0 0 9px rgba(255,154,60,0.65)" : "none",
          }}
        >
          SPOILER {Math.round(snap.spoiler * 100)}%
        </button>
        <span className="font-mono text-[7px] text-slate-500">/ ou 9</span>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-800 px-2 py-1.5">
        <button
          onClick={onToggleRudder}
          title="Alternar Leme Acoplado vs. Independente (tecla TAB)"
          className="flex h-5 flex-1 cursor-pointer items-center justify-center rounded-sm border font-mono text-[8px] font-bold tracking-wide transition-all"
          style={{
            borderColor: snap.rudderCoupled ? "#38bdf8" : "#34d399",
            color: "#0b0f14",
            background: snap.rudderCoupled ? "#38bdf8" : "#34d399",
          }}
        >
          LEME: {snap.rudderCoupled ? "ACOPLADO" : "INDEP (< > / Q E)"}
        </button>
        <span className="font-mono text-[7px] text-slate-500">TAB</span>
      </div>
      <div className="px-2 pb-1.5 text-center text-[7px] tracking-[0.14em] text-slate-600">
        5 NAV · 6 BEACON · 7 STROBE · 8 POUSO
      </div>
    </PanelShell>
  );
}

export default function Cockpit({
  snap, spec, panelHidden = false, onToggleSpoiler, onToggleRudder, onRespawn,
}: {
  snap: Snapshot;
  spec: AircraftSpec;
  panelHidden?: boolean;
  onToggleSpoiler?: () => void;
  onToggleRudder?: () => void;
  onRespawn?: () => void;
}) {
  const armed = spec.loadout.cannon > 0;
  const weaponIcon = { cannon: <Crosshair size={13} />, bomb: <Bomb size={13} />, missileIR: <Flame size={13} />, missileRAD: <RadioTower size={13} /> };
  const hpPct = snap.hp / snap.hpMax;

  return (
    <>
      <GunsightHUD snap={snap} spec={spec} />
      <LightsPanel snap={snap} onToggleSpoiler={onToggleSpoiler} onToggleRudder={onToggleRudder} />
      <Warnings snap={snap} />
      {snap.hitFlash > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20" style={{ boxShadow: `inset 0 0 180px rgba(255,30,20,${snap.hitFlash * 0.8})` }} />
      )}
      {panelHidden && <CompactStrip snap={snap} spec={spec} />}

      {/* joystick virtual do mouse (tecla O) */}
      {snap.mouse.on && !snap.crashed && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute left-1/2 top-1/2 h-[18vh] w-[18vh] -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/40" style={{ boxShadow: "inset 0 0 30px rgba(125,211,252,0.08)" }}>
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-sky-300/20" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-sky-300/20" />
          </div>
          <div className="absolute left-1/2 top-1/2 h-3 w-3 rounded-full border-2 border-sky-300 bg-sky-300/30"
            style={{ transform: `translate(calc(-50% + ${snap.mouse.x * 20}vh), calc(-50% + ${snap.mouse.y * 20}vh))` }} />
          <div className="absolute left-1/2 top-[66%] -translate-x-1/2 rounded bg-slate-950/70 px-2 py-0.5 font-mono text-[9px] tracking-wider text-sky-300">
            MOUSE · {snap.mouse.y < -0.05 ? "↑" : snap.mouse.y > 0.05 ? "↓" : "·"}{Math.abs(Math.round(snap.mouse.y * 100))}% PROF · {Math.round(snap.mouse.x * 100)}% AIL · RODA=POTÊNCIA · {snap.invert ? "INVERTIDO" : "PADRÃO"}
          </div>
        </div>
      )}

      {/* faixa de armamento (somente militares) */}
      {armed && (
        <div className={`pointer-events-none absolute ${panelHidden ? "bottom-3" : "bottom-[248px]"} left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-emerald-900/70 bg-[#04120a]/85 px-3 py-1.5 font-mono text-[10px] text-emerald-300`}>
          {(["cannon", "bomb", "missileIR", "missileRAD"] as const).map((w, i) => (
            <div key={w} className={`flex items-center gap-1 rounded px-2 py-0.5 ${snap.weapon === w ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400" : "opacity-60"}`}>
              <span className="text-emerald-500">{i + 1}</span>
              {weaponIcon[w]}
              <span className="font-bold">{WEAPON_LABEL[w].split(" ")[0]}</span>
              <span className={snap.ammo[w] === 0 ? "text-red-400" : ""}>{snap.ammo[w]}</span>
            </div>
          ))}
          <span className="ml-1 whitespace-nowrap border-l border-emerald-800 pl-2 text-orange-300" title="Z flares · N chaff">
            <span className="text-emerald-500">Z</span> FLR <b className={snap.cm.flare === 0 ? "text-red-400" : ""}>{snap.cm.flare}</b>
            <span className="ml-1.5 text-emerald-500">N</span> CHF <b className={snap.cm.chaff === 0 ? "text-red-400" : ""}>{snap.cm.chaff}</b>
          </span>
          <span className="ml-1 whitespace-nowrap border-l border-emerald-800 pl-2 text-amber-300">PTS {fmt(snap.score)} · ABATES {snap.kills}</span>
        </div>
      )}

      {/* ====== PAINEL (P oculta) ====== */}
      {!panelHidden && (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto flex max-w-6xl items-end justify-center gap-3 px-3 pb-2">
          {/* ---- SIX-PACK ANALÓGICO (C-172) ---- */}
          {spec.panel === "steam" && (
            <div className="flex items-end gap-2 rounded-t-xl border-x border-t-4 border-[#2a2118] bg-gradient-to-b from-[#241c14]/95 to-[#15100a]/95 px-4 pb-2 pt-3 shadow-2xl">
              <RoundDial label="VELOCÍMETRO" value={snap.ias} unit="kt" max={160} danger={0.8} />
              <Attitude pitch={snap.pitchDeg} roll={snap.rollDeg} size={118} />
              <RoundDial label="ALTÍMETRO" value={snap.altFt % 10000} unit="ft" max={10000} />
              <Compass heading={snap.headingDeg} size={112} />
              <RoundDial label="SUBIDA" value={Math.abs(snap.vsFpm) / 100} unit={snap.vsFpm >= 0 ? "↑" : "↓"} max={20} />
              <div className="flex flex-col gap-1.5 pb-2 pl-2">
                <Bar label="RPM" value={snap.throttle} color="#e8eef2" />
                <Bar label="COMB" value={snap.fuelPct / 100} color={snap.fuelPct < 20 ? "#ff5a4a" : "#e0b23c"} warn={snap.fuelPct < 15} />
                <div className="flex gap-1.5 pt-1">
                  <Lamp on={snap.gear} label="TREM" />
                  <Lamp on={snap.flaps > 0} label={`FLAP ${snap.flaps * 30}°`} color="#ffd23c" />
                  <Lamp on={snap.brake} label="FREIO" color="#ff5a4a" />
                </div>
                <div className="pt-0.5 font-mono text-[9px] text-amber-200/80">ALT {fmt(snap.altFt)} ft · VS {fmt(snap.vsFpm)} fpm</div>
              </div>
            </div>
          )}

          {/* ---- MFD MILITAR (caças) ---- */}
          {spec.panel === "mfd" && (
            <div className="flex items-stretch gap-3 rounded-t-xl border-x border-t-4 border-[#1a2a20] bg-gradient-to-b from-[#0a1410]/95 to-[#050a07]/95 px-4 pb-2 pt-3 shadow-2xl">
              <div className="flex flex-col justify-between">
                <Tape value={snap.ias} label="IAS" unit="NÓS" step={20} green />
                <div className="pb-1 font-mono text-[10px] text-emerald-400">M {snap.mach.toFixed(2)} · {snap.gForce.toFixed(1)}G</div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Attitude pitch={snap.pitchDeg} roll={snap.rollDeg} size={158} digital />
                <Compass heading={snap.headingDeg} size={92} digital />
              </div>
              <div className="flex flex-col justify-between">
                <Tape value={snap.altFt} label="ALT" unit="PÉS" step={200} green />
                <div className="pb-1 font-mono text-[10px] text-emerald-400">VS {snap.vsFpm >= 0 ? "+" : ""}{fmt(snap.vsFpm)} · AGL {fmt(snap.aglFt)}</div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <RadarScope snap={snap} />
                <div className="flex gap-1.5">
                  <Lamp on={snap.gear} label="TREM" />
                  <Lamp on={snap.flaps > 0} label="FLAP" color="#ffd23c" />
                  <Lamp on={snap.afterburner} label="PÓS-Comb" color="#ff8a3c" icon={<Flame size={11} />} />
                  <Lamp on={snap.brake} label="FREIO" color="#ff5a4a" />
                </div>
              </div>
              <div className="flex w-24 flex-col justify-center gap-1.5 border-l border-emerald-900/60 pl-3">
                <Bar label="POT" value={snap.throttle} color={snap.afterburner ? "#ff8a3c" : "#5aff8a"} />
                <Bar label="COMB" value={snap.fuelPct / 100} color={snap.fuelPct < 20 ? "#ff5a4a" : "#5aff8a"} warn={snap.fuelPct < 15} />
                <div className="mt-1 font-mono text-[9px] leading-4 text-emerald-500">
                  <div>TREM {snap.gear ? "BAIXO" : "CIMA"}</div>
                  <div>FLAPS {fmt(snap.flaps * 100)}%</div>
                  <div className={snap.lock ? "animate-pulse text-red-400" : ""}>{snap.lock ? "◈ TRAVA IR" : "◇ SEEKER"}</div>
                  <div className="text-emerald-300">CAM {snap.camera.toUpperCase()}</div>
                </div>
              </div>
            </div>
          )}

          {/* ---- GLASS COCKPIT (737) ---- */}
          {spec.panel === "glass" && (
            <div className="flex items-stretch gap-3 rounded-t-xl border-x border-t-4 border-[#1c2733] bg-gradient-to-b from-[#0b1119]/95 to-[#05080d]/95 px-4 pb-2 pt-3 shadow-2xl">
              <Tape value={snap.ias} label="IAS" unit="NÓS" step={20} />
              <div className="flex flex-col items-center gap-1">
                <Attitude pitch={snap.pitchDeg} roll={snap.rollDeg} size={172} digital />
                <div className="font-mono text-[10px] text-sky-300">FD · AP OFF · A/THR OFF</div>
              </div>
              <Tape value={snap.altFt} label="ALT" unit="PÉS" step={200} />
              <div className="flex flex-col items-center justify-between">
                <Compass heading={snap.headingDeg} size={120} />
                <div className="flex gap-1.5 pb-1">
                  <Lamp on={snap.gear} label="TREM" />
                  <Lamp on={snap.flaps > 0} label={`FLAP ${snap.flaps * 30}`} color="#ffd23c" />
                  <Lamp on={snap.brake} label="PARK BRK" color="#ff5a4a" />
                </div>
              </div>
              <div className="flex w-28 flex-col justify-center gap-1.5 border-l border-slate-700/60 pl-3">
                <Bar label="N1" value={snap.throttle} color="#7dd3fc" />
                <Bar label="FUEL" value={snap.fuelPct / 100} color={snap.fuelPct < 20 ? "#ff5a4a" : "#7dd3fc"} warn={snap.fuelPct < 15} />
                <div className="mt-1 font-mono text-[9px] leading-4 text-slate-400">
                  <div>VS {snap.vsFpm >= 0 ? "+" : ""}{fmt(snap.vsFpm)} fpm</div>
                  <div>M {snap.mach.toFixed(2)} · {snap.gForce.toFixed(1)}G</div>
                  <div>AGL {fmt(snap.aglFt)} ft</div>
                  <div className="text-sky-300">SBVS · ILS 27</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      )}

      {/* status topo-esquerda */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-slate-700/60 bg-slate-950/70 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 font-display text-sm font-bold tracking-wider text-slate-100">
          <Radar size={14} className="text-emerald-400" /> {spec.short}
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{snap.camera.toUpperCase()}</span>
        </div>
        <div className="mt-1 font-mono text-[10px] leading-4 text-slate-400">
          <div>{fmt(snap.speedKt)} kt GS · {fmt(snap.altFt)} ft MSL</div>
          <div className={snap.onGround ? "text-amber-300" : "text-emerald-400"}>{snap.onGround ? "NO SOLO" : "EM VOO"} · RWY {snap.runway} · AGL {fmt(snap.aglFt)} ft</div>
          <div className="text-[9px] text-slate-500">PESO {fmt(snap.massKg)} kg (comb {fmt(snap.fuelKg)} · arm {fmt(snap.weaponsKg)})</div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] font-bold tracking-wider text-slate-400">INTEG</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full transition-all duration-200" style={{ width: `${hpPct * 100}%`, background: hpPct > 0.6 ? "#5aff8a" : hpPct > 0.3 ? "#ffb23c" : "#ff4a3a" }} />
          </div>
          <span className="font-mono text-[9px] text-slate-400">{Math.round(hpPct * 100)}%</span>
        </div>
        {(armed || snap.score !== 0) && (
          <div className="mt-1 font-mono text-[10px] text-amber-300">🏆 {fmt(snap.score)} pts · {snap.kills} abates</div>
        )}
      </div>

      {/* crash */}
      {snap.crashed && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-red-950/40">
          <div className="rounded-lg border-2 border-red-500 bg-slate-950/90 px-10 py-6 text-center">
            <TriangleAlert size={40} className="mx-auto text-red-500" />
            <div className="mt-2 font-display text-3xl font-black tracking-widest text-red-400">AERONAVE PERDIDA</div>
            <div className="mt-1 font-mono text-sm text-slate-400">Renascimento automático… ou pressione <kbd className="rounded bg-slate-800 px-1.5 text-slate-200">ENTER</kbd></div>
            {onRespawn && (
              <button onClick={onRespawn} className="mt-3 rounded bg-red-600 px-4 py-1.5 text-xs font-bold tracking-wider text-white hover:bg-red-500">
                RENASCER AGORA
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}