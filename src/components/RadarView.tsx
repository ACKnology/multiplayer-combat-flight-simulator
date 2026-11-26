"use client";
import { useEffect, useRef, useState } from "react";
import type { FlightEngine, RadarData } from "@/sim/engine";
import { Radar, Tag, X, Plus, Minus, Navigation, Compass, GripHorizontal, GripVertical, CloudRain } from "lucide-react";

const RANGES = [2, 5, 10, 20, 40, 80]; // milhas náuticas
const NM = 1852;

interface Props {
  engineRef: React.RefObject<FlightEngine | null>;
  open: boolean;
  onClose: () => void;
  labels: boolean;
  setLabels: (v: boolean) => void;
}

const COLORS = { traffic: "#5aff8a", player: "#4ec3ff", hostile: "#ff5a4a", missile: "#ffd23c" } as const;

export default function RadarView({ engineRef, open, onClose, labels, setLabels }: Props) {
  const [geo, setGeo] = useState({ x: 14, y: 215, size: 390 });
  const [rangeIdx, setRangeIdx] = useState(2);
  const [northUp, setNorthUp] = useState(false);
  const [wxOn, setWxOn] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ rangeIdx, northUp, labels, wxOn, size: geo.size });
  opts.current = { rangeIdx, northUp, labels, wxOn, size: geo.size };
  const trails = useRef(new Map<string, { x: number; z: number }[]>());
  const lastTrail = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("sbvs-radar") ?? "null");
      if (s?.geo) setGeo({ x: Math.min(s.geo.x, window.innerWidth - 240), y: Math.min(s.geo.y, window.innerHeight - 240), size: s.geo.size });
      if (typeof s?.rangeIdx === "number") setRangeIdx(s.rangeIdx);
      if (typeof s?.northUp === "boolean") setNorthUp(s.northUp);
      if (typeof s?.wxOn === "boolean") setWxOn(s.wxOn);
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (loaded.current) localStorage.setItem("sbvs-radar", JSON.stringify({ geo, rangeIdx, northUp, wxOn }));
  }, [geo, rangeIdx, northUp, wxOn]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "BracketLeft") setRangeIdx((i) => Math.max(0, i - 1));
      if (e.code === "BracketRight") setRangeIdx((i) => Math.min(RANGES.length - 1, i + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return;
      last = t;
      const cv = canvasRef.current, eng = engineRef.current;
      if (!cv || !eng) return;
      const data = eng.getRadarData();
      if (!data) return;
      if (t - lastTrail.current > 1000) {
        lastTrail.current = t;
        const seen = new Set<string>();
        for (const c of data.contacts) {
          if (c.kind !== "traffic" && c.kind !== "player") continue;
          seen.add(c.id);
          const arr = trails.current.get(c.id) ?? [];
          arr.push({ x: c.x, z: c.z });
          if (arr.length > 8) arr.shift();
          trails.current.set(c.id, arr);
        }
        for (const k of trails.current.keys()) if (!seen.has(k)) trails.current.delete(k);
      }
      draw(cv, data, t, opts.current, trails.current);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, engineRef]);

  const drag = (e: React.PointerEvent, mode: "move" | "size") => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, g0 = { ...geo };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === "move") {
        setGeo({ ...g0, x: Math.max(0, Math.min(window.innerWidth - 120, g0.x + dx)), y: Math.max(0, Math.min(window.innerHeight - 60, g0.y + dy)) });
      } else {
        setGeo({ ...g0, size: Math.round(Math.max(220, Math.min(Math.min(window.innerHeight - 50, 980), g0.size + Math.max(dx, dy)))) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!open) return null;
  const btn = "flex h-6 items-center justify-center rounded px-1.5 text-[10px] font-bold transition";
  return (
    <div
      className="absolute z-30 overflow-hidden rounded-lg border border-emerald-800/80 bg-[#020a05]/95 shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
      style={{ left: geo.x, top: geo.y, width: geo.size }}
    >
      <div className="flex select-none items-center gap-1 border-b border-emerald-900/80 bg-emerald-950/60 px-1.5 py-1">
        <span
          onPointerDown={(e) => drag(e, "move")}
          title="Arraste aqui para mover o radar"
          className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-emerald-600 transition hover:bg-white/10 hover:text-emerald-300 active:cursor-grabbing"
        >
          <GripVertical size={13} />
        </span>
        <Radar size={13} className="shrink-0 text-emerald-400" />
        <span className="mr-auto whitespace-nowrap font-display text-[10px] font-bold tracking-[0.12em] text-emerald-300">JANELA DO RADAR</span>
        <div className="flex items-center gap-1">
          <button title="Diminuir alcance ( [ )" onClick={() => setRangeIdx((i) => Math.max(0, i - 1))} className={`${btn} bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60`}><Minus size={11} /></button>
          <span className="w-11 text-center font-mono text-[10px] text-emerald-200">{RANGES[rangeIdx]} NM</span>
          <button title="Aumentar alcance ( ] )" onClick={() => setRangeIdx((i) => Math.min(RANGES.length - 1, i + 1))} className={`${btn} bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60`}><Plus size={11} /></button>
          <button title="Radar Meteorológico (WX) on/off" onClick={() => setWxOn(!wxOn)} className={`${btn} gap-0.5 ${wxOn ? "bg-sky-500/25 text-sky-300 ring-1 ring-sky-500/70" : "bg-emerald-900/40 text-emerald-700"}`}>
            <CloudRain size={11} /> WX
          </button>
          <button title={northUp ? "Norte acima (clique: proa acima)" : "Proa acima (clique: norte acima)"} onClick={() => setNorthUp(!northUp)} className={`${btn} gap-0.5 bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60`}>
            {northUp ? <Compass size={11} /> : <Navigation size={11} />} {northUp ? "N↑" : "HDG"}
          </button>
          <button title="Mostrar/ocultar indicativos (L)" onClick={() => setLabels(!labels)} className={`${btn} ${labels ? "bg-emerald-500/30 text-emerald-200 ring-1 ring-emerald-500" : "bg-emerald-900/40 text-emerald-700"}`}><Tag size={11} /></button>
          <button title="Fechar (R)" onClick={onClose} className={`${btn} text-emerald-600 hover:text-red-400`}><X size={12} /></button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: geo.size, height: geo.size, display: "block" }}
        onWheel={(e) => setRangeIdx((i) => Math.max(0, Math.min(RANGES.length - 1, i + (e.deltaY > 0 ? 1 : -1))))}
      />
      <div onPointerDown={(e) => drag(e, "size")} title="Arraste para redimensionar" className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-emerald-600 hover:text-emerald-300">
        <GripHorizontal size={12} className="rotate-[-45deg]" />
      </div>
    </div>
  );
}

