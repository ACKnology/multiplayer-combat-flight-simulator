"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Headphones, Play, Square, Pause, Volume2, VolumeX, Loader2,
  TriangleAlert, RefreshCw, Star, Plane, ArrowRight, AudioLines, RadioTower,
} from "lucide-react";
import PanelShell from "./PanelShell";
import type { AtcAirport, AtcAircraft, AtcConfig, AtcFeed, FeedType, FeedsResult, FlightPhase } from "@/lib/atc/types";
import { PHASE_LABEL } from "@/lib/atc/phase";
import { recommendFeed } from "@/lib/atc/feeds";
import type { AtcAudioMixer, AtcPlayState } from "@/lib/atc/audioMixer";

export interface AtcTarget {
  airport: AtcAirport;
  distanceNm: number;
  phase: FlightPhase;
  aircraft?: AtcAircraft;
  route?: { origin?: string; destination?: string };
  source: "auto" | "flight";
  autoPlay?: boolean;
}

const TYPE_LABEL: Record<FeedType, string> = {
  ground: "Solo", tower: "Torre", approach: "Aproximação", departure: "Saídas",
  center: "Centro", atis: "ATIS", other: "Outro",
};
const TYPE_COLOR: Record<FeedType, string> = {
  ground: "bg-lime-500/15 text-lime-300", tower: "bg-sky-500/15 text-sky-300",
  approach: "bg-violet-500/15 text-violet-300", departure: "bg-orange-500/15 text-orange-300",
  center: "bg-teal-500/15 text-teal-300", atis: "bg-slate-500/15 text-slate-400", other: "bg-slate-500/15 text-slate-400",
};

interface Props {
  target: AtcTarget;
  mixer: AtcAudioMixer;
  onClose: () => void;
  onDeselect?: () => void;
}

