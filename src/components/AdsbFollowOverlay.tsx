"use client";
import type { LiveFollowState } from "@/sim/liveTraffic";
import type { FlightRouteInfo } from "@/app/api/adsb/route/route";
import { ArrowRight, Plane, VideoOff, Compass, Gauge, Mountain } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

interface Props {
  flight: LiveFollowState["info"];
  route: FlightRouteInfo | null;
  onExit: () => void;
}

/**
 * Cartão exibido na tela durante o acompanhamento 3D de um voo ADS-B real.
 * Mostra Origem/Destino, Altitude, Velocidade, Razão vertical, Proa e controles da câmera livre.
 */
export default function AdsbFollowOverlay({ flight, route, onExit }: Props) {
  const orig = route?.origin;
  const dest = route?.destination;
  const reg = route?.registration || flight.reg;
  const model = route?.aircraftName || flight.desc || flight.type;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-14 z-30 w-[440px] max-w-[94vw] -translate-x-1/2 rounded-lg border border-sky-500/70 bg-slate-950/90 px-4 py-3 shadow-[0_12px_40px_rgba(14,165,233,0.25)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Plane size={16} className="shrink-0 text-sky-300" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-black tracking-wider text-white">{flight.cs}</span>
              {reg && <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">{reg}</span>}
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[9px] text-sky-300">{flight.type}</span>
            </div>
            <div className="truncate text-[10px] text-slate-400">
              {route?.airline ? `${route.airline} · ` : ""}{model}
            </div>
          </div>
        </div>
        <button
          onClick={onExit}
          className="flex shrink-0 items-center gap-1.5 rounded bg-sky-500 px-2.5 py-1.5 text-[10px] font-black tracking-wider text-slate-950 transition hover:bg-sky-400"
        >
          <VideoOff size={12} /> MEU AVIÃO (ESC)
        </button>
      </div>

      {/* Origem e Destino */}
      <div className="mt-2.5 flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/70 px-3 py-1.5">
        <div className="min-w-0">
          <div className="text-[8px] font-bold tracking-widest text-slate-500">ORIGEM</div>
          <div className="font-display text-sm font-bold text-slate-100">
            {orig ? `${orig.iata || orig.icao}` : "—"}
            {orig?.city && <span className="ml-1.5 font-sans text-[10px] font-normal text-slate-400">{orig.city}</span>}
          </div>
        </div>
        <ArrowRight size={15} className="mx-2 shrink-0 text-sky-400" />
        <div className="min-w-0 text-right">
          <div className="text-[8px] font-bold tracking-widest text-slate-500">DESTINO</div>
          <div className="font-display text-sm font-bold text-slate-100">
            {dest ? `${dest.iata || dest.icao}` : "—"}
            {dest?.city && <span className="ml-1.5 font-sans text-[10px] font-normal text-slate-400">{dest.city}</span>}
          </div>
        </div>
      </div>

      {/* Telemetria básica */}
      <div className="mt-2 grid grid-cols-4 gap-2 text-center font-mono">
        <div className="rounded bg-slate-900/60 px-2 py-1">
          <div className="flex items-center justify-center gap-1 text-[8px] text-slate-500"><Mountain size={9} /> ALTITUDE</div>
          <div className="text-xs font-bold text-amber-300">
            {flight.onGround ? "SOLO" : flight.altFt >= 18000 ? `FL${Math.round(flight.altFt / 100)}` : `${fmt(flight.altFt)} ft`}
          </div>
        </div>
        <div className="rounded bg-slate-900/60 px-2 py-1">
          <div className="flex items-center justify-center gap-1 text-[8px] text-slate-500"><Gauge size={9} /> VELOCIDADE</div>
          <div className="text-xs font-bold text-emerald-300">{flight.gsKt} kt</div>
        </div>
        <div className="rounded bg-slate-900/60 px-2 py-1">
          <div className="text-[8px] text-slate-500">V/S</div>
          <div className={`text-xs font-bold ${flight.vsFpm > 300 ? "text-emerald-300" : flight.vsFpm < -300 ? "text-sky-300" : "text-slate-300"}`}>
            {flight.onGround ? "0" : `${flight.vsFpm > 0 ? "+" : ""}${fmt(flight.vsFpm)}`}
          </div>
        </div>
        <div className="rounded bg-slate-900/60 px-2 py-1">
          <div className="flex items-center justify-center gap-1 text-[8px] text-slate-500"><Compass size={9} /> PROA</div>
          <div className="text-xs font-bold text-slate-200">{String(Math.round(flight.trackDeg) % 360).padStart(3, "0")}°</div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-500">
        <span>🖱 Arraste o mouse p/ girar · Roda p/ zoom · Duplo clique centraliza</span>
        <span className="font-mono">{flight.distKm.toFixed(1)} km{flight.squawk ? ` · SQK ${flight.squawk}` : ""}</span>
      </div>
    </div>
  );
}
