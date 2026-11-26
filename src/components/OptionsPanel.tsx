"use client";
import { useEffect, useState } from "react";
import type { Snapshot } from "@/sim/engine";
import { X, Settings, Clock, SunMedium, Rows3, Smartphone, Hand, Sparkles } from "lucide-react";

export interface SimOptions {
  autoHideToolbar: boolean;
  showVirtualControls: boolean;
  invertHands: boolean;
  controlMode: "stick" | "tilt";
}

export const DEFAULT_OPTIONS: SimOptions = {
  autoHideToolbar: false,
  showVirtualControls: false,
  invertHands: false,
  controlMode: "stick",
};

interface Props {
  open: boolean;
  onClose: () => void;
  snap: Snapshot | null;
  glare: number;
  setGlare: (v: number) => void;
  options: SimOptions;
  setOptions: (o: SimOptions) => void;
  onShift: (h: number) => void;
  onSync: () => void;
  onScale: (n: number) => void;
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-left transition hover:border-slate-500">
      <span className="min-w-0">
        <span className="block text-[11px] font-bold tracking-wide text-slate-200">{label}</span>
        {hint && <span className="block text-[9px] leading-3 text-slate-500">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export default function OptionsPanel({ open, onClose, snap, glare, setGlare, options, setOptions, onShift, onSync, onScale }: Props) {
  const [hour, setHour] = useState(12);
  useEffect(() => {
    if (!open || !snap) return;
    const d = new Date(snap.simMs);
    setHour(d.getUTCHours() + d.getUTCMinutes() / 60);
  }, [open, snap]);

  if (!open) return null;
  const set = (o: Partial<SimOptions>) => setOptions({ ...options, ...o });
  const fmtHour = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-14 z-50 w-[330px] max-w-[94vw] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/96 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-3 py-2">
        <span className="flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.2em] text-amber-300">
          <Settings size={14} /> OPÇÕES
        </span>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Fechar opções"><X size={15} /></button>
      </div>

      <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-3">
        {/* hora da simulação */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400"><Clock size={11} /> HORA DA SIMULAÇÃO</span>
            <span className="font-mono text-[11px] font-bold text-amber-300">{fmtHour}</span>
          </div>
          <input
            type="range" min={0} max={23.75} step={0.25} value={hour}
            onChange={(e) => {
              const v = Number(e.target.value);
              setHour(v);
              if (!snap) return;
              const cur = new Date(snap.simMs);
              const curH = cur.getUTCHours() + cur.getUTCMinutes() / 60;
              let delta = v - curH;
              if (delta > 12) delta -= 24;
              if (delta < -12) delta += 24;
              onShift(delta);
            }}
            className="w-full accent-amber-400"
            aria-label="Hora da simulação"
          />
          <div className="mt-1 flex gap-1.5">
            <button onClick={() => onShift(-1)} className="flex-1 rounded border border-slate-700 bg-slate-800 py-1 text-[9px] font-bold text-slate-300">−1h</button>
            <button onClick={() => onShift(1)} className="flex-1 rounded border border-slate-700 bg-slate-800 py-1 text-[9px] font-bold text-slate-300">+1h</button>
            <button onClick={onSync} className="flex-1 rounded border border-emerald-700 bg-emerald-900/50 py-1 text-[9px] font-bold text-emerald-300">AGORA</button>
          </div>
          <div className="mt-1 flex gap-1.5">
            {[1, 60, 600].map((n) => (
              <button key={n} onClick={() => onScale(n)}
                className={`flex-1 rounded border py-1 text-[9px] font-bold ${snap?.timeScale === n ? "border-amber-400/70 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-800 text-slate-400"}`}>
                {n}×
              </button>
            ))}
          </div>
        </div>

        {/* glare */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400"><SunMedium size={11} /> BRILHO DO SOL (GLARE)</span>
            <span className="font-mono text-[10px] text-amber-300">{Math.round(glare * 100)}%</span>
          </div>
          <input type="range" min={0} max={1} step={0.05} value={glare} onChange={(e) => setGlare(Number(e.target.value))} className="w-full accent-amber-400" aria-label="Brilho do sol" />
        </div>

        {/* interface */}
        <Toggle on={options.autoHideToolbar} onClick={() => set({ autoHideToolbar: !options.autoHideToolbar })}
          label="Barra superior auto-recolhível" hint="Recolhe sozinha; reaparece ao aproximar o cursor/toque do topo" />

        {/* controles virtuais */}
        <Toggle on={options.showVirtualControls} onClick={() => set({ showVirtualControls: !options.showVirtualControls })}
          label="Manches virtuais na tela" hint="Manete + manche + botões de armas (mobile)" />

        {options.showVirtualControls && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => set({ invertHands: false })}
                className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-[10px] font-bold ${!options.invertHands ? "border-sky-400/70 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
                <Hand size={12} /> DIREITO
              </button>
              <button onClick={() => set({ invertHands: true })}
                className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-[10px] font-bold ${options.invertHands ? "border-sky-400/70 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
                <Hand size={12} className="-scale-x-100" /> CANHOTO
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => set({ controlMode: "stick" })}
                className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-[10px] font-bold ${options.controlMode === "stick" ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
                <Hand size={12} /> MANCHE 3D
              </button>
              <button onClick={() => set({ controlMode: "tilt" })}
                className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-[10px] font-bold ${options.controlMode === "tilt" ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
                <Smartphone size={12} /> ACELERÔMETRO
              </button>
            </div>
            <p className="text-[9px] leading-3.5 text-slate-500">
              {options.controlMode === "tilt"
                ? "Inclinação do aparelho controla a aeronave (iOS pede permissão ao ativar)."
                : "Manche tridimensional no canto inferior: arraste para comandar arfagem e rolagem."}
            </p>
          </>
        )}

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-[9px] leading-4 text-slate-500">
          <span className="flex items-center gap-1 font-bold text-slate-400"><Sparkles size={10} /> Dica</span>
          O manche virtual envia exatamente os mesmos comandos do teclado (A/D, W/S), sem interferir na câmera.
          No desktop, tudo continua funcionando pelas teclas.
        </div>
      </div>
    </div>
  );
}