function draw(
  cv: HTMLCanvasElement, d: RadarData, t: number,
  o: { rangeIdx: number; northUp: boolean; labels: boolean; wxOn: boolean; size: number },
  trails: Map<string, { x: number; z: number }[]>
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const S = o.size;
  if (cv.width !== Math.round(S * dpr)) {
    cv.width = Math.round(S * dpr);
    cv.height = Math.round(S * dpr);
  }
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = S / 2, cx = R, cy = R;
  const rangeM = RANGES[o.rangeIdx] * NM;
  const k = (R - 12) / rangeM;
  const rot = o.northUp ? 0 : (-d.self.hdg * Math.PI) / 180;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (x: number, z: number): [number, number] => {
    const dx = (x - d.self.x) * k, dz = (z - d.self.z) * k;
    return [cx + dx * cs - dz * sn, cy + dx * sn + dz * cs];
  };
  const fs = Math.max(9, Math.min(12, S / 38));

  // fundo
  const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
  bg.addColorStop(0, "#03200f");
  bg.addColorStop(1, "#010804");
  c.fillStyle = bg;
  c.fillRect(0, 0, S, S);
  c.save();
  c.beginPath();
  c.arc(cx, cy, R - 4, 0, Math.PI * 2);
  c.clip();

  // camada de Radar Meteorológico (WX): células reais de nuvens/chuva/trovoada
  if (o.wxOn && d.weatherCells?.length) {
    for (const w of d.weatherCells) {
      const [wx, wy] = P(w.x, w.z);
      const rad = Math.max(8, w.radius * k);
      if (wx + rad < 0 || wx - rad > S || wy + rad < 0 || wy - rad > S) continue;
      const grad = c.createRadialGradient(wx, wy, rad * 0.08, wx, wy, rad);
      if (w.isCB || w.intensity > 0.72) {
        grad.addColorStop(0, "rgba(232, 38, 120, 0.55)"); // núcleo CB magenta/vermelho
        grad.addColorStop(0.32, "rgba(239, 68, 68, 0.45)");
        grad.addColorStop(0.65, "rgba(234, 179, 8, 0.34)");
        grad.addColorStop(0.88, "rgba(34, 197, 94, 0.24)");
        grad.addColorStop(1, "rgba(34, 197, 94, 0)");
      } else if (w.intensity > 0.38) {
        grad.addColorStop(0, "rgba(234, 179, 8, 0.42)");
        grad.addColorStop(0.5, "rgba(34, 197, 94, 0.3)");
        grad.addColorStop(1, "rgba(34, 197, 94, 0)");
      } else {
        grad.addColorStop(0, "rgba(34, 197, 94, 0.42)");
        grad.addColorStop(0.55, "rgba(34, 197, 94, 0.22)");
        grad.addColorStop(1, "rgba(34, 197, 94, 0)");
      }
      c.fillStyle = grad;
      c.beginPath();
      c.arc(wx, wy, rad, 0, Math.PI * 2);
      c.fill();
      if (w.isCB && o.labels && o.rangeIdx >= 1) {
        c.fillStyle = "rgba(255,140,170,0.75)";
        c.font = `bold ${Math.max(8, fs - 2)}px 'IBM Plex Mono', monospace`;
        c.fillText("CB", wx - 6, wy + 3);
      }
    }
  }

  // anéis de alcance
  c.strokeStyle = "rgba(90,255,138,0.16)";
  c.fillStyle = "rgba(90,255,138,0.45)";
  c.lineWidth = 1;
  c.font = `${fs - 1}px 'IBM Plex Mono', monospace`;
  for (let i = 1; i <= 4; i++) {
    const r = ((R - 12) * i) / 4;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    c.fillText(`${+((RANGES[o.rangeIdx] * i) / 4).toFixed(1)}`, cx + 3, cy - r + fs);
  }
  // rosa dos ventos
  for (let a = 0; a < 360; a += 10) {
    const ang = (a * Math.PI) / 180 + rot;
    const r1 = R - 6, r2 = R - (a % 30 === 0 ? 16 : 11);
    c.strokeStyle = a % 30 === 0 ? "rgba(90,255,138,0.6)" : "rgba(90,255,138,0.3)";
    c.beginPath();
    c.moveTo(cx + Math.sin(ang) * r1, cy - Math.cos(ang) * r1);
    c.lineTo(cx + Math.sin(ang) * r2, cy - Math.cos(ang) * r2);
    c.stroke();
    if (a % 30 === 0) {
      const lbl = a === 0 ? "N" : a === 90 ? "L" : a === 180 ? "S" : a === 270 ? "O" : String(a / 10).padStart(2, "0");
      c.fillStyle = a === 0 ? "#ff8a7a" : "rgba(160,255,190,0.8)";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(lbl, cx + Math.sin(ang) * (R - 24), cy - Math.cos(ang) * (R - 24));
    }
  }
  c.textAlign = "left";
  c.textBaseline = "alphabetic";

  // prolongamento do eixo da pista ativa (ILS) com marcas a cada 1 NM
  {
    const [x0, y0] = P(d.thr.x, d.thr.z);
    const [x1, y1] = P(d.thr.x - d.thr.dx * 10 * NM, d.thr.z - d.thr.dz * 10 * NM);
    c.setLineDash([6, 6]);
    c.strokeStyle = "rgba(255,210,60,0.45)";
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.setLineDash([]);
    for (let n = 1; n <= 10; n++) {
      const [mx, my] = P(d.thr.x - d.thr.dx * n * NM, d.thr.z - d.thr.dz * n * NM);
      const px = -(y1 - y0), py = x1 - x0, L = Math.hypot(px, py) || 1;
      const w = n % 5 === 0 ? 7 : 4;
      c.beginPath();
      c.moveTo(mx + (px / L) * w, my + (py / L) * w);
      c.lineTo(mx - (px / L) * w, my - (py / L) * w);
      c.stroke();
    }
  }
  // pistas
  for (const r of d.runways) {
    const [a, b] = P(r.x1, r.z1), [e, f] = P(r.x2, r.z2);
    c.strokeStyle = r.active ? "#f5f5f0" : "rgba(220,220,210,0.55)";
    c.lineWidth = Math.max(2.5, Math.min(7, 45 * k));
    c.beginPath();
    c.moveTo(a, b);
    c.lineTo(e, f);
    c.stroke();
    c.lineWidth = 1;
    if (o.rangeIdx <= 2) {
      c.fillStyle = "rgba(240,240,230,0.8)";
      c.font = `${fs - 1}px 'IBM Plex Mono', monospace`;
      c.fillText(r.id1, a + 4, b + 4);
      c.fillText(r.id2, e + 4, f + 4);
    }
  }
  {
    const [tx, ty] = P(d.tower.x, d.tower.z);
    c.fillStyle = "#ffd23c";
    c.fillRect(tx - 2.5, ty - 2.5, 5, 5);
    if (o.labels && o.rangeIdx <= 2) c.fillText("TWR", tx + 5, ty - 4);
  }

  // rastros
  for (const arr of trails.values()) {
    arr.forEach((p, i) => {
      const [x, y] = P(p.x, p.z);
      c.fillStyle = `rgba(90,255,138,${0.1 + (i / arr.length) * 0.35})`;
      c.fillRect(x - 1, y - 1, 2, 2);
    });
  }

  // contatos
  c.font = `bold ${fs}px 'IBM Plex Mono', monospace`;
  for (const ct of d.contacts) {
    const [x, y] = P(ct.x, ct.z);
    const col = COLORS[ct.kind];
    c.fillStyle = col;
    c.strokeStyle = col;
    if (ct.kind === "hostile") {
      c.beginPath();
      c.moveTo(x, y - 4);
      c.lineTo(x + 4, y);
      c.lineTo(x, y + 4);
      c.lineTo(x - 4, y);
      c.closePath();
      c.stroke();
      if (o.labels && o.rangeIdx <= 2) {
        c.font = `${fs - 2}px 'IBM Plex Mono', monospace`;
        c.fillText(ct.callsign, x + 6, y + 3);
        c.font = `bold ${fs}px 'IBM Plex Mono', monospace`;
      }
      continue;
    }
    if (ct.kind === "missile") {
      c.beginPath();
      c.arc(x, y, 2.2, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    // vetor de velocidade (60 s)
    const [vx, vy] = P(ct.x + ct.vx * 60, ct.z + ct.vz * 60);
    c.globalAlpha = 0.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(vx, vy);
    c.stroke();
    c.globalAlpha = 1;
    const selected = Boolean(d.selectedHex && ct.hex && ct.hex === d.selectedHex);
    if (selected) {
      // destaque pulsante na aeronave ADS-B selecionada
      const pulse = 8 + Math.sin(t * 0.008) * 3;
      c.save();
      c.strokeStyle = "#38bdf8";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, pulse, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = "#fbbf24";
      c.lineWidth = 1.5;
      c.strokeRect(x - 6, y - 6, 12, 12);
      c.restore();
    } else if (ct.kind === "player") {
      c.beginPath();
      c.arc(x, y, 4, 0, Math.PI * 2);
      c.stroke();
    } else c.strokeRect(x - 3.5, y - 3.5, 7, 7);
    if (o.labels || selected) {
      const lx = x + 14, ly = y - 14;
      c.globalAlpha = selected ? 0.95 : 0.5;
      c.strokeStyle = selected ? "#38bdf8" : col;
      c.beginPath();
      c.moveTo(x + 4, y - 4);
      c.lineTo(lx - 2, ly + 4);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = selected ? "#7dd3fc" : col;
      c.fillText(selected ? `★ ${ct.callsign}` : ct.callsign, lx, ly);
      c.font = `${fs - 1}px 'IBM Plex Mono', monospace`;
      c.fillText(`${String(Math.max(0, Math.round(ct.altFt / 100))).padStart(3, "0")} ${Math.round(ct.gsKt)}kt ${ct.type}`, lx, ly + fs + 1);
      c.font = `bold ${fs}px 'IBM Plex Mono', monospace`;
    }
  }

  // varredura
  const sweep = ((t / 2600) % 1) * Math.PI * 2;
  for (let i = 0; i < 18; i++) {
    const a = sweep - i * 0.035;
    c.strokeStyle = `rgba(90,255,138,${0.32 * (1 - i / 18)})`;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
    c.stroke();
  }
  c.restore();

  // própria aeronave
  c.save();
  c.translate(cx, cy);
  c.rotate(o.northUp ? (d.self.hdg * Math.PI) / 180 : 0);
  c.fillStyle = "#ffd23c";
  c.beginPath();
  c.moveTo(0, -8);
  c.lineTo(5, 6);
  c.lineTo(0, 3);
  c.lineTo(-5, 6);
  c.closePath();
  c.fill();
  c.restore();

  // cabeçalho de dados
  c.font = `bold ${fs}px 'IBM Plex Mono', monospace`;
  c.fillStyle = "rgba(160,255,190,0.9)";
  c.fillText(`${d.icao} · ${o.northUp ? "NORTE ↑" : "PROA ↑"}`, 8, fs + 6);
  c.textAlign = "right";
  c.fillText(`HDG ${String(Math.round(d.self.hdg) % 360).padStart(3, "0")}`, S - 8, fs + 6);
  c.fillText(`${Math.round(d.self.altFt)} ft  ${Math.round(d.self.gsKt)} kt`, S - 8, S - 8);
  c.textAlign = "left";
  c.fillStyle = "rgba(160,255,190,0.65)";
  const nTr = d.contacts.filter((x) => x.kind === "traffic" || x.kind === "player").length;
  c.fillText(`${nTr} tráfegos · ${o.wxOn ? `WX ${String(Math.round(d.windDir)).padStart(3, "0")}°/${d.windKt}kt` : "WX off"}`, 8, S - 8);
}