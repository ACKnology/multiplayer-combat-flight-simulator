"use client";
import type { Snapshot } from "@/sim/engine";
import { fmtDate, fmtLocal, phaseOfDay } from "@/sim/weather";
import PanelShell from "./PanelShell";
import { Clock, CloudRain, Cloud, Wind, Eye, Gauge, Thermometer, Sun, Moon, Sunrise, Rewind, FastForward, Radio } from "lucide-react";

interface Props {
  snap: Snapshot;
  tz: string;
  onShift: (h: number) => void;
  onSync: () => void;
  onScale: (n: number) => void;
}

export default function ClockWeather({ snap, tz, onShift, onSync, onScale }: Props) {
  const el = snap.sunEl;
  const Icon = el > 8 ? Sun : el > -6 ? Sunrise : Moon;
  const wx = snap.wx;
  const WxIcon = wx.precip > 0.1 ? CloudRain : Cloud;
  const utc = new Date(snap.simMs).toISOString().slice(11, 16);
  const btn = "flex h-6 items-center justify-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-1.5 text-[9px] font-bold text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300";

  return (
    <PanelShell
      title="RELÓGIO & CLIMA"
      icon={<Icon size={14} className={el > 8 ? "text-amber-300" : el > -6 ? "text-orange-300" : "text-sky-300"} />}
      accent="slate"
      width={250}
      storageKey="clock"
      defaultPos={{ x: 12, y: window.innerHeight - 300 }}
      badge={snap.timeScale > 1 ? <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] font-bold text-amber-300">{snap.timeScale}×</span> : undefined}
      collapsedHint={<span className="font-mono text-[10px] text-slate-400">{fmtLocal(tz, snap.simMs, false)}</span>}
    >
      <div className="space-y-2 px-3 pb-2.5 pt-2">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><Clock size={11} /> {fmtDate(tz, snap.simMs)} · UTC {utc}Z</span>
          <span className="font-mono text-slate-500">☀ {el.toFixed(0)}°</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold leading-none text-slate-100">{fmtLocal(tz, snap.simMs)}</span>
          <span className="text-[10px] font-bold tracking-wider text-sky-300/90">{phaseOfDay(el).toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onShift(-1)} className={btn} title="−1 hora ( - )"><Rewind size={10} /> 1h</button>
          <button onClick={() => onShift(1)} className={btn} title="+1 hora ( = )">1h <FastForward size={10} /></button>
          <button onClick={onSync} className={`${btn} ml-auto text-emerald-300`} title="Sincronizar com o relógio real ( 0 )">AGORA</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-slate-500">RELÓGIO</span>
          {[1, 60, 600].map((n) => (
            <button key={n} onClick={() => onScale(n)} className={`${btn} ${snap.timeScale === n ? "!border-amber-400 !text-amber-300" : ""}`} title="Velocidade (K alterna)">{n}×</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-800 pt-2 font-mono text-[10px] text-slate-300">
          <span className="flex items-center gap-1"><WxIcon size={11} className="text-sky-300" /> {Math.round(wx.cloud * 100)}% nuv.</span>
          <span className="flex items-center gap-1"><Thermometer size={11} className="text-orange-300" /> {wx.tempC.toFixed(0)}°C</span>
          <span className="flex items-center gap-1"><Wind size={11} className="text-emerald-300" /> {wx.wind}</span>
          <span className="flex items-center gap-1"><Eye size={11} className="text-slate-400" /> {wx.visKm >= 10 ? ">10" : wx.visKm.toFixed(1)} km</span>
          <span className="flex items-center gap-1"><Gauge size={11} className="text-amber-300" /> QNH {wx.qnh}</span>
          <span className="flex items-center gap-1"><Radio size={11} className={wx.live ? "text-emerald-400" : "text-slate-600"} /> {wx.live ? "ao vivo" : "padrão"}</span>
        </div>
      </div>
    </PanelShell>
  );
}
