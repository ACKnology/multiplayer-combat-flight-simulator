"use client";
import type { LiveInfo } from "@/sim/liveTraffic";
import type { FlightRouteInfo } from "@/app/api/adsb/route/route";
import PanelShell from "./PanelShell";
import {
  SatelliteDish, Plane, TrendingUp, TrendingDown, Minus, TriangleAlert, WifiOff, CircleParking,
  Headphones, Video, ArrowRight,
} from "lucide-react";

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function VsIcon({ fpm }: { fpm: number }) {
  if (fpm > 300) return <TrendingUp size={11} className="text-emerald-400" />;
  if (fpm < -300) return <TrendingDown size={11} className="text-sky-400" />;
  return <Minus size={11} className="text-slate-500" />;
}

interface Props {
  adsb: LiveInfo;
  onSelect?: (hex: string) => void;
  onListenAtc?: (hex: string) => void;
  onFollow3d?: (hex: string) => void;
  selectedHex?: string | null;
  followHex?: string | null;
  routeInfo?: FlightRouteInfo | null;
}

export default function LiveTrafficPanel({
  adsb, onSelect, onListenAtc, onFollow3d, selectedHex, followHex, routeInfo,
}: Props) {
  const live = adsb.status === "live";
  const offline = adsb.status === "offline";

  return (
    <PanelShell
      title="TRÁFEGO REAL · ADS-B"
      icon={<SatelliteDish size={14} />}
      accent="amber"
      width={284}
      storageKey="adsb"
      defaultPos={{ x: typeof window !== "undefined" ? window.innerWidth - 298 : 960, y: 96 }}
      badge={
        <span className={`ml-0.5 inline-block h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-400" : offline ? "bg-red-500" : "animate-ping bg-amber-400"}`} />
      }
      collapsedHint={<span className="font-mono text-[10px] text-slate-400">{adsb.count}/{adsb.total}</span>}
    >
      <div className="flex items-center justify-between px-3 py-1.5 text-[9px] text-slate-500">
        {offline ? (
          <span className="flex items-center gap-1.5 text-red-400"><WifiOff size={11} /> Sem sinal ADS-B — reconectando…</span>
        ) : live ? (
          <span className="truncate">fonte <b className="text-amber-300/90">{adsb.source}</b> · há {adsb.ageSec}s · raio 55 km</span>
        ) : (
          <span className="animate-pulse text-amber-300/80">conectando aos receptores ADS-B…</span>
        )}
        <kbd className="ml-1 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[8px] text-slate-400">U</kbd>
      </div>

      <div className="max-h-[38vh] space-y-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
        {adsb.flights.length === 0 && live && (
          <div className="px-2 py-3 text-center text-[10px] text-slate-500">Nenhuma aeronave transmitindo perto de você agora.</div>
        )}
        {adsb.flights.map((f) => {
          const isSel = selectedHex === f.hex;
          const isFol = followHex === f.hex;
          const hasRoute = isSel && routeInfo && (routeInfo.origin || routeInfo.destination);
          return (
            <div
              key={f.hex}
              onClick={() => onSelect?.(f.hex)}
              title={onSelect ? "Clique para selecionar este voo" : undefined}
              className={`rounded-md border px-2 py-1 transition-colors ${onSelect ? "cursor-pointer" : ""} ${
                isFol
                  ? "border-sky-400 bg-sky-500/20 ring-1 ring-sky-400"
                  : isSel
                    ? "border-amber-400/80 bg-amber-500/10 ring-1 ring-amber-400/50"
                    : f.emergency
                      ? "animate-pulse border-red-500/70 bg-red-950/40"
                      : "border-slate-800/80 bg-slate-900/50 hover:border-amber-600/50 hover:bg-slate-900"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {f.emergency ? (
                    <TriangleAlert size={12} className="shrink-0 text-red-400" />
                  ) : f.onGround ? (
                    <CircleParking size={12} className="shrink-0 text-slate-500" />
                  ) : (
                    <Plane size={12} className={`shrink-0 ${isFol ? "text-sky-300" : "text-amber-300"}`} />
                  )}
                  <span className={`truncate font-display text-[13px] font-bold tracking-wide ${f.emergency ? "text-red-300" : "text-slate-100"}`}>{f.cs}</span>
                  <span className="shrink-0 rounded bg-slate-800 px-1 py-px font-mono text-[8px] text-slate-400">{f.type}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-amber-200">
                  {f.onGround ? "SOLO" : f.altFt >= 18000 ? `FL${Math.round(f.altFt / 100)}` : `${fmt(f.altFt)} ft`}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between font-mono text-[9px] text-slate-500">
                <span className="flex items-center gap-1">
                  <VsIcon fpm={f.onGround ? 0 : f.vsFpm} />
                  {f.onGround ? "no pátio/pista" : `${f.vsFpm > 0 ? "+" : ""}${fmt(f.vsFpm)} fpm`}
                  {f.reg && <span className="ml-1 truncate text-slate-600">· {f.reg}</span>}
                </span>
                <span className="shrink-0">{f.gsKt} kt · <b className="text-slate-400">{f.distKm.toFixed(1)} km</b></span>
              </div>
              {f.emergency && (
                <div className="mt-0.5 font-mono text-[8px] font-bold tracking-widest text-red-400">⚠ SQUAWK DE EMERGÊNCIA — TRÁFEGO PRIORITÁRIO</div>
              )}

              {/* opções para o voo selecionado: escolher se quer acompanhar em 3D e/ou ouvir o ATC */}
              {isSel && (
                <div className="mt-1.5 space-y-1.5 border-t border-slate-700/60 pt-1.5" onClick={(e) => e.stopPropagation()}>
                  {hasRoute && (
                    <div className="flex items-center justify-between rounded bg-slate-900/90 px-2 py-1 font-mono text-[9px] text-slate-200">
                      <span className="flex items-center gap-1 font-bold text-amber-300">
                        {routeInfo.origin?.iata || routeInfo.origin?.icao || "—"}
                        <ArrowRight size={10} className="text-slate-500" />
                        {routeInfo.destination?.iata || routeInfo.destination?.icao || "—"}
                      </span>
                      <span className="truncate pl-2 text-[8px] text-slate-400">
                        {routeInfo.origin?.city || ""}{routeInfo.origin?.city && routeInfo.destination?.city ? " → " : ""}{routeInfo.destination?.city || ""}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-1">
                    {onFollow3d && (
                      <button
                        onClick={() => onFollow3d(f.hex)}
                        className={`flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[9px] font-bold transition ${
                          isFol ? "bg-sky-500 text-slate-950 hover:bg-sky-400" : "bg-sky-900/70 text-sky-200 hover:bg-sky-800"
                        }`}
                      >
                        <Video size={11} /> {isFol ? "VOLTAR (ESC)" : "ACOMPANHAR 3D"}
                      </button>
                    )}
                    {onListenAtc && (
                      <button
                        onClick={() => onListenAtc(f.hex)}
                        className="flex items-center justify-center gap-1 rounded bg-emerald-900/70 px-1.5 py-1 text-[9px] font-bold text-emerald-200 transition hover:bg-emerald-800"
                      >
                        <Headphones size={11} /> OUVIR ATC
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-800/70 px-3 py-1 text-center text-[8px] tracking-[0.18em] text-slate-600">
        CLIQUE NO VOO: ESCOLHA ACOMPANHAR 3D OU OUVIR ATC
      </div>
    </PanelShell>
  );
}
