"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Plane, Radio, Crosshair, Users, Sun, Sunset, Moon, Gamepad2, Gauge, Shield, Zap, Flame, Rocket, Bomb, LogOut,
  Keyboard, X, TowerControl, Map as MapIcon, Search, PanelBottomClose, PanelBottomOpen, Radar, Tag, Cpu, MapPin, Mountain, Pause, Play, Volume2, VolumeX, Eraser, Eye, EyeOff, RotateCcw, Maximize, Minimize,
  Clock, Wind, Thermometer, RadioTower, CloudSun, Navigation, SatelliteDish, Headphones, SunMedium, Share2, Check, Copy, AlertCircle, Settings,
} from "lucide-react";
import { AIRCRAFT, byId } from "@/sim/aircraft";
import { AIRPORTS, airportByIcao, runwayEnds, runwayOf, windFor, tzOf, type Airport } from "@/sim/airports";
import { MAP_PROVIDERS, tileOf, type MapProvider } from "@/sim/geo";
import type { Snapshot, FlightEngine, RemoteState } from "@/sim/engine";
import {
  bestRunway, fetchWeather, fmtLocal, phaseOfDay, solarPosition, startEpoch, windComponents, windKt, windText, type Weather,
} from "@/sim/weather";
import ClockWeather from "@/components/ClockWeather";
import LiveTrafficPanel from "@/components/LiveTrafficPanel";
import LiveAtcPanel, { type AtcTarget } from "@/components/LiveAtcPanel";
import { AtcAudioMixer } from "@/lib/atc/audioMixer";
import { classifyPhase } from "@/lib/atc/phase";
import type { AtcAircraft } from "@/lib/atc/types";
import type { Quality } from "@/sim/terrain";
import Cockpit from "@/components/Cockpit";
import RadioPanel, { DEFAULT_VOICE, type RadioMsg, type VoiceSettings } from "@/components/RadioPanel";
import RadarView from "@/components/RadarView";
import MapView from "@/components/MapView";
import AdsbFollowOverlay from "@/components/AdsbFollowOverlay";
import VirtualControls from "@/components/VirtualControls";
import OptionsPanel, { DEFAULT_OPTIONS, type SimOptions } from "@/components/OptionsPanel";
import type { FlightRouteInfo } from "@/app/api/adsb/route/route";
import { RadioAudioProcessor } from "@/lib/radio/RadioAudioProcessor";
import { RadioCommunicationManager } from "@/lib/radio/RadioCommunicationManager";
import { cleanForTts } from "@/lib/radio/text";
import { icaoSpeech } from "@/lib/atc/phonetic";
import { profileForMessage } from "@/lib/radio/profiles";
import { DEFAULT_RADIO_FX, normalizeRadioFx } from "@/lib/radio/settings";

const HangarPreview = dynamic(() => import("@/components/HangarPreview"), { ssr: false });

interface FlightConfig {
  aircraftId: string;
  callsign: string;
  timeMode: "real" | "custom";
  startHour: number;
  liveWeather: boolean;
  glare: number;
  rudderCoupled: boolean;
  /** local de nascimento: pátio (padrão) ou pista */
  spawnLocation: "apron" | "runway";
  /** abrir a simulação em tela cheia (padrão) */
  startFullscreen: boolean;
  arcade: boolean;
  playerId: string;
  icao: string;
  runway: string;
  mapProvider: MapProvider;
  quality: Quality;
}

const norm = (s: string) => s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ============================= MINIATURA DE SATÉLITE =============================
function AirportThumb({ ap }: { ap: Airport }) {
  const z = 13;
  const t = tileOf(ap.lat, ap.lon, z);
  const bx = t.fx < 0.5 ? t.x - 1 : t.x, by = t.fy < 0.5 ? t.y - 1 : t.y;
  const px = ((t.x - bx + t.fx) / 2) * 100, py = ((t.y - by + t.fy) / 2) * 100;
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
        {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" className="h-full w-full object-cover" src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${by + dy}/${bx + dx}`} />
        ))}
      </div>
      <div className="pointer-events-none absolute" style={{ left: `${px}%`, top: `${py}%` }}>
        <div className="-translate-x-1/2 -translate-y-1/2">
          <div className="h-10 w-10 animate-ping rounded-full border-2 border-amber-300/70" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8">
        <div className="font-display text-lg font-bold tracking-wider text-white">{ap.flag} {ap.icao} {ap.iata && <span className="text-slate-300">/ {ap.iata}</span>}</div>
        <div className="text-[10px] text-slate-300">{ap.lat.toFixed(4)}°, {ap.lon.toFixed(4)}° · elev. {ap.elevFt.toLocaleString("pt-BR")} ft</div>
      </div>
    </div>
  );
}