export default function LiveAtcPanel({ target, mixer, onClose, onDeselect }: Props) {
  const [feeds, setFeeds] = useState<AtcFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<{ reason?: string; message?: string } | null>(null);
  const [config, setConfig] = useState<AtcConfig | null>(null);
  const [retry, setRetry] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playState, setPlayState] = useState<AtcPlayState>("idle");
  const [stateDetail, setStateDetail] = useState("");
  const [activity, setActivity] = useState(false);
  const [liveVol, setLiveVol] = useState(mixer.liveVolume);
  const [simVol, setSimVol] = useState(mixer.simVolume);
  const [muteLive, setMuteLive] = useState(mixer.muteLive);
  const [muteSim, setMuteSim] = useState(mixer.muteSim);
  const [priority, setPriority] = useState(mixer.priority);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const initVol = useRef(false);
  const lastPlayedIcao = useRef("");

  const recommended = recommendFeed(target.phase, feeds);

  // eventos do mixer
  useEffect(() => {
    mixer.events = {
      onState: (s, d) => {
        setPlayState(s);
        setStateDetail(d ?? "");
        if (s === "idle" || s === "error") setPlayingId((cur) => (s === "idle" ? null : cur));
      },
      onActivity: setActivity,
    };
    return () => { mixer.events = {}; };
  }, [mixer]);

  const playFeed = useCallback((f: AtcFeed) => {
    mixer.play(f.streamUrl);
    setPlayingId(f.id);
    lastPlayedIcao.current = target.airport.icao;
  }, [mixer, target.airport.icao]);

  // carrega feeds do aeroporto (cache no servidor; sem chamada por clique repetido)
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setProblem(null);
    const refresh = retry > 0 ? "&refresh=1" : "";
    fetch(`/api/atc/feeds?icao=${target.airport.icao}${refresh}`)
      .then((r) => r.json())
      .then((j: FeedsResult) => {
        if (cancel) return;
        setFeeds(j.feeds ?? []);
        setConfig(j.config);
        if (j.config) {
          mixer.maxReconnect = j.config.maxReconnect;
          if (!initVol.current) {
            initVol.current = true;
            mixer.setLiveVolume(j.config.liveVolume);
            mixer.setSimVolume(j.config.simVolume);
            setLiveVol(j.config.liveVolume);
            setSimVol(j.config.simVolume);
          }
        }
        if (!j.feeds?.length) setProblem({ reason: j.reason, message: j.message ?? "ATC ao vivo indisponível para este aeroporto." });
        // troca de aeroporto encerra o stream anterior
        if (lastPlayedIcao.current && lastPlayedIcao.current !== target.airport.icao) mixer.stop();
        // seleção de voo (gesto do usuário) → toca o feed recomendado automaticamente
        if (target.autoPlay && j.feeds?.length) {
          const rec = recommendFeed(target.phase, j.feeds);
          if (rec) playFeed(rec);
        }
      })
      .catch(() => {
        if (!cancel) setProblem({ reason: "upstream-error", message: "Falha de rede ao consultar os feeds. O TTS do simulador continua funcionando." });
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.airport.icao, target.aircraft?.icao24 ?? "", retry]);

  // fechar o painel encerra o stream
  useEffect(() => () => mixer.stop(), [mixer]);

  const ap = target.airport;
  const playingFeed = feeds.find((f) => f.id === playingId) ?? null;
  const live = playState === "playing" && activity;
  const route = target.route ?? {};

  const volRow = (label: string, icon: React.ReactNode, vol: number, setVol: (n: number) => void, muted: boolean, setMuted: (b: boolean) => void, accent: string) => (
    <div className="flex items-center gap-2">
      <button
        onClick={() => { setMuted(!muted); }}
        title={muted ? "Reativar áudio" : "Silenciar"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition ${muted ? "border-red-500/60 bg-red-500/15 text-red-400" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"}`}
      >
        {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
      <span className="w-[86px] shrink-0 text-[8px] font-bold tracking-wider text-slate-400">{label}</span>
      <input
        type="range" min={0} max={1} step={0.02} value={vol}
        onChange={(e) => { const v = Number(e.target.value); setVol(v); }}
        onKeyDown={(e) => e.stopPropagation()}
        className={`h-1 min-w-0 flex-1 cursor-pointer ${accent}`}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[9px] text-slate-400">{Math.round(vol * 100)}%</span>
      {icon}
    </div>
  );

  return (
    <PanelShell
      title="LIVE ATC"
      icon={<Headphones size={14} />}
      accent="sky"
      width={282}
      storageKey="liveatc"
      defaultPos={{ x: 12, y: 128 }}
      closable
      onClose={onClose}
      badge={
        <>
          <span className={`ml-0.5 inline-block h-2 w-2 rounded-full ${live ? "animate-pulse bg-red-500" : playState === "playing" ? "bg-emerald-400" : "bg-slate-600"}`} />
          {live && <span className="font-mono text-[8px] font-bold tracking-widest text-red-400">AO VIVO</span>}
        </>
      }
      collapsedHint={target.aircraft ? <span className="font-mono text-[9px] text-amber-300">{target.aircraft.callsign}</span> : undefined}
    >
      {/* aeroporto detectado */}
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[15px] font-bold tracking-wide text-slate-100">
            {ap.city} — <span className="text-sky-300">{ap.icao}</span>
          </span>
          <span className="shrink-0 font-mono text-[9px] text-slate-400">{target.distanceNm.toFixed(1)} nm</span>
        </div>
        <div className="truncate text-[9px] text-slate-500">{ap.name} · {ap.country}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-sky-300">{PHASE_LABEL[target.phase].toUpperCase()}</span>
          {target.aircraft ? (
            <>
              <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-display text-[9px] font-bold text-amber-300">
                <Plane size={9} /> {target.aircraft.callsign}
              </span>
              <span className="flex items-center gap-1 font-mono text-[8px] text-slate-500">
                {route.origin ?? "—"} <ArrowRight size={8} /> {route.destination ?? "—"}
              </span>
              {onDeselect && (
                <button onClick={onDeselect} className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-slate-400 hover:text-slate-200">
                  SEGUIR MEU VOO
                </button>
              )}
            </>
          ) : (
            <span className="text-[8px] text-slate-600">detectado pela sua posição · clique num voo ADS-B para seguir o ATC dele</span>
          )}
        </div>
      </div>

      {/* player em reprodução */}
      {playingFeed && playState !== "idle" && (
        <div className="flex items-center gap-2 border-b border-slate-800/80 bg-slate-900/60 px-3 py-1.5">
          <button
            onClick={() => (playState === "paused" ? mixer.resume() : mixer.pause())}
            disabled={playState === "reconnecting" || playState === "connecting"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-sky-600 text-white transition hover:bg-sky-500 disabled:opacity-40"
            title={playState === "paused" ? "Retomar" : "Pausar"}
          >
            {playState === "paused" ? <Play size={11} /> : <Pause size={11} />}
          </button>
          <button onClick={() => mixer.stop()} className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-white transition hover:bg-red-600" title="Parar e encerrar o stream">
            <Square size={10} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[9px] font-bold text-slate-200">{playingFeed.name}</div>
            <div className={`truncate font-mono text-[8px] ${playState === "error" ? "text-red-400" : playState === "playing" ? "text-emerald-400" : "text-amber-300"}`}>
              {playState === "playing" ? (activity ? "● recebendo transmissão" : "no ar — silêncio no canal") :
               playState === "paused" ? "pausado" :
               playState === "error" ? stateDetail || "erro no stream" :
               stateDetail || "conectando…"}
            </div>
          </div>
          {playState === "playing" && (
            <div className="flex shrink-0 items-end gap-[2px]" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`w-[3px] rounded-sm ${activity ? "animate-pulse bg-emerald-400" : "bg-slate-700"}`}
                  style={{ height: `${6 + ((i * 5) % 9)}px`, animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* lista de feeds / estados */}
      <div className="max-h-[26vh] space-y-1 overflow-y-auto px-2 py-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 text-[10px] text-sky-300">
            <Loader2 size={14} className="animate-spin" /> Consultando feeds de {ap.icao}…
          </div>
        )}
        {!loading && problem && (
          <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-3 text-center">
            <TriangleAlert size={16} className="mx-auto text-amber-400" />
            <div className="mt-1.5 text-[10px] font-bold text-slate-200">ATC ao vivo indisponível para este aeroporto</div>
            <div className="mt-1 text-[9px] leading-4 text-slate-500">{problem.message}</div>
            <div className="mt-1 text-[8px] text-slate-600">O ATC do jogo (TTS) continua funcionando normalmente.</div>
            <button onClick={() => setRetry((n) => n + 1)}
              className="mt-2 inline-flex items-center gap-1.5 rounded border border-sky-700 bg-sky-950/60 px-2.5 py-1 text-[9px] font-bold tracking-wider text-sky-300 transition hover:bg-sky-900/60">
              <RefreshCw size={10} /> TENTAR NOVAMENTE
            </button>
          </div>
        )}
        {!loading && feeds.map((f) => {
          const isRec = recommended?.id === f.id;
          const isPlaying = playingId === f.id && playState !== "idle" && playState !== "error";
          return (
            <div key={f.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                isPlaying ? "border-emerald-500/60 bg-emerald-500/10" : isRec ? "border-sky-600/50 bg-sky-500/5" : "border-slate-800 bg-slate-900/50 hover:border-slate-600"}`}>
              <button
                onClick={() => (isPlaying ? mixer.stop() : playFeed(f))}
                title={isPlaying ? "Parar" : "Ouvir ao vivo"}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition ${isPlaying ? "bg-red-600 text-white hover:bg-red-500" : "bg-sky-600 text-white hover:bg-sky-500"}`}>
                {isPlaying ? <Square size={11} /> : <Play size={12} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-bold text-slate-200">{f.name}</span>
                  {isRec && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-400/20 px-1 py-px text-[7px] font-black tracking-wider text-amber-300">
                      <Star size={7} /> RECOMENDADO
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[8px] text-slate-500">
                  <span className={`rounded px-1 py-px font-sans font-bold ${TYPE_COLOR[f.type]}`}>{TYPE_LABEL[f.type]}</span>
                  {f.frequency && <span className="text-emerald-300/90">{f.frequency} MHz</span>}
                  {typeof f.listeners === "number" && <span>· {f.listeners} ouvintes</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* mixagem: ATC real × ATC do jogo */}
      <div className="space-y-1.5 border-t border-slate-800 bg-slate-900/50 px-3 py-2">
        {volRow("ATC REAL", <RadioTower size={11} className="shrink-0 text-sky-400" />, liveVol,
          (v) => { setLiveVol(v); mixer.setLiveVolume(v); }, muteLive, (m) => { setMuteLive(m); mixer.setMuteLive(m); }, "accent-sky-500")}
        {volRow("ATC DO JOGO", <AudioLines size={11} className="shrink-0 text-emerald-400" />, simVol,
          (v) => { setSimVol(v); mixer.setSimVolume(v); }, muteSim, (m) => { setMuteSim(m); mixer.setMuteSim(m); }, "accent-emerald-500")}
        <button onClick={() => { const p = !priority; setPriority(p); mixer.setPriority(p); }}
          className={`flex w-full items-center justify-between rounded border px-2 py-1 transition ${priority ? "border-amber-500/60 bg-amber-500/10" : "border-slate-700 bg-slate-900"}`}
          title="Reduz o volume do TTS enquanto o feed real estiver transmitindo">
          <span className="text-[8px] font-bold tracking-wider text-slate-300">PRIORIDADE ATC REAL (DUCKING DO TTS)</span>
          <span className={`relative h-3.5 w-7 rounded-full transition ${priority ? "bg-amber-500" : "bg-slate-700"}`}>
            <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${priority ? "left-[16px]" : "left-0.5"}`} />
          </span>
        </button>
        <div className="text-center text-[7px] tracking-[0.18em] text-slate-600">
          {config?.providerConfigured ? "FONTE BROADCASTIFY · CACHE NO SERVIDOR" : "CONFIGURE BROADCASTIFY_API_KEY NO SERVIDOR"}
        </div>
      </div>
    </PanelShell>
  );
}