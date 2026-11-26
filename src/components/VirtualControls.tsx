"use client";
/**
 * VirtualControls — camada de controles por toque para mobile.
 * Não interfere na câmera: fica acima do canvas, captura o pointer e chama
 * `stopPropagation`. Usa Pointer Events (touch + mouse), com `touch-action: none`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot, FlightEngine } from "@/sim/engine";
import type { AircraftSpec } from "@/sim/aircraft";
import {
  ChevronUp, Crosshair, Bomb, Flame, Rocket, CircleDot, ArrowDownUp, Anchor, Wind,
  Camera, Plane, Pause, Play, Sparkles, ShieldQuestion,
} from "lucide-react";

export interface VirtualCtlSettings {
  show: boolean;
  invertSides: boolean;
  mode: "stick" | "tilt";
}

interface Props {
  engineRef: React.RefObject<FlightEngine | null>;
  snap: Snapshot | null;
  spec: AircraftSpec;
  settings: VirtualCtlSettings;
  paused: boolean;
  onPause: () => void;
  onCamera: () => void;
}

const clamp = (v: number, a = -1, b = 1) => Math.min(b, Math.max(a, v));

// ------------------------------------------------ MANETE (acelerador)
function ThrottleLever({ engineRef, snap }: { engineRef: React.RefObject<FlightEngine | null>; snap: Snapshot | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const power = snap?.throttle ?? 0;

  const apply = useCallback(
    (clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const v = clamp(1 - (clientY - r.top) / r.height, 0, 1);
      engineRef.current?.setVirtualThrottle(v);
    },
    [engineRef]
  );

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    apply(e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    // se o botão foi solto fora do elemento, encerra o arraste (evita "manete presa")
    if (e.pointerType === "mouse" && e.buttons === 0) {
      setDragging(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    apply(e.clientY);
  };
  const up = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  return (
    <div className="pointer-events-auto flex select-none flex-col items-center gap-1" style={{ touchAction: "none" }}>
      <div className="flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
        {Math.round(power * 100)}%
      </div>
      <div
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onLostPointerCapture={up}
        onClick={(e) => { e.stopPropagation(); apply(e.clientY); }}
        className="relative h-[190px] w-[78px] cursor-ns-resize"
        style={{ touchAction: "none" }}
        role="slider"
        aria-label="Potência do motor"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(power * 100)}
      >
        {/* trilho */}
        <div className="absolute left-1/2 top-0 h-full w-[16px] -translate-x-1/2 overflow-hidden rounded-full border border-slate-600/80 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 shadow-inner" />
        {/* preenchimento de potência */}
        <div
          className="absolute bottom-0 left-1/2 w-[16px] -translate-x-1/2 rounded-b-full transition-[height] duration-75"
          style={{
            height: `${power * 100}%`,
            background: power > 0.9
              ? "linear-gradient(to top,#f97316,#fb923c,#fdba74)"
              : "linear-gradient(to top,#0ea5e9,#22d3ee,#67e8f9)",
            boxShadow: power > 0.9 ? "0 0 12px rgba(249,115,22,0.65)" : "0 0 10px rgba(34,211,238,0.45)",
          }}
        />
        {/* marcas */}
        <div className="absolute inset-y-0 left-1/2 w-[40px] -translate-x-1/2">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <div key={t} className="absolute left-0 w-full border-t border-slate-600/50" style={{ bottom: `${t * 100}%` }} />
          ))}
          <div className="absolute left-0 w-full border-t border-dashed border-orange-400/70" style={{ bottom: "90%" }} />
        </div>
        {/* manete */}
        <div
          className="absolute left-1/2 flex h-7 w-[54px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border shadow-lg transition-[bottom] duration-75"
          style={{
            bottom: `${power * 100}%`,
            borderColor: dragging ? "#fbbf24" : "#64748b",
            background: "linear-gradient(180deg,#cbd5e1,#64748b 45%,#334155)",
            boxShadow: dragging ? "0 0 14px rgba(251,191,36,0.6)" : "0 2px 6px rgba(0,0,0,0.55)",
          }}
        >
          <div className="flex gap-[3px]">
            {[0, 1, 2].map((i) => <span key={i} className="h-3 w-[2px] rounded bg-slate-800/80" />)}
          </div>
        </div>
      </div>
      <div className="flex w-[62px] flex-col items-center gap-1">
        <ChevronUp size={11} className="text-slate-500" />
        <div className="text-[8px] font-bold tracking-widest text-slate-500">POTÊNCIA</div>
      </div>
    </div>
  );
}

