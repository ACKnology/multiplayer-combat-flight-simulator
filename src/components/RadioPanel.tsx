"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, RadioTower, Users, Settings2, Play, ChevronDown, ChevronUp, Radio, Activity } from "lucide-react";
import { DEFAULT_RADIO_FX, normalizeRadioFx } from "@/lib/radio/settings";
import { RADIO_PROFILES, RADIO_PROFILE_IDS } from "@/lib/radio/profiles";
import { txStatusLabel } from "@/lib/radio/text";
import type { RadioFxSettings } from "@/lib/radio/types";
import PanelShell from "./PanelShell";

export interface RadioMsg {
  id: number;
  callsign: string;
  channel: string;
  text: string;
  kind: "pilot" | "atc" | "system";
  playerId?: string;
}

export interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string;
  squelch: boolean;
  pilots: boolean;
  /** Efeitos de rádio aeronáutico aplicados ao áudio do TTS (opcional, OFF por padrão) */
  radioFx: RadioFxSettings;
}

export const DEFAULT_VOICE: VoiceSettings = {
  rate: 1.1,
  pitch: 0.92,
  volume: 1,
  voiceURI: "",
  squelch: true,
  pilots: true,
  radioFx: { ...DEFAULT_RADIO_FX },
};

const QUICK: Record<string, string[]> = {
  ground: ["Solicito acionamento", "Solicito táxi para a pista", "Solicito rearme e reabastecimento"],
  tower: ["Pronto para decolagem", "Solicito pouso", "Toque e arremetida", "Solicito passagem baixa", "Solicito ingresso na zona", "Área de tiro?", "Checagem de rádio", "MAYDAY, emergência!"],
  approach: ["Solicito vetores ILS", "Solicito descida", "Informo intenções: circuito local"],
  flight: ["Formar comigo!", "Alguém para dogfight?", "Belo pouso! 👏", "Fox 2!"],
  global: ["Olá, pilotos!", "Alguém na área de tiro?", "GG! 🎯"],
};

interface Props {
  messages: RadioMsg[];
  onSend: (channel: string, text: string) => void;
  ttsOn: boolean;
  setTtsOn: (v: boolean) => void;
  voice: VoiceSettings;
  setVoice: (v: VoiceSettings) => void;
  onTestVoice: () => void;
  online: { id: string; callsign: string; aircraft: string }[];
  myId: string;
  freqs: { twr: string; gnd: string; app: string };
  open: boolean;
  setOpen: (v: boolean) => void;
  /** status do processador de rádio, exibido nas configurações */
  radioStatus?: string;
  /** sons de PTT (abertura/fechamento do canal) */
  onPtt?: (open: boolean) => void;
}

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};