// ============================= HANGAR =============================
function Hangar({ onStart }: { onStart: (c: FlightConfig) => void }) {
  const [sel, setSel] = useState("f16");
  const [callsign, setCallsign] = useState("");
  const [timeMode, setTimeMode] = useState<"real" | "custom">("real");
  const [startHour, setStartHour] = useState(8);
  const [liveWx, setLiveWx] = useState(true);
  const [hwx, setHwx] = useState<Weather | null>(null);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [arcade, setArcade] = useState(false);
  const [icao, setIcao] = useState("SBRJ");
  const [runway, setRunway] = useState(airportByIcao("SBRJ").active);
  const [provider, setProvider] = useState<MapProvider>("esri");
  const [quality, setQuality] = useState<Quality>("medium");
  const [glare, setGlare] = useState(0.5);
  const [rudderCoupled, setRudderCoupled] = useState(false);
  const [spawnLocation, setSpawnLocation] = useState<"apron" | "runway">("apron");
  const [startFullscreen, setStartFullscreen] = useState(true);
  const [query, setQuery] = useState("");
  const [google, setGoogle] = useState(false);
  const [online, setOnline] = useState<{ id: string; callsign: string; aircraft: string; airport: string }[]>([]);
  const spec = byId(sel);
  const ap = airportByIcao(icao);

  useEffect(() => {
    let cancel = false;
    setHwx(null);
    fetchWeather(ap.lat, ap.lon, 8000).then((w) => {
      if (!cancel) setHwx(w);
    });
    return () => {
      cancel = true;
    };
  }, [ap.lat, ap.lon]);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("sbvs-prefs") ?? "null");
      if (p) {
        if (p.sel) setSel(p.sel);
        if (p.icao) setIcao(p.icao);
        if (p.runway) setRunway(p.runway);
        if (p.provider) setProvider(p.provider);
        if (p.quality) setQuality(p.quality);
        if (p.timeMode) setTimeMode(p.timeMode);
        if (typeof p.startHour === "number") setStartHour(p.startHour);
        if (typeof p.liveWx === "boolean") setLiveWx(p.liveWx);
        if (typeof p.glare === "number") setGlare(Math.min(1, Math.max(0, p.glare)));
        if (p.spawnLocation === "runway" || p.spawnLocation === "apron") setSpawnLocation(p.spawnLocation);
        if (typeof p.startFullscreen === "boolean") setStartFullscreen(p.startFullscreen);
        if (typeof p.rudderCoupled === "boolean") setRudderCoupled(p.rudderCoupled);
        if (typeof p.arcade === "boolean") setArcade(p.arcade);
      }
    } catch {
      /* ignore */
    }
    setCallsign(localStorage.getItem("sbvs-callsign") || `FALCÃO ${Math.floor(10 + Math.random() * 89)}`);
    fetch("/api/tiles/config").then((r) => r.json()).then((j) => setGoogle(Boolean(j.google))).catch(() => undefined);
    const poll = async () => {
      try {
        const r = await fetch("/api/players");
        const j = await r.json();
        setOnline(j.players ?? []);
      } catch {
        /* offline */
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  const pickAirport = (a: Airport) => {
    setIcao(a.icao);
    setRunway(a.active);
  };

  const start = () => {
    const cs = callsign.trim().toUpperCase() || "PILOTO 01";
    localStorage.setItem("sbvs-callsign", cs);
    // A tela cheia é pedida AGORA (dentro do gesto do usuário), ao iniciar a simulação —
    // o hangar em si permanece em janela normal.
    if (startFullscreen && !document.fullscreenElement) {
      try {
        void document.documentElement.requestFullscreen().catch(() => undefined);
      } catch {
        /* navegador sem suporte/negação: segue em janela */
      }
    }
    const mp = provider === "google" && !google ? "esri" : provider;
    localStorage.setItem("sbvs-prefs", JSON.stringify({ sel, icao, runway, provider: mp, quality, timeMode, startHour, liveWx, glare, rudderCoupled, spawnLocation, startFullscreen, arcade }));
    onStart({ aircraftId: sel, callsign: cs, timeMode, startHour, liveWeather: liveWx, glare, rudderCoupled, spawnLocation, startFullscreen, arcade, playerId: crypto.randomUUID(), icao, runway: runwayEnds(ap).includes(runway) ? runway : ap.active, mapProvider: mp, quality });
  };

  const filtered = AIRPORTS.filter((a) => norm(`${a.icao} ${a.iata} ${a.name} ${a.city} ${a.country}`).includes(norm(query)));
  void tick;
  const tz = tzOf(ap);
  const epoch = startEpoch(tz, timeMode, startHour);
  const sunP = solarPosition(new Date(epoch), ap.lat, ap.lon);
  const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const wc = hwx ? windComponents(hwx, runway) : null;

  const statBar = (label: string, v: number, icon: React.ReactNode, color: string) => (
    <div className="flex items-center gap-2">
      <span className="flex w-28 items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-400">{icon}{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="w-7 text-right font-mono text-[10px] text-slate-500">{v}</span>
    </div>
  );
  const seg = <T extends string>(value: T, set: (v: T) => void, items: [T, string, React.ReactNode][], cols = 3) => (
    <div className={`mt-1 grid gap-1.5 ${cols === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {items.map(([v, label, icon]) => (
        <button key={v} onClick={() => set(v)} className={`flex flex-col items-center gap-1 rounded border py-2 text-[9px] font-bold tracking-wide transition ${value === v ? "border-amber-400/70 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"}`}>
          {icon}{label}
        </button>
      ))}
    </div>
  );

  // Compartilhamento com cadeia de fallbacks — nunca falha em silêncio.
  // 1) navigator.share (celular/folha nativa) 2) navigator.clipboard (contexto seguro)
  // 3) document.execCommand (contexto inseguro / HTTP) 4) painel manual com o link
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied" | "error">("idle");
  const [shareUrl, setShareUrl] = useState("");
  const share = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = "Vale do Sol SBVS — Simulador de Voo Tático";
    const text = "Voa comigo? Simulador de voo multiplayer com ATC ao vivo e tráfego aéreo real.";
    if (!url) return;

    // 1) folha de compartilhamento nativa
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        setShareState("shared");
        return;
      }
    } catch (err) {
      // AbortError = usuário fechou a folha: não é falha, apenas encerra
      if (err instanceof Error && err.name === "AbortError") return;
    }

    // 2) API de área de transferência (só em contexto seguro)
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        return;
      }
    } catch {
      /* segue para o fallback */
    }

    // 3) execCommand — funciona em HTTP inseguro e navegadores antigos
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, url.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setShareState("copied");
        return;
      }
    } catch {
      /* segue para o fallback final */
    }

    // 4) falhou tudo: mostra o link para cópia manual (nunca silencioso)
    setShareUrl(url);
    setShareState("error");
  }, []);

  useEffect(() => {
    if (shareState === "idle" || shareState === "error") return;
    const t = setTimeout(() => setShareState("idle"), 2200);
    return () => clearTimeout(t);
  }, [shareState]);

  return (
    <div className="hangar-bg relative min-h-screen overflow-hidden text-slate-200">
      <header className="relative z-10 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-amber-400/15 ring-1 ring-amber-400/50">
            <TowerControl size={18} className="text-amber-300" />
          </div>
          <div>
            <div className="font-display text-lg font-bold leading-5 tracking-[0.2em] text-slate-100">SBVS <span className="text-amber-300">FLIGHT</span> OPS</div>
            <div className="text-[10px] tracking-[0.3em] text-slate-500">SIMULADOR TÁTICO · AEROPORTOS REAIS · MULTIPLAYER</div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="hidden items-center gap-1.5 md:flex">
            <Radio size={13} className="text-emerald-400" /> ATIS {ap.icao}: pista {runway}
            {mounted ? ` · vento ${hwx ? windText(hwx) : windFor(runway)}${hwx ? ` · QNH ${Math.round(hwx.pressureHpa)} · ${hwx.summary}` : ""}` : " · …"}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1 text-sky-300"><Users size={13} /> {online.length} piloto{online.length === 1 ? "" : "s"} online</span>
          <button
            onClick={() => void share()}
            title={shareState === "idle" ? "Compartilhar o link do jogo" : shareState === "error" ? "Toque para tentar novamente" : "Link copiado / compartilhado"}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold transition ${
              shareState === "error"
                ? "border-amber-500 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                : shareState === "idle"
                  ? "border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:border-emerald-500 hover:bg-emerald-900/60"
                  : "border-emerald-400 bg-emerald-500/20 text-emerald-200"
            }`}
          >
            {shareState === "idle" ? <Share2 size={13} /> : shareState === "error" ? <AlertCircle size={13} /> : <Check size={13} />}
            {shareState === "idle"
              ? "Compartilhar"
              : shareState === "shared"
                ? "Compartilhado"
                : shareState === "error"
                  ? "Copiar manualmente"
                  : "Link copiado"}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-[1400px] gap-4 px-4 py-5 lg:grid-cols-[270px_1fr_330px]">
        {/* aeronaves */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-xs font-bold tracking-[0.25em] text-slate-400"><Plane size={14} className="text-amber-300" /> HANGAR — {AIRCRAFT.length} AERONAVES</h2>
          <div className="space-y-2">
            {AIRCRAFT.map((a) => (
              <button key={a.id} onClick={() => setSel(a.id)} className={`group w-full rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${sel === a.id ? "border-amber-400/70 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.12)]" : "border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900"}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-display text-sm font-bold tracking-wide ${sel === a.id ? "text-amber-300" : "text-slate-200"}`}>{a.short}</span>
                  <span className="text-[9px] tracking-widest text-slate-500">{a.nation}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">{a.name}</div>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-500">
                  <span className={`rounded px-1.5 py-0.5 ${a.loadout.cannon > 0 ? "bg-red-950/70 text-red-300" : "bg-sky-950/70 text-sky-300"}`}>{a.role}</span>
                  <span>{a.length.toFixed(1)} m · {a.topKmh.toLocaleString("pt-BR")} km/h</span>
                </div>
              </button>
            ))}
          </div>
          {online.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <h3 className="mb-2 flex items-center gap-2 font-display text-xs font-bold tracking-[0.25em] text-slate-400"><Users size={13} className="text-sky-400" /> VOANDO AGORA</h3>
              <div className="space-y-1">
                {online.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded bg-slate-900/70 px-2 py-1 text-[11px]">
                    <span className="font-display font-bold text-sky-300">✈ {p.callsign}</span>
                    <span className="font-mono text-[9px] text-slate-500">{byId(p.aircraft).short} · {p.airport}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* aeronave + aeroporto */}
        <section className="space-y-4">
          <div className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
            <div className="relative h-[300px] shrink-0 md:h-[340px]">
              <HangarPreview aircraftId={sel} />
              <div className="pointer-events-none absolute left-4 top-3">
                <div className="font-display text-4xl font-black tracking-wide text-slate-100/95 md:text-5xl">{spec.short}</div>
                <div className="mt-0.5 text-xs tracking-[0.25em] text-amber-300/90">{spec.role.toUpperCase()}</div>
              </div>
              <div className="pointer-events-none absolute bottom-3 right-4 text-right font-mono text-[10px] leading-4 text-slate-500">
                <div>COMPR. {spec.length} m · ENV. {spec.span} m</div>
                <div>TETO {spec.ceilingFt.toLocaleString("pt-BR")} FT · VMAX {spec.topKmh.toLocaleString("pt-BR")} KM/H</div>
                <div>LIMITE {spec.gLimit}G · INTEGRIDADE {spec.hp}</div>
              </div>
            </div>
            <div className="border-t border-slate-800 p-4">
              <p className="text-[13px] leading-relaxed text-slate-300">{spec.desc}</p>
              <div className="mt-3 grid gap-1.5 md:grid-cols-2 md:gap-x-6">
                {statBar("VELOCIDADE", spec.stats.speed, <Zap size={11} />, "#38bdf8")}
                {statBar("AGILIDADE", spec.stats.agility, <Gauge size={11} />, "#4ade80")}
                {statBar("PODER DE FOGO", spec.stats.firepower, <Crosshair size={11} />, "#f87171")}
                {statBar("RESISTÊNCIA", spec.stats.armor, <Shield size={11} />, "#fbbf24")}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800/70 pt-3">
                <span className="text-[9px] font-bold tracking-[0.25em] text-slate-500">ARMAMENTO:</span>
                {spec.loadout.cannon > 0 ? (
                  <>
                    <span className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300"><Crosshair size={11} className="text-amber-300" /> Canhão {spec.loadout.cannon}</span>
                    <span className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300"><Bomb size={11} className="text-orange-300" /> MK-82 ×{spec.loadout.bomb}</span>
                    <span className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300"><Flame size={11} className="text-red-400" /> IR ×{spec.loadout.missileIR}</span>
                    <span className="flex items-center gap-1 rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300"><Rocket size={11} className="text-sky-300" /> Rádio ×{spec.loadout.missileRAD}</span>
                  </>
                ) : (
                  <span className="rounded bg-sky-950/70 px-2 py-1 text-[10px] text-sky-300">Aeronave civil — voo por procedimentos, sem armamento</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-display text-xs font-bold tracking-[0.25em] text-slate-400"><MapPin size={14} className="text-amber-300" /> AEROPORTOS REAIS — {AIRPORTS.length}</h2>
              <div className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2 py-1">
                <Search size={12} className="text-slate-500" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ICAO, cidade, país…" className="w-40 bg-transparent text-[11px] text-slate-200 outline-none placeholder:text-slate-600" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_250px]">
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {filtered.map((a) => (
                  <button key={a.icao} onClick={() => pickAirport(a)} className={`w-full rounded-lg border px-3 py-2 text-left transition ${icao === a.icao ? "border-amber-400/70 bg-amber-400/10" : "border-slate-800 bg-slate-900/50 hover:border-slate-600"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-display text-sm font-bold tracking-wider ${icao === a.icao ? "text-amber-300" : "text-slate-200"}`}>{a.flag} {a.icao}</span>
                      <span className="flex items-center gap-1.5">
                        {a.military && <span className="rounded bg-red-950/70 px-1.5 py-0.5 text-[8px] font-bold tracking-widest text-red-300">MILITAR</span>}
                        <span className="font-mono text-[9px] text-slate-500">{a.elevFt.toLocaleString("pt-BR")} ft</span>
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-slate-400">{a.name} — {a.city}, {a.country}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-slate-500">{a.runways.map((r) => `${r.le.ident}/${r.he.ident} ${Math.round(r.lengthM)}m`).join(" · ")}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <AirportThumb ap={ap} />
                <p className="text-[11px] leading-relaxed text-slate-300">{ap.blurb}</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                  {[["TWR", ap.freqs.twr], ["GND", ap.freqs.gnd], ["APP", ap.freqs.app], ["ATIS", ap.freqs.atis]].map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded bg-slate-900/80 px-1.5 py-1"><span className="text-emerald-400">{k}</span><span className="text-slate-300">{v}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* plano de voo */}
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="mb-3 font-display text-xs font-bold tracking-[0.25em] text-slate-400">PLANO DE VOO</h3>
            <label className="text-[10px] font-bold tracking-widest text-slate-500">INDICATIVO (CALLSIGN)</label>
            <input value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase().slice(0, 16))} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-display text-sm font-bold tracking-widest text-amber-300 outline-none focus:border-amber-400" placeholder="FALCÃO 01" />

            <label className="mt-3 block text-[10px] font-bold tracking-widest text-slate-500">PISTA EM USO — {ap.icao}</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {runwayEnds(ap).map((r) => {
                const rr = runwayOf(ap, r);
                return (
                  <button key={r} onClick={() => setRunway(r)} title={rr ? `${Math.round(rr.lengthM)} × ${Math.round(rr.widthM)} m` : ""} className={`rounded border px-2.5 py-1 font-mono text-[11px] font-bold transition ${runway === r ? "border-amber-400/70 bg-amber-400/15 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"}`}>
                    {r}
                  </button>
                );
              })}
            </div>

            <label className="mt-3 block text-[10px] font-bold tracking-widest text-slate-500">TEXTURA DO SOLO / MAPA</label>
            <div className="mt-1 space-y-1.5">
              {MAP_PROVIDERS.map((p) => {
                const disabled = p.needsKey && !google;
                return (
                  <button key={p.id} disabled={disabled} onClick={() => setProvider(p.id)} className={`flex w-full items-start gap-2 rounded border px-2.5 py-2 text-left transition ${provider === p.id && !disabled ? "border-amber-400/70 bg-amber-400/10" : "border-slate-700 bg-slate-900"} ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-slate-500"}`}>
                    {p.id === "procedural" ? <Mountain size={14} className="mt-0.5 text-emerald-400" /> : <MapIcon size={14} className="mt-0.5 text-sky-400" />}
                    <span>
                      <span className={`block text-[11px] font-bold ${provider === p.id && !disabled ? "text-amber-300" : "text-slate-300"}`}>{p.name}</span>
                      <span className="block text-[9px] leading-3 text-slate-500">{disabled ? "Configure GOOGLE_MAPS_API_KEY no servidor para habilitar" : p.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="mt-3 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-500"><Clock size={11} /> RELÓGIO DA SIMULAÇÃO — {ap.icao}</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {([["real", "Tempo real"], ["custom", "Ajustar hora"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setTimeMode(v)} className={`rounded border py-1.5 text-[10px] font-bold tracking-wide transition ${timeMode === v ? "border-amber-400/70 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"}`}>{l}</button>
              ))}
            </div>
            <div className="mt-1.5 flex items-center justify-between rounded border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
              {mounted ? (
                <>
                  <span className="flex items-center gap-1.5 font-mono text-sm font-bold text-slate-100">
                    {sunP.elev > 8 ? <Sun size={14} className="text-amber-300" /> : sunP.elev > -6 ? <Sunset size={14} className="text-orange-300" /> : <Moon size={14} className="text-sky-300" />}
                    {fmtLocal(tz, epoch, false)}
                  </span>
                  <span className="text-right text-[9px] leading-3 text-slate-400">{phaseOfDay(sunP.elev)}<br />Sol a {sunP.elev.toFixed(0)}° · hora local</span>
                </>
              ) : (
                <span className="font-mono text-sm font-bold text-slate-500">--:--</span>
              )}
            </div>
            {timeMode === "custom" && (
              <div className="mt-1.5">
                <input type="range" min={0} max={23.75} step={0.25} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} className="w-full accent-amber-400" />
                <div className="flex items-center justify-between gap-1 text-[9px]">
                  {([["Madrugada", 3], ["Amanhecer", 6], ["Manhã", 9], ["Meio-dia", 12], ["Pôr do sol", 17.5], ["Noite", 22]] as const).map(([l, h]) => (
                    <button key={l} onClick={() => setStartHour(h)} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700">{l}</button>
                  ))}
                </div>
                <div className="mt-0.5 text-center font-mono text-[10px] text-amber-300">{hh(startHour)} (hora local)</div>
              </div>
            )}

            <label className="mt-3 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-slate-500"><CloudSun size={11} /> CLIMA</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {([[true, "Ao vivo (real)"], [false, "Céu limpo"]] as const).map(([v, l]) => (
                <button key={l} onClick={() => setLiveWx(v)} className={`rounded border py-1.5 text-[10px] font-bold tracking-wide transition ${liveWx === v ? "border-sky-400/70 bg-sky-400/10 text-sky-300" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"}`}>{l}</button>
              ))}
            </div>
            <div className="mt-1.5 rounded border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-[10px] text-slate-300">
              {!hwx ? <span className="text-slate-500">Consultando meteorologia de {ap.icao}…</span> : (
                <>
                  <div className="flex items-center justify-between">
                    <b className="text-sky-300">{hwx.summary}</b>
                    <span className={`rounded px-1.5 text-[8px] font-bold ${hwx.source === "live" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>{hwx.source === "live" ? "AO VIVO" : "PADRÃO"}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[9px]">
                    <span className="flex items-center gap-1"><Thermometer size={10} className="text-orange-300" />{hwx.tempC.toFixed(0)}°C · {Math.round(hwx.cloud * 100)}% nuv.</span>
                    <span className="flex items-center gap-1"><Wind size={10} className="text-emerald-300" />{windText(hwx)}{hwx.gustMs - hwx.windMs > 3 ? ` G${Math.round(hwx.gustMs * 1.94)}` : ""}</span>
                    <span className="flex items-center gap-1"><Eye size={10} className="text-slate-400" />{hwx.visM >= 10000 ? ">10" : (hwx.visM / 1000).toFixed(1)} km</span>
                    <span>QNH {Math.round(hwx.pressureHpa)} · {windKt(hwx)} kt</span>
                  </div>
                  {wc && (
                    <div className="mt-1.5 flex items-center justify-between border-t border-slate-800 pt-1.5 text-[9px]">
                      <span className="flex items-center gap-1">
                        <Navigation size={10} className="text-amber-300" /> Pista {runway}: <b className={wc.head >= 0 ? "text-emerald-300" : "text-red-300"}>{wc.head >= 0 ? "proa" : "cauda"} {Math.abs(Math.round(wc.head))} kt</b> · cruzado {Math.abs(Math.round(wc.cross))} kt
                      </span>
                      <button onClick={() => setRunway(bestRunway(runwayEnds(ap), hwx))} className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300 hover:bg-amber-500/30">PISTA IDEAL</button>
                    </div>
                  )}
                </>
              )}
            </div>

            <label className="mt-3 block text-[10px] font-bold tracking-widest text-slate-500">QUALIDADE GRÁFICA</label>
            {seg(quality, setQuality, [["low", "Baixa", <Cpu key="l" size={14} />], ["medium", "Média", <Cpu key="m" size={14} />], ["high", "Alta + Bloom", <Cpu key="h" size={14} />]])}

            <label className="mt-3 flex items-center justify-between text-[10px] font-bold tracking-widest text-slate-500">
              <span className="flex items-center gap-1.5"><SunMedium size={11} /> BRILHO DO SOL (GLARE)</span>
              <span className="font-mono text-sun-300 text-amber-300">{Math.round(glare * 100)}%</span>
            </label>
            <input
              type="range" min={0} max={1} step={0.05} value={glare}
              onChange={(e) => setGlare(Number(e.target.value))}
              className="mt-1 w-full accent-amber-400"
              title="Ajuste o intensidade do sol e do brilho na cena (0% = sem brilho)"
            />
            <div className="flex justify-between text-[8px] text-slate-600">
              <span>suave / nublado</span><span>padrão</span><span>forte</span>
            </div>

            <label className="mt-3 block text-[10px] font-bold tracking-widest text-slate-500">LOCAL DE INÍCIO</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {([["apron", "Pátio (padrão)"], ["runway", "Pista"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setSpawnLocation(v)}
                  className={`rounded border py-2 text-[10px] font-bold tracking-wide transition ${spawnLocation === v ? "border-amber-400/70 bg-amber-400/10 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[9px] leading-3.5 text-slate-500">
              No multiplayer cada piloto nasce numa vaga espaçada — sem sobrepor outra aeronave (pista: fila no eixo; pátio: malha ao lado das aeronaves estacionadas).
            </p>

            <button
              onClick={() => {
                const next = !startFullscreen;
                setStartFullscreen(next);
                // grava imediatamente: a preferência vale já nesta sessão
                try {
                  const p = JSON.parse(localStorage.getItem("sbvs-prefs") ?? "{}");
                  localStorage.setItem("sbvs-prefs", JSON.stringify({ ...p, startFullscreen: next }));
                } catch {
                  /* storage bloqueado */
                }
              }}
              className={`mt-3 flex w-full items-center justify-between rounded border px-3 py-2 transition ${startFullscreen ? "border-sky-500/60 bg-sky-500/10" : "border-slate-700 bg-slate-900"}`}>
              <span className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-slate-300">
                <Maximize size={15} className={startFullscreen ? "text-sky-400" : "text-slate-500"} /> ABRIR EM TELA CHEIA
              </span>
              <span className={`relative h-5 w-9 rounded-full transition ${startFullscreen ? "bg-sky-500" : "bg-slate-700"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${startFullscreen ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
            <p className="mt-1 text-[9px] leading-3.5 text-slate-500">
              {startFullscreen
                ? "A simulação abre em tela cheia no instante do DECOLAR; o hangar permanece em janela. Alt+Enter/F11 alternam durante o voo."
                : "A simulação abrirá em janela normal. Alt+Enter ou F11 alternam a qualquer momento."}
            </p>

            <button onClick={() => setRudderCoupled(!rudderCoupled)} className={`mt-3 flex w-full items-center justify-between rounded border px-3 py-2 transition ${rudderCoupled ? "border-sky-500/60 bg-sky-500/10" : "border-emerald-500/50 bg-emerald-500/5"}`}>
              <span className="flex flex-col text-left">
                <span className="text-[11px] font-bold tracking-wide text-slate-300">LEME E AILERONS</span>
                <span className="text-[9px] text-slate-500">{rudderCoupled ? "Acoplados (curva coordenada automática)" : "Independentes (leme em < > ou Q E · TAB alterna)"}</span>
              </span>
              <span className={`rounded px-2 py-0.5 font-mono text-[9px] font-bold ${rudderCoupled ? "bg-sky-500/25 text-sky-300" : "bg-emerald-500/25 text-emerald-300"}`}>
                {rudderCoupled ? "JUNTOS" : "SEPARADOS"}
              </span>
            </button>

            <button onClick={() => setArcade(!arcade)} className={`mt-2.5 flex w-full items-center justify-between rounded border px-3 py-2.5 transition ${arcade ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-700 bg-slate-900"}`}>
              <span className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-slate-300"><Gamepad2 size={15} className={arcade ? "text-emerald-400" : "text-slate-500"} /> MODO ARCADE</span>
              <span className={`relative h-5 w-9 rounded-full transition ${arcade ? "bg-emerald-500" : "bg-slate-700"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${arcade ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-500">{arcade ? "Física assistida, pousos tolerantes e auto-nivelamento." : "Física realista: estol, fator G, peso de combustível/armas, amortecedores e torre cobrando autorizações."}</p>

            <button onClick={start} className="mt-4 w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-3.5 font-display text-base font-black tracking-[0.25em] text-slate-950 shadow-[0_8px_30px_rgba(245,158,11,0.35)] transition hover:brightness-110 active:scale-[0.98]">
              ▶ DECOLAR DE {ap.icao}
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-[10px] leading-4 text-slate-500">
            🎙 Rádio por <b className="text-slate-300">voz em pt-BR</b> (segure <kbd className="rounded bg-slate-800 px-1">V</kbd>) com resposta falada da torre — velocidade da voz ajustável — ou chat (<kbd className="rounded bg-slate-800 px-1">T</kbd>). Jogadores no mesmo aeroporto se veem, conversam e combatem em tempo real.
          </div>
          <Link
            href="/aircraft"
            className="mt-3 flex items-center justify-center gap-2 rounded border border-sky-800 bg-sky-950/40 py-2.5 text-[10px] font-bold tracking-widest text-sky-300 transition hover:border-sky-500 hover:bg-sky-950/70"
          >
            <Plane size={13} /> CATÁLOGO DE AERONAVES (GLB) — INSPECTOR
          </Link>
        </section>
      </main>

      {/* fallback manual de compartilhamento (quando o navegador bloqueia cópia automática) */}
      {shareState === "error" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setShareState("idle")}>
          <div className="w-full max-w-md rounded-xl border border-amber-700/60 bg-slate-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0">
                <div className="font-display text-sm font-bold tracking-wide text-amber-200">Copie o link para convidar</div>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">
                  Seu navegador bloqueou a cópia automática (acesso por HTTP, sem conexão segura). Selecione o endereço abaixo e copie manualmente.
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                readOnly
                value={shareUrl}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-emerald-300 outline-none"
              />
              <button
                onClick={() => {
                  const el = document.querySelector<HTMLInputElement>("input[readonly]");
                  el?.select();
                }}
                className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500"
              >
                Selecionar
              </button>
            </div>
            <button onClick={() => setShareState("idle")}
              className="mt-3 w-full rounded bg-slate-800 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================= SIMULAÇÃO =============================
function SimView({ config, onExit }: { config: FlightConfig; onExit: () => void }) {
  const ap = airportByIcao(config.icao);
  const spec = byId(config.aircraftId);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FlightEngine | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState({ text: "Iniciando sistemas…", pct: 0 });
  const [ready, setReady] = useState(false);
  const [msgs, setMsgs] = useState<RadioMsg[]>([]);
  const [online, setOnline] = useState<{ id: string; callsign: string; aircraft: string }[]>([]);
  const [ttsOn, setTtsOn] = useState(true);
  const [voice, setVoiceState] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [panelHidden, setPanelHidden] = useState(false);
  const [radioOpen, setRadioOpen] = useState(true);
  const [radarOpen, setRadarOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [atcOpen, setAtcOpen] = useState(false);
  const [atcTarget, setAtcTarget] = useState<AtcTarget | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<FlightRouteInfo | null>(null);
  const mixerRef = useRef<AtcAudioMixer | null>(null);
  const getMixer = () => (mixerRef.current ??= new AtcAudioMixer());
  const selectedHexRef = useRef<string | null>(null);
  const dismissedAtcRef = useRef(new Set<string>());
  const lastAutoIcaoRef = useRef("");
  // ---------------- opções de interface (persistidas) ----------------
  const setOptions = useCallback((o: SimOptions) => {
    setOptionsState(o);
    try {
      localStorage.setItem("sbvs-options", JSON.stringify(o));
    } catch {
      /* storage bloqueado */
    }
  }, []);
  const setGlare = useCallback((v: number) => {
    const g = Math.min(1, Math.max(0, v));
    setGlareState(g);
    engineRef.current?.setGlare(g);
    try {
      localStorage.setItem("sbvs-glare", String(g));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      const o = JSON.parse(localStorage.getItem("sbvs-options") ?? "null") as Partial<SimOptions> | null;
      let next: SimOptions = { ...DEFAULT_OPTIONS, ...(o ?? {}) };
      // em telas de toque, os manches já vêm habilitados
      if (!o) next = { ...next, showVirtualControls: window.matchMedia("(pointer: coarse)").matches };
      setOptionsState(next);
      const g = Number(localStorage.getItem("sbvs-glare"));
      if (Number.isFinite(g) && localStorage.getItem("sbvs-glare")) {
        setGlareState(g);
        engineRef.current?.setGlare(g);
      }
    } catch {
      /* noop */
    }
  }, []);

  const [labels3d, setLabels3dState] = useState(true);
  const [labelsRadar, setLabelsRadar] = useState(true);
  const [labelsMap, setLabelsMap] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [adsbPanelOpen, setAdsbPanelOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptionsState] = useState<SimOptions>(DEFAULT_OPTIONS);
  const [glare, setGlareState] = useState(config.glare ?? 0.5);
  /** barra superior: hover/toque no topo revela quando o auto-recolher está ativo */
  const [toolbarHover, setToolbarHover] = useState(false);
  /** Visibilidade geral das janelas flutuantes (VIEWS) e da barra superior (tecla *) */
  const [windowsVisible, setWindowsVisible] = useState(true);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  /** incrementado pelo RESET para remontar as janelas nas posições de fábrica */
  const [windowGen, setWindowGen] = useState(0);
  /** estado real da tela cheia do navegador (sincronizado com o evento fullscreenchange) */
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const h = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* navegador bloqueou a tela cheia */
    }
  }, []);

  const windowsVisibleRef = useRef(true);
  const toolbarVisibleRef = useRef(true);
  const ttsRef = useRef(ttsOn);
  ttsRef.current = ttsOn;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const labelsRef = useRef({ labels3d, labelsRadar, labelsMap });
  labelsRef.current = { labels3d, labelsRadar, labelsMap };
  const snapRef = useRef<Snapshot | null>(null);
  const [radioStatus, setRadioStatus] = useState<string>("idle");
  const radioMgrRef = useRef<RadioCommunicationManager | null>(null);
  const radioProcRef = useRef<RadioAudioProcessor | null>(null);
  /** Um único AudioContext/processador por sessão de voo (PRD §8). */
  const getRadioManager = useCallback(() => {
    if (!radioMgrRef.current) {
      const proc = new RadioAudioProcessor();
      radioProcRef.current = proc;
      const mgr = new RadioCommunicationManager({ processor: proc });
      mgr.onStatus = (st) => setRadioStatus((prev) => (prev === st ? prev : st));
      mgr.configure(voiceRef.current.radioFx ?? DEFAULT_RADIO_FX);
      radioMgrRef.current = mgr;
      // gancho de diagnóstico (não expõe segredos: só estado e contadores)
      (window as unknown as { __radio?: unknown }).__radio = { manager: mgr, processor: proc };
    }
    return radioMgrRef.current;
  }, []);
  const lastMsg = useRef(0);
  const lastEvent = useRef(0);
  const pendingHits = useRef<{ target: string; dmg: number; weapon: string }[]>([]);
  const localId = useRef(-1);
  const onlineKey = useRef("");

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("sbvs-voice") ?? "null");
      if (v) setVoiceState({ ...DEFAULT_VOICE, ...v, radioFx: normalizeRadioFx(v?.radioFx) });
      const ui = JSON.parse(localStorage.getItem("sbvs-ui") ?? "null");
      if (ui) {
        setPanelHidden(Boolean(ui.panelHidden));
        setRadarOpen(Boolean(ui.radarOpen));
        setMapOpen(Boolean(ui.mapOpen));
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("sbvs-ui", JSON.stringify({ panelHidden, radarOpen, mapOpen }));
  }, [panelHidden, radarOpen, mapOpen]);
  const setVoice = (v: VoiceSettings) => {
    const normalized: VoiceSettings = { ...v, radioFx: normalizeRadioFx(v.radioFx) };
    setVoiceState(normalized);
    localStorage.setItem("sbvs-voice", JSON.stringify(normalized));
    voiceRef.current = normalized;
    // efeito imediato: ligar/desligar processamento e/ou trocar perfil
    radioMgrRef.current?.configure(normalized.radioFx);
    if (!normalized.radioFx.enabled) setRadioStatus("disabled");
  };
  const setLabels3d = useCallback((v: boolean) => {
    setLabels3dState(v);
    engineRef.current?.setLabels(v);
  }, []);

  const pausedRef = useRef(false);
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    engineRef.current?.setPaused(next);
  }, []);

  const mutedRef2 = useRef(false);
  const toggleMute = useCallback(() => {
    const next = !mutedRef2.current;
    mutedRef2.current = next;
    setMuted(next);
    engineRef.current?.setMuted(next);
    mixerRef.current?.setMuted(next);
    radioProcRef.current?.setMuted(next);
    if (next) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    }
  }, []);

  /**
   * VIEWS — comutador de visibilidade das janelas flutuantes.
   * Ao ocultar, o estado aberto/fechado de cada janela é preservado e apenas a
   * renderização é suspensa; ao tornar visível, tudo volta exatamente como estava.
   */
  const toggleViews = useCallback(() => {
    const next = !windowsVisibleRef.current;
    windowsVisibleRef.current = next;
    setWindowsVisible(next);
    if (!next) mixerRef.current?.stop();
  }, []);

  /** Comuta a barra superior de botões (tecla *). */
  const toggleToolbar = useCallback(() => {
    const next = !toolbarVisibleRef.current;
    toolbarVisibleRef.current = next;
    setToolbarVisible(next);
  }, []);

  /** RESET — devolve todas as janelas às posições/estado originais de fábrica. */
  const resetWindows = useCallback(() => {
    for (const key of ["radio", "adsb", "liveatc", "clock", "lights", "radar", "map"]) {
      try {
        localStorage.removeItem(`sbvs-panel:${key}`);
      } catch {
        /* storage bloqueado */
      }
    }
    try {
      localStorage.removeItem("sbvs-radar");
      localStorage.removeItem("sbvs-map");
    } catch {
      /* noop */
    }
    setRadioOpen(true);
    setRadarOpen(false);
    setMapOpen(false);
    setAtcOpen(false);
    setAdsbPanelOpen(true);
    setShowHelp(false);
    setPanelHidden(false);
    windowsVisibleRef.current = true;
    setWindowsVisible(true);
    setWindowGen((g) => g + 1); // remonta todas as janelas com as posições padrão
    engineRef.current?.setFollowAdsb(null);
    engineRef.current?.setSelectedAdsb(null);
    selectedHexRef.current = null;
    setSelectedHex(null);
    setRouteInfo(null);
    mixerRef.current?.stop();
  }, []);

  /**
   * Caminho ORIGINAL do TTS — inalterado quando os efeitos de rádio estão desligados.
   * É também o fallback único quando o processamento falha (nunca duplica a fala).
   */
  const speakNative = useCallback((text: string, isAtc: boolean) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const v = voiceRef.current;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.rate = v.rate;
    // canal "simAtcGain": volume do TTS controlado pelo mixer do Live ATC (ducking incluso)
    const muteK = mutedRef.current ? 0 : 1;
    u.volume = Math.min(1, Math.max(0, v.volume * (mixerRef.current?.simEffectiveVolume() ?? 1) * muteK));
    u.pitch = isAtc ? v.pitch : Math.min(2, v.pitch * 1.2);
    const voices = window.speechSynthesis.getVoices();
    const pts = voices.filter((x) => x.lang.toLowerCase().startsWith("pt"));
    const chosen = voices.find((x) => x.voiceURI === v.voiceURI) ?? pts[0] ?? null;
    u.voice = isAtc ? chosen : pts.find((x) => x !== chosen) ?? chosen;
    if (v.squelch) {
      u.onstart = () => engineRef.current?.squelch();
      u.onend = () => engineRef.current?.squelch();
    }
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback((m: RadioMsg) => {
    if (!ttsRef.current || typeof window === "undefined") return;
    const v = voiceRef.current;
    const isAtc = m.kind === "atc";
    if (!isAtc && !(v.pilots && m.kind === "pilot" && m.playerId !== config.playerId)) return;
    const clean = cleanForTts(m.text);
    // dialeto aeronáutico ICAO: indicativo e números falados por extenso
    const spoken = icaoSpeech(clean);
    const text = isAtc ? spoken : `${icaoSpeech(m.callsign)}: ${spoken}`;

    // Radio Communication Effects: OFF (padrão) → exatamente o comportamento anterior
    const fx = v.radioFx ?? DEFAULT_RADIO_FX;
    if (fx.enabled) {
      const mgr = getRadioManager();
      mgr.configure(fx);
      const gain = Math.min(1, Math.max(0, v.volume * (mixerRef.current?.simEffectiveVolume() ?? 1)));
      void mgr
        .transmit({
          text,
          profile: profileForMessage(isAtc ? "atc" : "pilot", fx.profile),
          gain,
          staticIntensity: fx.staticIntensity,
          interference: fx.interference,
          pttSound: fx.pttSound,
          endSound: fx.endSound,
          label: m.callsign,
        })
        .then((res) => {
          if (!res.ok && res.reason !== "disabled" && res.reason !== "aborted") {
            // fallback único para o TTS nativo (não duplica: o processado não tocou)
            radioProcRef.current?.stopAll();
            speakNative(text, isAtc);
          }
        })
        .catch(() => speakNative(text, isAtc));
      return;
    }
    speakNative(text, isAtc);
  }, [config.playerId, speakNative]);

  const addMsgs = useCallback((incoming: RadioMsg[], silent = false) => {
    setMsgs((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !ids.has(m.id));
      if (!fresh.length) return prev;
      for (const m of fresh) {
        if (!silent) speak(m);
        const eng = engineRef.current;
        const t = norm(m.text);
        if (eng && m.kind === "atc" && t.includes(norm(config.callsign))) {
          if (t.includes("AUTORIZADO DECOLAR")) eng.setClearance({ takeoff: true, airspace: true });
          if (t.includes("AUTORIZADO TAXI")) eng.setClearance({ taxi: true });
          if (t.includes("AUTORIZADO POUSO") || t.includes("TOQUE E ARREMETIDA")) eng.setClearance({ landing: true, airspace: true });
          if (["INGRESSO NA ZONA", "IDENTIFICADO RADAR", "CONTATO RADAR", "PASSAGEM BAIXA", "MAYDAY"].some((k) => t.includes(k))) eng.setClearance({ airspace: true });
        }
      }
      return [...prev, ...fresh].slice(-300);
    });
  }, [config.callsign, speak]);

  const addLocal = useCallback((callsign: string, text: string, kind: "pilot" | "atc" | "system") => {
    addMsgs([{ id: localId.current--, callsign, channel: kind === "system" ? "local" : "tower", text, kind }]);
  }, [addMsgs]);

  const sendChat = useCallback(async (channel: string, text: string, kind: "pilot" | "system" = "pilot") => {
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: config.playerId, callsign: config.callsign, channel, text, kind,
          airport: ap.icao, runway: config.runway, noAtc: snapRef.current ? !snapRef.current.towerAlive : false,
          wind: snapRef.current?.wx.wind, qnh: snapRef.current?.wx.qnh,
        }),
      });
      const j = await r.json();
      if (Array.isArray(j.messages)) addMsgs(j.messages as RadioMsg[]);
    } catch {
      addLocal("SISTEMA", "Falha de comunicação com o servidor de rádio.", "system");
    }
  }, [config.playerId, config.callsign, config.runway, ap.icao, addMsgs, addLocal]);

  // motor 3D
  useEffect(() => {
    let engine: FlightEngine | null = null;
    let cancelled = false;
    (async () => {
      const { FlightEngine } = await import("@/sim/engine");
      if (cancelled || !containerRef.current) return;
      engine = new FlightEngine(containerRef.current, {
        aircraftId: config.aircraftId, callsign: config.callsign, airport: ap, runway: config.runway,
        mapProvider: config.mapProvider, quality: config.quality, timeMode: config.timeMode, startHour: config.startHour,
        liveWeather: config.liveWeather, glare: config.glare, rudderCoupled: config.rudderCoupled, spawnLocation: config.spawnLocation, arcade: config.arcade,
        onSnapshot: (s) => {
          snapRef.current = s;
          setSnap(s);
        },
        onRadio: addLocal,
        onLoading: (text, pct) => setLoading({ text, pct }),
        onReady: () => {
          setReady(true);
          engineRef.current?.setLabels(labelsRef.current.labels3d);
        },
        onRemoteHit: (target, dmg, weapon) => pendingHits.current.push({ target, dmg, weapon }),
        onKilled: (by, cause) => {
          void sendChat("global", by ? `💥 ${config.callsign} (${spec.short}) foi abatido por ${by} em ${ap.icao}` : `💥 ${config.callsign}: ${cause} (${ap.icao})`, "system");
        },
      });
      engineRef.current = engine;
      (window as unknown as { __sim?: FlightEngine }).__sim = engine; // gancho de depuração/testes
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
      mixerRef.current?.dispose();
      mixerRef.current = null;
      radioMgrRef.current?.dispose();
      radioMgrRef.current = null;
      radioProcRef.current = null;
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sincronização multiplayer (estado + danos + rádio)
  useEffect(() => {
    let busy = false, first = true;
    const tick = async () => {
      const eng = engineRef.current;
      if (busy || !eng || !eng.ready) return;
      busy = true;
      const hits = pendingHits.current.splice(0, 60);
      try {
        const r = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: config.playerId, callsign: config.callsign, aircraft: config.aircraftId, airport: ap.icao,
            state: eng.getNetState(), hits, lastEvent: lastEvent.current, lastMsg: lastMsg.current,
          }),
        });
        const j = await r.json();
        const list = (j.players ?? []) as RemoteState[];
        eng.updateRemotes(list, config.playerId);
        const key = list.map((p) => p.id + p.callsign).join("|");
        if (key !== onlineKey.current) {
          onlineKey.current = key;
          setOnline(list.map((p) => ({ id: p.id, callsign: p.callsign, aircraft: p.aircraft })));
        }
        for (const ev of (j.events ?? []) as { id: number; dmg: number; fromCallsign: string; weapon: string }[]) {
          lastEvent.current = Math.max(lastEvent.current, ev.id);
          eng.applyExternalDamage(ev.dmg, ev.fromCallsign, ev.weapon);
        }
        const ms = (j.messages ?? []) as RadioMsg[];
        if (ms.length) {
          lastMsg.current = Math.max(lastMsg.current, ...ms.map((m) => m.id));
          addMsgs(ms, first);
        }
        first = false;
      } catch {
        pendingHits.current.unshift(...hits);
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, 300);
    return () => {
      clearInterval(t);
      fetch(`/api/players?id=${config.playerId}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
  }, [config.playerId, config.callsign, config.aircraftId, ap.icao, addMsgs]);

  // ---------------- Live ATC: detecção automática de aeroporto + seleção de voo ----------------
  const closeAtc = useCallback(() => {
    setAtcOpen(false);
    const t = atcTarget;
    if (t && t.source === "auto") dismissedAtcRef.current.add(t.airport.icao);
    mixerRef.current?.stop();
  }, [atcTarget]);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    const detect = async () => {
      const eng = engineRef.current;
      if (!eng || selectedHexRef.current) return;
      const [lat, lon] = eng.frame.toLatLon(eng.pos.x, eng.pos.z);
      try {
        const r = await fetch(`/api/atc/airports/nearest?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
        const j = await r.json();
        if (cancel || !j.airport || selectedHexRef.current) return;
        const s = snapRef.current;
        const phase = classifyPhase(
          { callsign: config.callsign, latitude: lat, longitude: lon, altitudeFt: s?.altFt, groundSpeedKts: s?.speedKt, verticalFpm: s?.vsFpm, onGround: s?.onGround },
          j.airport
        );
        if (lastAutoIcaoRef.current !== j.airport.icao) {
          lastAutoIcaoRef.current = j.airport.icao;
          if (!dismissedAtcRef.current.has(j.airport.icao)) setAtcOpen(true);
        }
        setAtcTarget({ airport: j.airport, distanceNm: j.distanceNm ?? 0, phase, source: "auto" });
      } catch {
        /* a detecção nunca bloqueia o simulador */
      }
    };
    void detect();
    const t = setInterval(detect, 5000);
    return () => { cancel = true; clearInterval(t); };
  }, [ready, config.callsign]);

  const fetchRouteFor = useCallback(async (hex: string, callsign: string) => {
    try {
      const r = await fetch(`/api/adsb/route?callsign=${encodeURIComponent(callsign)}&hex=${encodeURIComponent(hex)}`);
      if (!r.ok) return;
      const data = (await r.json()) as FlightRouteInfo;
      if (selectedHexRef.current === hex) setRouteInfo(data);
    } catch {
      /* rota opcional */
    }
  }, []);

  const onListenAtc = useCallback(async (hex: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    const f = eng.live.getFlight(hex);
    if (!f) return;
    selectedHexRef.current = hex;
    setSelectedHex(hex);
    eng.setSelectedAdsb(hex);
    setAtcOpen(true);
    try {
      const qs = new URLSearchParams({
        callsign: f.cs, icao24: hex, lat: String(f.lat), lon: String(f.lon),
        altFt: String(f.altFt), gsKt: String(f.gsKt), vsFpm: String(f.vsFpm), onGround: f.onGround ? "1" : "0",
      });
      const j = await (await fetch(`/api/atc/recommend?${qs}`)).json();
      if (selectedHexRef.current !== hex || !j.airport) return;
      const aircraft: AtcAircraft = {
        callsign: f.cs, icao24: hex, latitude: f.lat, longitude: f.lon, altitudeFt: f.altFt,
        groundSpeedKts: f.gsKt, verticalFpm: f.vsFpm, onGround: f.onGround, heading: f.trackDeg,
      };
      setAtcTarget({
        airport: j.airport, distanceNm: j.distanceNm ?? 0, phase: j.phase ?? "enroute",
        aircraft, route: j.route, source: "flight", autoPlay: true,
      });
    } catch {
      /* sem rede: mantém apenas o TTS do simulador */
    }
  }, []);

  /** Seleciona um voo ADS-B para destacar no radar/mapa e mostrar ações (Ouvir ATC / Acompanhar 3D) */
  const onSelectFlight = useCallback((hex: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (selectedHexRef.current === hex) {
      selectedHexRef.current = null;
      setSelectedHex(null);
      setRouteInfo(null);
      eng.setSelectedAdsb(null);
      eng.setFollowAdsb(null);
      lastAutoIcaoRef.current = "";
      return;
    }
    const f = eng.live.getFlight(hex);
    if (!f) return;
    selectedHexRef.current = hex;
    setSelectedHex(hex);
    setRouteInfo(null);
    eng.setSelectedAdsb(hex);
    void fetchRouteFor(hex, f.cs);
  }, [fetchRouteFor]);

  const onFollow3d = useCallback((hex: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.followHex === hex) {
      eng.setFollowAdsb(null);
      return;
    }
    const f = eng.live.getFlight(hex);
    if (!f) return;
    selectedHexRef.current = hex;
    setSelectedHex(hex);
    eng.setFollowAdsb(hex);
    if (!routeInfo || routeInfo.callsign !== f.cs) void fetchRouteFor(hex, f.cs);
  }, [fetchRouteFor, routeInfo]);

  const deselectFlight = useCallback(() => {
    selectedHexRef.current = null;
    setSelectedHex(null);
    setRouteInfo(null);
    engineRef.current?.setSelectedAdsb(null);
    engineRef.current?.setFollowAdsb(null);
    lastAutoIcaoRef.current = "";
    mixerRef.current?.stop();
    setAtcTarget((prev) => (prev ? { ...prev, aircraft: undefined, route: undefined, source: "auto", autoPlay: false } : prev));
  }, []);

  /** barra auto-recolhível: revela perto do topo e esconde ao afastar */
  useEffect(() => {
    if (!options.autoHideToolbar) {
      setToolbarHover(false);
      return;
    }
    const check = (y: number) => setToolbarHover(y <= 96);
    const onMove = (e: PointerEvent) => check(e.clientY);
    const onDown = (e: PointerEvent) => check(e.clientY);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [options.autoHideToolbar]);

  // atalhos de interface: R = Janela do Radar · M = Nova Janela de Mapa · L = Rótulos · J = Rádio · Y = Live ATC
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "KeyH") setShowHelp((v) => !v);
      if (e.code === "KeyP") setPanelHidden((v) => !v);
      if (e.code === "KeyR") setRadarOpen((v) => !v);
      if (e.code === "KeyM") setMapOpen((v) => !v);
      if (e.code === "KeyJ") setRadioOpen((v) => !v);
      if (e.code === "KeyY") setAtcOpen((v) => !v);
      if (e.code === "KeyL") {
        const on = !(labelsRef.current.labels3d || labelsRef.current.labelsRadar || labelsRef.current.labelsMap);
        setLabels3d(on);
        setLabelsRadar(on);
        setLabelsMap(on);
      }
      if (e.code === "Pause" || e.code === "ScrollLock") { e.preventDefault(); togglePause(); }
      if (e.code === "Backquote") { e.preventDefault(); toggleMute(); }
      if (e.code === "Delete") { e.preventDefault(); toggleViews(); }
      if (e.code === "NumpadMultiply" || e.key === "*" || e.code === "Multiply") { e.preventDefault(); toggleToolbar(); }
      if (e.code === "End") { e.preventDefault(); resetWindows(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setLabels3d, togglePause, toggleMute, toggleViews, toggleToolbar, resetWindows, toggleFullscreen]);

  const testVoice = () => {
    window.speechSynthesis?.cancel();
    speak({ id: 0, callsign: `TORRE ${ap.atcName.toUpperCase()}`, channel: "tower", kind: "atc", text: `${config.callsign}, Torre ${ap.atcName}, teste de voz. Vento ${windFor(config.runway)}, pista ${config.runway}, autorizado decolar.` });
  };

  const topBtn = (active: boolean) => `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1.5 text-[10px] font-bold tracking-widest transition ${active ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-950/80 text-slate-300 hover:border-emerald-500 hover:text-emerald-300"}`;

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0" />

      {!ready && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950">
          <div className="radar-loader mb-5 h-16 w-16 rounded-full border-2 border-emerald-500/30" />
          <div className="font-display text-xl font-bold tracking-[0.3em] text-emerald-300">{ap.flag} {ap.icao} — {ap.city.toUpperCase()}</div>
          <div className="mt-1 text-xs text-slate-500">{spec.name} · pista {config.runway} · {MAP_PROVIDERS.find((p) => p.id === config.mapProvider)?.name}</div>
          <div className="mt-5 h-1.5 w-80 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-300" style={{ width: `${Math.round(loading.pct * 100)}%` }} />
          </div>
          <div className="mt-2 font-mono text-[11px] text-slate-400">{loading.text}</div>
          <button onClick={onExit} className="mt-6 text-[10px] tracking-widest text-slate-600 hover:text-slate-300">CANCELAR</button>
        </div>
      )}

      {paused && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
          <div className="rounded-xl border-2 border-amber-400/70 bg-slate-950/90 px-12 py-8 text-center shadow-2xl">
            <Pause size={40} className="mx-auto text-amber-300" />
            <div className="mt-2 font-display text-4xl font-black tracking-[0.3em] text-amber-300">PAUSADO</div>
            <div className="mt-1 font-mono text-xs text-slate-400">Simulação congelada · tecla Pause ou botão RETOMAR</div>
          </div>
        </div>
      )}

      {snap && (
        <Cockpit
          snap={snap}
          spec={spec}
          panelHidden={panelHidden}
          onToggleSpoiler={() => engineRef.current?.toggleSpoiler()}
          onToggleRudder={() => engineRef.current?.toggleRudderCoupled()}
          onRespawn={() => engineRef.current?.respawn()}
        />
      )}

      {snap?.followed && (
        <AdsbFollowOverlay
          flight={snap.followed}
          route={routeInfo}
          onExit={() => engineRef.current?.setFollowAdsb(null)}
        />
      )}

      {windowsVisible && radioOpen && (
      <RadioPanel
        key={`radio-${windowGen}`}
        messages={msgs} onSend={(c, t) => void sendChat(c, t)} ttsOn={ttsOn} setTtsOn={setTtsOn}
        voice={voice} setVoice={setVoice} onTestVoice={testVoice} online={online} myId={config.playerId} freqs={ap.freqs}
        open={radioOpen} setOpen={setRadioOpen}
        radioStatus={radioStatus}
        onPtt={(o) => engineRef.current?.pttClick(o)}
      />
      )}

      {windowsVisible && snap && ready && snap.adsb.on && adsbPanelOpen && (
        <LiveTrafficPanel
          key={`adsb-${windowGen}`}
          adsb={snap.adsb}
          onSelect={onSelectFlight}
          onListenAtc={(h) => void onListenAtc(h)}
          onFollow3d={onFollow3d}
          selectedHex={selectedHex}
          followHex={snap.followHex}
          routeInfo={routeInfo}
        />
      )}

      {windowsVisible && ready && atcOpen && atcTarget && (
        <LiveAtcPanel key={`atc-${windowGen}`} target={atcTarget} mixer={getMixer()} onClose={closeAtc} onDeselect={selectedHex ? deselectFlight : undefined} />
      )}

      {windowsVisible && snap && ready && (
        <ClockWeather
          key={`clock-${windowGen}`}
          snap={snap} tz={tzOf(ap)}
          onShift={(h) => engineRef.current?.shiftTime(h)}
          onSync={() => engineRef.current?.syncRealTime()}
          onScale={(n) => engineRef.current?.setTimeScale(n)}
        />
      )}

      <RadarView key={`radar-${windowGen}`} engineRef={engineRef} open={windowsVisible && radarOpen && ready} onClose={() => setRadarOpen(false)} labels={labelsRadar} setLabels={setLabelsRadar} />

      <MapView
        key={`map-${windowGen}`}
        engineRef={engineRef}
        open={windowsVisible && mapOpen && ready}
        onClose={() => setMapOpen(false)}
        labels={labelsMap}
        setLabels={setLabelsMap}
        onSelectFlight={onSelectFlight}
      />

      {toolbarVisible ? (
      <div
        className={`absolute left-1/2 top-2 z-40 flex w-max max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 transition-transform duration-300 ${
          options.autoHideToolbar && !toolbarHover ? "-translate-y-[130%] opacity-0" : "translate-y-0 opacity-100"
        }`}
        onPointerEnter={() => setToolbarHover(true)}
        onPointerDown={() => setToolbarHover(true)}
      >
        <button onClick={onExit} className={`${topBtn(false)} hover:!border-red-500 hover:!text-red-400`}><LogOut size={12} /> HANGAR</button>
        <div className="shrink-0 whitespace-nowrap rounded border border-slate-700 bg-slate-950/80 px-3 py-1.5 font-display text-[11px] font-bold tracking-widest text-amber-300">
          {config.callsign} <span className="text-slate-500">·</span> {ap.icao} RWY {config.runway}
        </div>
        <button onClick={() => setPanelHidden((v) => !v)} className={topBtn(!panelHidden)} title="Mostrar/ocultar painel (P)">
          {panelHidden ? <PanelBottomOpen size={12} /> : <PanelBottomClose size={12} />} PAINEL (P)
        </button>
        <button onClick={togglePause} className={topBtn(paused)} title="Pausar / retomar a simulação (tecla Pause)">
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? "RETOMAR" : "PAUSA"}
        </button>
        <button onClick={toggleMute} className={topBtn(muted)} title="Mutar todos os áudios do simulador (tecla `)">
          {muted ? <VolumeX size={12} /> : <Volume2 size={12} />} {muted ? "MUDO" : "SOM"}
        </button>
        <button onClick={toggleViews} className={topBtn(windowsVisible)} title="Comutar visibilidade das janelas (tecla Delete)">
          {windowsVisible ? <Eye size={12} /> : <EyeOff size={12} />} VIEWS
        </button>
        <button onClick={() => void toggleFullscreen()} className={topBtn(isFullscreen)} title="Alternar tela cheia (Alt+Enter)">
          {isFullscreen ? <Minimize size={12} /> : <Maximize size={12} />} {isFullscreen ? "SAIR DA TELA CHEIA" : "TELA CHEIA"}
        </button>
        <button onClick={resetWindows} className={topBtn(false)} title="Restaurar posições e estado original das janelas (tecla End)">
          <RotateCcw size={12} /> RESET
        </button>
        <button onClick={() => setRadarOpen((v) => !v)} className={topBtn(radarOpen)} title="Janela do Radar + Radar Meteorológico (R)"><Radar size={12} /> RADAR (R)</button>
        <button onClick={() => setMapOpen((v) => !v)} className={topBtn(mapOpen)} title="Janela do Mapa Real: Satélite / Ruas (M)"><MapIcon size={12} /> MAPA (M)</button>
        <button
          onClick={() => {
            if (!snap?.adsb?.on) engineRef.current?.toggleLiveTraffic();
            setAdsbPanelOpen((v) => !v);
          }}
          className={topBtn(!!snap?.adsb?.on && adsbPanelOpen)}
          title="Tráfego aéreo real via ADS-B, como no FlightRadar24 (U)"
        >
          <SatelliteDish size={12} /> ADS-B (U){snap?.adsb?.on && snap.adsb.status === "live" ? ` · ${snap.adsb.count}` : ""}
        </button>
        <button onClick={() => setAtcOpen((v) => !v)} className={topBtn(atcOpen)} title="ATC ao vivo do aeroporto (Broadcastify) — Y">
          <Headphones size={12} /> LIVE ATC (Y)
        </button>
        <button onClick={() => setRadioOpen((v) => !v)} className={topBtn(radioOpen)} title="Janela do rádio (J)"><RadioTower size={12} /> RÁDIO (J)</button>
        <button onClick={() => setLabels3d(!labels3d)} className={topBtn(labels3d)} title="Indicativos na tela (L alterna tela + radar)"><Tag size={12} /> RÓTULOS (L)</button>
        <button onClick={() => setOptionsOpen((v) => !v)} className={topBtn(optionsOpen)} title="Opções: hora, brilho, barra e controles virtuais">
          <Settings size={12} /> OPÇÕES
        </button>
        <button onClick={() => setShowHelp((v) => !v)} className={topBtn(showHelp)}><Keyboard size={12} /> AJUDA (H)</button>
      </div>
      ) : (
        <button
          onClick={toggleToolbar}
          title="Mostrar barra de botões (tecla *)"
          aria-label="Mostrar barra de botões"
          className="absolute left-1/2 top-2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded border border-slate-700 bg-slate-950/85 px-3 py-1.5 text-[10px] font-bold tracking-widest text-slate-400 backdrop-blur transition hover:border-emerald-500 hover:text-emerald-300"
        >
          <EyeOff size={12} /> MOSTRAR BARRA (*)
        </button>
      )}

      {toolbarVisible && options.autoHideToolbar && (
        <div
          className="absolute inset-x-0 top-0 z-30 h-10"
          onPointerEnter={() => setToolbarHover(true)}
          onPointerDown={() => setToolbarHover(true)}
          aria-hidden
        />
      )}

      {windowsVisible && showHelp && (
        <div className="absolute left-1/2 top-14 z-30 flex max-h-[calc(100vh-96px)] w-[600px] max-w-[94vw] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold tracking-[0.25em] text-amber-300">CARTÃO DE CONTROLES</h3>
            <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-slate-200"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-slate-300">
            {([
              ["W·↑ / S·↓", "Profundor: ↑ nariz p/ baixo · ↓ p/ cima (I inverte)"], ["A / D · ← / →", "Rolar esquerda / direita"],
              ["Q / E · < / >", "Leme independente (guinada)"], ["TAB", "Leme + ailerons: acoplados vs. separados"],
              ["SHIFT / CTRL", "Potência + / −"], ["G / F / B", "Trem · Flaps · Freio estacionário"],
              ["C", "Câmera: perseguição · cabine · torre · órbita · passagem"], ["Mouse + Roda (ext.)", "Arrastar gira câmera 360° · roda = zoom · 2× clique centraliza"],
              ["1 · 2 · 3 · 4", "Canhão · Bomba · Míssil IR · Míssil rádio"], ["ESPAÇO / X", "Disparar arma selecionada"],
              ["5 · 6 · 7 · 8", "Luzes: NAV · BEACON · STROBE · POUSO/TÁXI"], ["/ ou 9", "SPOILER — freio aerodinâmico"],
              ["P", "Mostrar / ocultar painel"], ["R", "Janela do Radar (+ camada meteorológica WX)"],
              ["M", "Janela do Mapa Real (Satélite / Ruas + zoom + ADS-B)"], ["L", "Indicativos na tela, no radar e no mapa"],
              ["[ / ]", "Alcance do radar"], ["V (segurar) / T", "Falar no rádio (voz pt-BR) / Chat"],
              ["J / Y / U", "Janela do rádio / Live ATC / Tráfego ADS-B"], ["O / I", "Controle aviônico por mouse / Inverter profundor"],
              ["Z / N (segurar)", "Flares (engana IR) / Chaff (engana radar)"], ["Backspace · CTRL parado", "Freios das rodas (pouso)"],
              ["- / = / 0", "Relógio −1h / +1h / hora real"], ["K", "Velocidade do relógio 1× · 60× · 600×"],
              ["ENTER", "Renascer após queda"], ["H", "Esta ajuda"],
              ["Clique num voo", "ADS-B: escolher Acompanhar 3D (ESC sai) ou Ouvir ATC"],
              ["Pause", "Pausar / retomar a simulação"],
              ["` (backquote)", "Mutar todos os áudios do simulador"],
              ["Alt+Enter", "Alternar TELA CHEIA (F11 do navegador também funciona)"],
              ["Delete", "VIEWS — comuta a visibilidade das janelas"],
              ["* (asterisco)", "Comuta a barra de botões superior"],
              ["End", "RESET — restaura posições e estado original das janelas"],
            ] as const).map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-1">
                <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">{k}</kbd>
                <span className="text-right text-slate-400">{d}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-slate-500">
            ✈ <b className="text-slate-300">Decolagem:</b> chame o Solo (táxi) e a Torre (decolagem), solte o freio (B), flaps 15° (F), potência máxima (SHIFT) e cabre (S) a ~{Math.round(spec.stallSpeed * 1.94 * 1.25)} kt.
            🎯 <b className="text-slate-300">Alvos hostis</b> a ~7 km à direita do eixo da pista. Tudo é destrutível — prédios, tanques, aeronaves e a própria torre (fogo amigo tira pontos!).
            🔧 Pare no pátio com freio aplicado para reabastecer, rearmar e reparar.
          </p>
          </div>
        </div>
      )}
      <OptionsPanel
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        snap={snap}
        glare={glare}
        setGlare={setGlare}
        options={options}
        setOptions={setOptions}
        onShift={(h) => engineRef.current?.shiftTime(h)}
        onSync={() => engineRef.current?.syncRealTime()}
        onScale={(n) => engineRef.current?.setTimeScale(n)}
      />

      {ready && !optionsOpen && (
        <VirtualControls
          engineRef={engineRef}
          snap={snap}
          spec={spec}
          settings={{ show: options.showVirtualControls, invertSides: options.invertHands, mode: options.controlMode }}
          paused={paused}
          onPause={togglePause}
          onCamera={() => engineRef.current?.cycleCamera?.()}
        />
      )}
    </div>
  );
}

// ============================= TELA CHEIA AUTOMÁTICA =============================
/**
 * Entra em tela cheia no primeiro gesto do usuário, em qualquer tela (hangar ou voo).
 * Os navegadores exigem um gesto (clique/toque/tecla) para `requestFullscreen()`,
 * portanto não é possível forçar durante o carregamento da página.
 */
function AutoFullscreen({ enabled }: { enabled: boolean }) {
  const done = useRef(false);
  const enter = useCallback(() => {
    if (done.current) return;
    if (document.fullscreenElement) {
      done.current = true;
      return;
    }
    done.current = true;
    void document.documentElement.requestFullscreen().catch(() => {
      done.current = false; // permite nova tentativa no próximo gesto
    });
  }, []);

  useEffect(() => {
    if (!enabled) return; // preferência desligada: não interfere em nada
    if (document.fullscreenElement) done.current = true;
    const opts = { capture: true, passive: true } as AddEventListenerOptions;
    // se o usuário sai da tela cheia (Esc/F11), a flag é liberada para que o
    // próximo gesto retorne a ela — mas sem reentrar imediatamente na saída.
    const onExit = () => { done.current = true; window.setTimeout(() => { done.current = false; }, 400); };
    const onChange = () => { if (!document.fullscreenElement) onExit(); };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("pointerdown", enter, opts);
    window.addEventListener("keydown", enter, { capture: true });
    window.addEventListener("touchstart", enter, opts);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("pointerdown", enter, { capture: true });
      window.removeEventListener("keydown", enter, { capture: true });
      window.removeEventListener("touchstart", enter, { capture: true });
    };
  }, [enter, enabled]);

  return null;
}

// ============================= RAIZ =============================
export default function Page() {
  const [config, setConfig] = useState<FlightConfig | null>(null);
  const [fsEnabled, setFsEnabled] = useState(true);

  // Alt+Enter / F11 funcionam em qualquer tela (hangar ou simulação)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Enter" && e.altKey) {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("sbvs-prefs") ?? "null");
      // padrão: ligado
      setFsEnabled(p && typeof p.startFullscreen === "boolean" ? p.startFullscreen : true);
    } catch {
      setFsEnabled(true);
    }
  }, [config]);
  return (
    <>
      {/* rede de segurança DENTRO da simulação (ex.: voltar de Esc/F11); o hangar nunca é forçado */}
      {config && <AutoFullscreen enabled={fsEnabled} />}
      {config ? <SimView config={config} onExit={() => setConfig(null)} /> : <Hangar onStart={setConfig} />}
    </>
  );
}