// ------------------------------------------------ MANCHE 3D
function Stick3D({
  engineRef, snap, invertPitch,
}: { engineRef: React.RefObject<FlightEngine | null>; snap: Snapshot | null; invertPitch: boolean }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const R = 78; // raio máximo do deslocamento (px)

  const apply = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      setPos({ x: dx, y: dy });
      // arrastar para baixo = puxar o nariz para cima (padrão de manche)
      const pitch = clamp(dy / R) * (invertPitch ? -1 : 1);
      const roll = clamp(dx / R);
      engineRef.current?.setVirtualStick(pitch, roll);
    },
    [engineRef, invertPitch]
  );

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    apply(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      up(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    apply(e.clientX, e.clientY);
  };
  const up = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setPos({ x: 0, y: 0 });
    engineRef.current?.releaseVirtualStick();
  };

  const nx = pos.x / R, ny = pos.y / R;
  const pitchDeg = snap?.pitchDeg ?? 0;

  return (
    <div className="pointer-events-auto select-none" style={{ touchAction: "none" }}>
      <div
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onLostPointerCapture={up}
        className="relative h-[190px] w-[190px] cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none", perspective: "560px" }}
        aria-label="Manche virtual"
        role="application"
      >
        {/* base */}
        <div className="absolute inset-0 rounded-full border border-slate-600/60 bg-slate-950/55 backdrop-blur-sm"
          style={{ boxShadow: "inset 0 8px 22px rgba(0,0,0,0.75), 0 0 22px rgba(14,165,233,0.12)" }} />
        {/* anéis */}
        {[0.72, 0.46, 0.22].map((f) => (
          <div key={f} className="absolute rounded-full border border-slate-600/35"
            style={{ inset: `${(1 - f) * 50}%` }} />
        ))}
        {/* eixos */}
        <div className="absolute left-1/2 top-[8%] h-[84%] w-px -translate-x-1/2 bg-slate-600/25" />
        <div className="absolute left-[8%] top-1/2 h-px w-[84%] -translate-y-1/2 bg-slate-600/25" />
        {/* cruz central de referência */}
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/30" />

        {/* haste + empunhadura em 3D */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0"
          style={{
            transform: `translate(-50%,-50%) translate3d(${pos.x}px, ${pos.y}px, 0)`,
            transition: dragging ? "none" : "transform 160ms cubic-bezier(.2,.9,.25,1.15)",
          }}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(-50%,-50%) rotateX(${-ny * 16}deg) rotateY(${nx * 16}deg)`, transformStyle: "preserve-3d" }}
          >
            {/* sombra */}
            <div className="absolute left-1/2 top-1/2 h-[70px] w-[70px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/45 blur-md" />
            {/* corpo da empunhadura */}
            <div className="relative h-[62px] w-[46px] rounded-[14px] border border-slate-500/80"
              style={{
                background: "linear-gradient(155deg,#e2e8f0 0%,#94a3b8 32%,#475569 62%,#1e293b 100%)",
                boxShadow: "inset 0 2px 3px rgba(255,255,255,0.65), inset 0 -8px 14px rgba(0,0,0,0.65), 0 10px 18px rgba(0,0,0,0.55)",
                transform: "translateZ(18px)",
              }}
            >
              {/* topo com botão de tiro */}
              <div className="absolute left-1/2 top-[6px] h-3 w-3 -translate-x-1/2 rounded-full border border-red-900/70"
                style={{ background: dragging ? "radial-gradient(circle at 35% 30%,#ff7b6b,#b91c1c)" : "radial-gradient(circle at 35% 30%,#f87171,#7f1d1d)" }} />
              {/* textura de borracha */}
              <div className="absolute inset-x-[7px] top-[26px] space-y-[3px]">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-[2px] rounded bg-slate-900/45" />)}
              </div>
              {/* gatilho */}
              <div className="absolute -left-[3px] top-[30px] h-[14px] w-[6px] rounded-l bg-slate-700 shadow" />
              {/* base */}
              <div className="absolute -bottom-[6px] left-1/2 h-[8px] w-[54px] -translate-x-1/2 rounded-full border border-slate-600/70"
                style={{ background: "linear-gradient(180deg,#475569,#0f172a)", transform: "translateZ(-6px)" }} />
            </div>
          </div>
        </div>

        {/* leitura de comando */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center font-mono text-[8px] text-sky-300/80">
          PR {ny >= 0 ? "+" : "−"}{Math.round(Math.abs(ny) * 100)} · RL {nx >= 0 ? "+" : "−"}{Math.round(Math.abs(nx) * 100)}
        </div>
      </div>
      <div className="mt-0.5 text-center text-[8px] font-bold tracking-widest text-slate-500">MANCHE · {Math.round(pitchDeg)}° PITCH</div>
    </div>
  );
}

// ------------------------------------------------ BOTÕES DE ARMAS
function WeaponButtons({
  engineRef, snap, spec, onFireStart, onFireEnd,
}: {
  engineRef: React.RefObject<FlightEngine | null>;
  snap: Snapshot | null;
  spec: AircraftSpec;
  onFireStart: () => void;
  onFireEnd: () => void;
}) {
  if (spec.loadout.cannon === 0) return null;
  const items = [
    { key: "cannon" as const, icon: <Crosshair size={14} />, label: "CANH", ammo: snap?.ammo.cannon ?? 0, show: spec.loadout.cannon > 0 },
    { key: "bomb" as const, icon: <Bomb size={14} />, label: "BOMB", ammo: snap?.ammo.bomb ?? 0, show: spec.loadout.bomb > 0 },
    { key: "missileIR" as const, icon: <Flame size={14} />, label: "IR", ammo: snap?.ammo.missileIR ?? 0, show: spec.loadout.missileIR > 0 },
    { key: "missileRAD" as const, icon: <Rocket size={14} />, label: "RAD", ammo: snap?.ammo.missileRAD ?? 0, show: spec.loadout.missileRAD > 0 },
  ].filter((i) => i.show);

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5" style={{ touchAction: "none" }}>
      <div className="flex gap-1.5">
        {items.map((it) => {
          const active = snap?.weapon === it.key;
          return (
            <button
              key={it.key}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); engineRef.current?.setWeapon(it.key); if (it.key !== "cannon") engineRef.current?.fireVirtualOnce(); }}
              className={`relative flex h-12 w-12 flex-col items-center justify-center rounded-lg border transition ${
                active
                  ? "border-emerald-400 bg-emerald-500/25 text-emerald-200 shadow-[0_0_14px_rgba(16,185,129,0.45)]"
                  : "border-slate-600/80 bg-slate-950/70 text-slate-400"
              }`}
              style={{ touchAction: "none" }}
              aria-pressed={active}
              aria-label={`Selecionar ${it.label}`}
            >
              {it.icon}
              <span className="text-[7px] font-bold tracking-wider">{it.label}</span>
              <span className={`absolute -right-1 -top-1 rounded-full px-1 font-mono text-[8px] font-bold ${it.ammo === 0 ? "bg-red-600 text-white" : "bg-slate-800 text-emerald-300"}`}>
                {it.ammo > 999 ? "∞" : it.ammo}
              </span>
            </button>
          );
        })}
      </div>
      {/* gatilho */}
      <button
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onFireStart(); }}
        onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); onFireEnd(); }}
        onPointerCancel={onFireEnd}
        onPointerLeave={onFireEnd}
        className="flex h-11 items-center justify-center gap-1 rounded-lg border-2 border-red-500/80 bg-red-950/70 px-4 text-[10px] font-black tracking-widest text-red-300 active:bg-red-600 active:text-white"
        style={{ touchAction: "none" }}
        aria-label="Disparar"
      >
        <CircleDot size={14} /> FOGO
      </button>
    </div>
  );
}

// ------------------------------------------------ COMPONENTE PRINCIPAL
export default function VirtualControls({ engineRef, snap, spec, settings, paused, onPause, onCamera }: Props) {
  const [flaresOn, setFlaresOn] = useState(false);
  const [fireOn, setFireOn] = useState(false);
  const tiltRef = useRef<{ baseBeta: number | null; baseGamma: number | null }>({ baseBeta: null, baseGamma: null });

  // modo acelerômetro (mutuamente exclusivo com o manche)
  useEffect(() => {
    if (settings.mode !== "tilt" || !settings.show) return;
    let mounted = true;
    const onOrient = (ev: DeviceOrientationEvent) => {
      if (!mounted) return;
      const beta = ev.beta ?? 0;   // frente/trás
      const gamma = ev.gamma ?? 0; // esquerda/direita
      const st = tiltRef.current;
      if (st.baseBeta === null) {
        st.baseBeta = beta;
        st.baseGamma = gamma;
        return;
      }
      const baseBeta = st.baseBeta;
      const baseGamma = st.baseGamma;
      if (baseBeta === null || baseGamma === null) return;
      // normalização (±28° = comando total), com zona morta central
      const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : v);
      const pitch = dz(clamp((beta - baseBeta) / 28));
      const roll = dz(clamp(-(gamma - baseGamma) / 28));
      engineRef.current?.setVirtualStick(pitch, roll);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      mounted = false;
      window.removeEventListener("deviceorientation", onOrient);
      engineRef.current?.releaseVirtualStick();
    };
  }, [settings.mode, settings.show, engineRef]);

  // libera comandos ao esconder os controles
  useEffect(() => {
    if (settings.show) return;
    engineRef.current?.releaseVirtualStick();
    engineRef.current?.setVirtualThrottle(null);
    engineRef.current?.setVirtualFire(false);
    engineRef.current?.setVirtualCountermeasure("flare", false);
    engineRef.current?.setVirtualCountermeasure("chaff", false);
  }, [settings.show, engineRef]);

  useEffect(() => () => {
    engineRef.current?.releaseVirtualStick();
    engineRef.current?.setVirtualThrottle(null);
    engineRef.current?.setVirtualFire(false);
  }, [engineRef]);

  if (!settings.show) return null;

  const stop = (e: React.PointerEvent | React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const lever = (
    <div className="pointer-events-auto" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop}>
      <ThrottleLever engineRef={engineRef} snap={snap} />
    </div>
  );
  const stick = settings.mode === "tilt"
    ? (
      <div className="pointer-events-auto rounded-xl border border-sky-700/60 bg-slate-950/70 px-4 py-5 text-center" onPointerDown={stop}>
        <div className="text-[10px] font-bold tracking-widest text-sky-300">ACELERÔMETRO ATIVO</div>
        <div className="mt-1 font-mono text-[9px] leading-4 text-slate-400">Inclinar o aparelho para frente/trás = profundor<br />Inclinar para os lados = rolagem</div>
        <button
          onPointerDown={(e) => { stop(e); tiltRef.current = { baseBeta: null, baseGamma: null }; }}
          className="mt-2 rounded bg-sky-700 px-3 py-1 text-[10px] font-bold text-white"
        >
          RECENTRALIZAR
        </button>
      </div>
    )
    : <Stick3D engineRef={engineRef} snap={snap} invertPitch={snap?.invert ?? false} />;

  return (
    <>
      {/* ===== canto esquerdo/direito conforme preferência ===== */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex items-end justify-between px-2">
        <div className="flex flex-col items-center gap-2" style={{ order: settings.invertSides ? 2 : 1 }}>
          {lever}
        </div>
        <div className="flex flex-col items-center gap-2" style={{ order: settings.invertSides ? 1 : 2 }}>
          {stick}
        </div>
      </div>

      {/* ===== armas + auxiliares (acima da manete) ===== */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[236px] z-30 flex flex-col items-center gap-1.5 px-2">
        <div className="pointer-events-none flex w-full max-w-[440px] items-end justify-between">
          {/* auxiliares esquerda */}
          <div className="pointer-events-auto flex flex-col gap-1.5" style={{ order: settings.invertSides ? 2 : 1 }} onPointerDown={stop}>
            <button onPointerDown={(e) => { stop(e); engineRef.current?.toggleGearVirtual(); }}
              className={`flex h-9 w-11 flex-col items-center justify-center rounded-lg border text-[7px] font-bold ${
                snap?.gear ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-300" : "border-slate-600 bg-slate-950/70 text-slate-400"}`}
              aria-label="Trem de pouso">
              <ArrowDownUp size={12} /> TREM
            </button>
            <button onPointerDown={(e) => { stop(e); engineRef.current?.cycleFlapsVirtual(); }}
              className={`flex h-9 w-11 flex-col items-center justify-center rounded-lg border text-[7px] font-bold ${
                (snap?.flaps ?? 0) > 0 ? "border-amber-400/70 bg-amber-500/20 text-amber-300" : "border-slate-600 bg-slate-950/70 text-slate-400"}`}
              aria-label="Flaps">
              <Wind size={12} /> FLAP {Math.round((snap?.flaps ?? 0) * 30)}°
            </button>
            <button onPointerDown={(e) => { stop(e); engineRef.current?.toggleSpoiler(); }}
              className={`flex h-9 w-11 flex-col items-center justify-center rounded-lg border text-[7px] font-bold ${
                (snap?.spoiler ?? 0) > 0.05 ? "border-orange-400/70 bg-orange-500/20 text-orange-300" : "border-slate-600 bg-slate-950/70 text-slate-400"}`}
              aria-label="Freio aerodinâmico">
              <Wind size={12} /> SPOIL
            </button>
          </div>
          {/* armas / centro */}
          <div className="pointer-events-auto" onPointerDown={stop}>
            <WeaponButtons
              engineRef={engineRef} snap={snap} spec={spec}
              onFireStart={() => { setFireOn(true); engineRef.current?.setVirtualFire(true); }}
              onFireEnd={() => { setFireOn(false); engineRef.current?.setVirtualFire(false); }}
            />
          </div>
          {/* auxiliares direita */}
          <div className="pointer-events-auto flex flex-col gap-1.5" style={{ order: settings.invertSides ? 1 : 2 }} onPointerDown={stop}>
            <button onPointerDown={(e) => { stop(e); engineRef.current?.toggleBrakeVirtual(); }}
              className={`flex h-9 w-11 flex-col items-center justify-center rounded-lg border text-[7px] font-bold ${
                snap?.brake ? "border-red-400/70 bg-red-500/20 text-red-300" : "border-slate-600 bg-slate-950/70 text-slate-400"}`}
              aria-label="Freio de estacionamento">
              <Anchor size={12} /> FREIO
            </button>
            <button
              onPointerDown={(e) => { stop(e); setFlaresOn(true); engineRef.current?.setVirtualCountermeasure("flare", true); }}
              onPointerUp={(e) => { stop(e); setFlaresOn(false); engineRef.current?.setVirtualCountermeasure("flare", false); }}
              onPointerCancel={() => { setFlaresOn(false); engineRef.current?.setVirtualCountermeasure("flare", false); }}
              className={`flex h-9 w-11 flex-col items-center justify-center rounded-lg border text-[7px] font-bold ${flaresOn ? "border-orange-300 bg-orange-500/40 text-white" : "border-slate-600 bg-slate-950/70 text-orange-300"}`}
              aria-label="Flares">
              <Sparkles size={12} /> FLARE {(snap?.cm.flare ?? 0) > 999 ? "∞" : snap?.cm.flare ?? 0}
            </button>
            <button
              onPointerDown={(e) => { stop(e); engineRef.current?.setVirtualCountermeasure("chaff", true); }}
              onPointerUp={(e) => { stop(e); engineRef.current?.setVirtualCountermeasure("chaff", false); }}
              onPointerCancel={() => engineRef.current?.setVirtualCountermeasure("chaff", false)}
              className="flex h-9 w-11 flex-col items-center justify-center rounded-lg border border-slate-600 bg-slate-950/70 text-[7px] font-bold text-sky-300"
              aria-label="Chaff">
              <ShieldQuestion size={12} /> CHAFF
            </button>
          </div>
        </div>
        {fireOn && <div className="pointer-events-none font-mono text-[8px] tracking-widest text-red-400">DISPARANDO…</div>}
      </div>

      {/* ===== atalhos de interface (câmera / pausa) ===== */}
      <div className="pointer-events-auto absolute left-2 top-14 z-30 flex flex-col gap-1.5" onPointerDown={stop}>
        <button onPointerDown={(e) => { stop(e); onCamera(); }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-600 bg-slate-950/75 text-slate-300"
          aria-label="Trocar câmera"><Camera size={14} /></button>
        <button onPointerDown={(e) => { stop(e); onPause(); }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-600 bg-slate-950/75 text-amber-300"
          aria-label={paused ? "Retomar" : "Pausar"}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/60 text-emerald-400" title="Aeronave">
          <Plane size={14} />
        </div>
      </div>
    </>
  );
}