export default function RadioPanel({ messages, onSend, ttsOn, setTtsOn, voice, setVoice, onTestVoice, online, myId, freqs, open, setOpen, radioStatus = "idle", onPtt }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [channel, setChannel] = useState<string>("ground");
  const [text, setText] = useState("");
  const [settings, setSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const channels = [
    { id: "ground", name: "SOLO", freq: freqs.gnd },
    { id: "tower", name: "TORRE", freq: freqs.twr },
    { id: "approach", name: "APP", freq: freqs.app },
    { id: "flight", name: "VOO", freq: "123.45" },
    { id: "global", name: "GLOBAL", freq: "CHAT" },
  ];

  const SR = typeof window !== "undefined"
    ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
    : undefined;
  const voiceSupported = Boolean(SR);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      setVoices([...all].sort((a, b) => Number(b.lang.startsWith("pt")) - Number(a.lang.startsWith("pt"))));
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const startPTT = () => {
    if (!SR || recRef.current) return;
    try {
      const rec = new (SR as new () => SpeechRecognitionLike)();
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.trim();
          if (t) onSendRef.current(channelRef.current, t);
        }
      };
      rec.onend = () => { recRef.current = null; setListening(false); };
      rec.onerror = () => { recRef.current = null; setListening(false); };
      rec.start();
      recRef.current = rec;
      setListening(true);
      pttRef.current?.(true); // clique de PTT ao ABRIR o canal
    } catch {
      setListening(false);
    }
  };
  const stopPTT = () => {
    if (!recRef.current) return;
    recRef.current.stop();
    recRef.current = null;
    setListening(false);
    pttRef.current?.(false); // clique de PTT ao FECHAR o canal
  };
  const startRef = useRef(startPTT);
  startRef.current = startPTT;
  const stopRef = useRef(stopPTT);
  stopRef.current = stopPTT;
  const pttRef = useRef(onPtt);
  pttRef.current = onPtt;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "KeyV" && !e.repeat) startRef.current();
      if (e.code === "KeyT") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "KeyV") stopRef.current(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, channel]);

  const filtered = messages.filter((m) => m.channel === channel || m.channel === "local");
  const unread = (id: string) => messages.slice(-12).some((m) => m.channel === id && m.kind !== "system") && id !== channel;
  const unreadCount = messages.filter((m) => unread(m.channel)).length;
  const channelName = channels.find((c) => c.id === channel)?.name ?? "";
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(channel, t);
    setText("");
  };

  const slider = (label: string, key: "rate" | "pitch" | "volume", min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="block">
      <div className="flex justify-between text-[9px] font-bold tracking-wider text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-emerald-300">{fmt(voice[key])}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={voice[key]} onChange={(e) => setVoice({ ...voice, [key]: Number(e.target.value) })} className="mt-0.5 w-full accent-emerald-500" />
    </label>
  );

  const fx: RadioFxSettings = normalizeRadioFx(voice.radioFx ?? DEFAULT_RADIO_FX);
  const fxSlider = (label: string, value: number, onChange: (v: number) => void, fmt: (v: number) => string) => (
    <label className="block">
      <div className="flex justify-between text-[8px] font-bold tracking-wider text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-sky-300">{fmt(value)}</span>
      </div>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-0.5 w-full accent-sky-500" />
    </label>
  );

  return (
    <PanelShell
      title="RÁDIO / CHAT"
      icon={<RadioTower size={14} />}
      accent="emerald"
      width={340}
      storageKey="radio"
      zIndex={settings ? 45 : 30}
      defaultPos={{ x: Math.max(8, window.innerWidth - 354), y: 56 }}
      open={open}
      onToggle={setOpen}
      badge={<span className={`ml-1 inline-block h-2 w-2 rounded-full ${listening ? "animate-ping bg-red-500" : "bg-emerald-500"}`} />}
      collapsedHint={<span className="font-mono text-[9px] text-emerald-300">{unreadCount > 0 ? `${unreadCount} nova(s)` : channelName}</span>}
      headerRight={
        <>
          <button onClick={() => setSettings(!settings)} title="Configurações de voz" className={`rounded p-1 transition hover:bg-white/10 ${settings ? "text-emerald-300" : "text-emerald-500/70"}`}><Settings2 size={14} /></button>
          <button onClick={() => setTtsOn(!ttsOn)} title={ttsOn ? "Silenciar voz" : "Ativar voz"} className={`rounded p-1 transition hover:bg-white/10 ${ttsOn ? "text-emerald-300" : "text-emerald-500/60"}`}>
            {ttsOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </>
      }
    >
      {settings && (
        <div className="space-y-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2.5">
          {slider("VELOCIDADE DA VOZ", "rate", 0.5, 2, 0.05, (v) => `${v.toFixed(2)}×`)}
          {slider("TOM", "pitch", 0.5, 1.6, 0.05, (v) => v.toFixed(2))}
          {slider("VOLUME", "volume", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
          <label className="block text-[9px] font-bold tracking-wider text-slate-400">
            VOZ
            <select value={voice.voiceURI} onChange={(e) => setVoice({ ...voice, voiceURI: e.target.value })} className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[10px] font-normal text-slate-200 outline-none focus:border-emerald-500">
              <option value="">Automática (pt-BR)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.lang}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-2 text-[10px] text-slate-300">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={voice.squelch} onChange={(e) => setVoice({ ...voice, squelch: e.target.checked })} className="accent-emerald-500" /> Chiado de rádio</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={voice.pilots} onChange={(e) => setVoice({ ...voice, pilots: e.target.checked })} className="accent-emerald-500" /> Ouvir pilotos</label>
            <button onClick={onTestVoice} className="flex items-center gap-1 rounded bg-emerald-700 px-2 py-0.5 font-bold text-white hover:bg-emerald-600"><Play size={10} /> Testar</button>
          </div>

          {/* ===== Radio Communication Effects (camada opcional sobre o TTS) ===== */}
          <div className="rounded-md border border-slate-700/80 bg-slate-950/60 p-2">
            <button
              onClick={() => setVoice({ ...voice, radioFx: { ...fx, enabled: !fx.enabled } })}
              className={`flex w-full items-center justify-between rounded px-1.5 py-1 transition ${fx.enabled ? "bg-sky-500/15" : "bg-slate-900"}`}
              title="Aplica filtragem VHF, compressão, estática, interferências e PTT ao áudio do TTS"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide">
                <Radio size={12} className={fx.enabled ? "text-sky-300" : "text-slate-500"} />
                <span className={fx.enabled ? "text-sky-200" : "text-slate-400"}>RADIO COMMUNICATION EFFECTS</span>
              </span>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-black ${fx.enabled ? "bg-sky-400 text-slate-950" : "bg-slate-700 text-slate-300"}`}>
                {fx.enabled ? "ON" : "OFF"}
              </span>
            </button>

            <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[8px] text-slate-500" data-radio-status={radioStatus}>
              <span className="flex items-center gap-1"><Activity size={9} /> {txStatusLabel(radioStatus, RADIO_PROFILES[fx.profile]?.label)}</span>
              <span>{fx.enabled ? "voz processada" : "TTS original (sem efeitos)"}</span>
            </div>

            {fx.enabled && (
              <div className="mt-1.5 space-y-1.5">
                <div className="grid grid-cols-3 gap-1">
                  {RADIO_PROFILE_IDS.map((id) => (
                    <button
                      key={id}
                      onClick={() => setVoice({ ...voice, radioFx: { ...fx, profile: id } })}
                      title={RADIO_PROFILES[id].description}
                      className={`rounded border py-1 text-[8px] font-bold tracking-wide transition ${
                        fx.profile === id ? "border-sky-400/80 bg-sky-500/20 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {RADIO_PROFILES[id].label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between rounded bg-slate-900 px-1.5 py-1 text-[8px] font-bold tracking-wider text-slate-400 hover:text-slate-200"
                >
                  ADVANCED RADIO AUDIO SETTINGS
                  {advanced ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>

                {advanced && (
                  <div className="space-y-1.5 rounded bg-slate-900/70 p-1.5">
                    {fxSlider("RADIO VOLUME", fx.volume, (v) => setVoice({ ...voice, radioFx: { ...fx, volume: v } }), (v) => `${Math.round(v * 100)}%`)}
                    {fxSlider("STATIC INTENSITY", fx.staticIntensity, (v) => setVoice({ ...voice, radioFx: { ...fx, staticIntensity: v } }), (v) => `${Math.round(v * 100)}%`)}
                    <div className="grid grid-cols-1 gap-1 pt-0.5 text-[9px] text-slate-300">
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={fx.interference} onChange={(e) => setVoice({ ...voice, radioFx: { ...fx, interference: e.target.checked } })} className="accent-sky-500" /> Interference (estalos e falhas)</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={fx.pttSound} onChange={(e) => setVoice({ ...voice, radioFx: { ...fx, pttSound: e.target.checked } })} className="accent-sky-500" /> PTT Sound (abertura do canal)</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={fx.endSound} onChange={(e) => setVoice({ ...voice, radioFx: { ...fx, endSound: e.target.checked } })} className="accent-sky-500" /> Transmission End Sound</label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 border-b border-slate-800 text-center">
        {channels.map((c) => (
          <button key={c.id} onClick={() => setChannel(c.id)} className={`relative px-1 py-1.5 transition ${channel === c.id ? "bg-emerald-500/15 text-emerald-300" : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"}`}>
            <div className="text-[9px] font-bold tracking-wider">{c.name}</div>
            <div className="font-mono text-[8px] opacity-70">{c.freq}</div>
            {unread(c.id) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
          </button>
        ))}
      </div>

      <div ref={feedRef} className="h-44 space-y-1.5 overflow-y-auto px-2.5 py-2 text-[11px] leading-snug">
        {filtered.length === 0 && <div className="pt-6 text-center text-slate-600">Canal silencioso… use as frases rápidas ou fale (V).</div>}
        {filtered.map((m) => (
          <div key={m.id} className={`rounded px-2 py-1 ${m.kind === "atc" ? "border-l-2 border-amber-400 bg-amber-400/10 text-amber-100" : m.kind === "system" ? "border-l-2 border-slate-600 bg-slate-800/40 italic text-slate-400" : m.playerId === myId ? "border-l-2 border-emerald-400 bg-emerald-400/10 text-emerald-100" : "border-l-2 border-sky-400 bg-sky-400/10 text-sky-100"}`}>
            <span className={`mr-1.5 font-display text-[10px] font-bold tracking-wide ${m.kind === "atc" ? "text-amber-400" : m.kind === "system" ? "text-slate-500" : m.playerId === myId ? "text-emerald-400" : "text-sky-400"}`}>
              {m.kind === "atc" ? "📻" : m.kind === "system" ? "ℹ" : "✈"} {m.callsign}
            </span>
            {m.text}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-t border-slate-800 px-2 py-1.5">
        {(QUICK[channel] ?? []).map((q) => (
          <button key={q} onClick={() => onSend(channel, q)} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300">{q}</button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-t border-slate-800 bg-slate-900/70 p-2">
        <button
          onMouseDown={startPTT} onMouseUp={stopPTT} onMouseLeave={stopPTT}
          onTouchStart={(e) => { e.preventDefault(); startPTT(); }} onTouchEnd={stopPTT}
          disabled={!voiceSupported}
          title={voiceSupported ? "Segure para falar (ou tecla V)" : "Voz não suportada neste navegador — use o chat"}
          className={`flex h-8 w-9 items-center justify-center rounded transition ${listening ? "animate-pulse bg-red-600 text-white" : voiceSupported ? "bg-slate-800 text-emerald-300 hover:bg-slate-700" : "bg-slate-800/50 text-slate-600"}`}
        >
          {voiceSupported ? <Mic size={15} /> : <MicOff size={15} />}
        </button>
        <input
          ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
          placeholder={listening ? "🔴 Transmitindo voz…" : `Mensagem em ${channels.find((c) => c.id === channel)?.name}… (T)`}
          className="h-8 flex-1 rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500"
        />
        <button onClick={send} className="flex h-8 w-8 items-center justify-center rounded bg-emerald-600 text-white transition hover:bg-emerald-500"><Send size={13} /></button>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/50 px-3 py-1.5">
        <Users size={12} className="text-sky-400" />
        <span className="text-[9px] font-bold tracking-wider text-slate-400">NESTE AEROPORTO {online.length}</span>
        <div className="flex flex-1 flex-wrap gap-1 overflow-hidden">
          {online.slice(0, 5).map((p) => (
            <span key={p.id} className={`rounded px-1.5 py-0.5 font-mono text-[8px] ${p.id === myId ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{p.callsign}</span>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}