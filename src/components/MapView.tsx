"use client";
import { useEffect, useRef, useState } from "react";
import type { FlightEngine, MapData } from "@/sim/engine";
import { loadImage, merc, tileUrls } from "@/sim/geo";
import {
  Map as MapIcon, Satellite, MapPin, Plus, Minus, LocateFixed, Plane, Tag, X,
  GripVertical, GripHorizontal, ChevronDown, ChevronUp,
} from "lucide-react";

type MapStyle = "esri" | "osm";

interface Props {
  engineRef: React.RefObject<FlightEngine | null>;
  open: boolean;
  onClose: () => void;
  labels: boolean;
  setLabels: (v: boolean) => void;
  onSelectFlight?: (hex: string) => void;
}

const tileCache = new Map<string, HTMLImageElement | "err" | "loading">();

function getTile(style: MapStyle, z: number, x: number, y: number, onLoad: () => void): HTMLImageElement | null {
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  const k = `${style}/${z}/${wx}/${y}`;
  const cur = tileCache.get(k);
  if (cur && cur !== "err" && cur !== "loading") return cur;
  if (cur === "err" || cur === "loading") return null;
  tileCache.set(k, "loading");
  loadImage(tileUrls(style, z, wx, y), 10000)
    .then((img) => {
      tileCache.set(k, img);
      if (tileCache.size > 400) {
        const first = tileCache.keys().next().value;
        if (first) tileCache.delete(first);
      }
      onLoad();
    })
    .catch(() => {
      tileCache.set(k, "err");
    });
  return null;
}

/**
 * Janela de Mapa Real (tecla M) — visão aérea de cima com alternância entre
 * Satélite e Mapa de Ruas, zoom, pan, seguir aeronave e camada de tráfego ADS-B.
 */
export default function MapView({ engineRef, open, onClose, labels, setLabels, onSelectFlight }: Props) {
  const [geo, setGeo] = useState({ x: 420, y: 215, w: 420, h: 360 });
  const [collapsed, setCollapsed] = useState(false);
  const [style, setStyle] = useState<MapStyle>("esri");
  const [zoom, setZoom] = useState(12);
  const [follow, setFollow] = useState(true);
  const [showAdsb, setShowAdsb] = useState(true);
  const [center, setCenter] = useState<{ lat: number; lon: number }>({ lat: -23.43, lon: -46.47 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef<{ active: boolean; moved: boolean; lx: number; ly: number }>({ active: false, moved: false, lx: 0, ly: 0 });
  const centerRef = useRef(center);
  centerRef.current = center;
  const optsRef = useRef({ style, zoom, follow, showAdsb, labels, w: geo.w, h: geo.h });
  optsRef.current = { style, zoom, follow, showAdsb, labels, w: geo.w, h: geo.h };
  const lastHits = useRef<{ hex: string; px: number; py: number }[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("sbvs-map") ?? "null");
      if (s?.geo) {
        setGeo({
          x: Math.min(s.geo.x, Math.max(10, window.innerWidth - 260)),
          y: Math.min(s.geo.y, Math.max(10, window.innerHeight - 160)),
          w: s.geo.w ?? 420,
          h: s.geo.h ?? 380,
        });
      }
      if (s?.style === "esri" || s?.style === "osm") setStyle(s.style);
      if (typeof s?.zoom === "number") setZoom(s.zoom);
      if (typeof s?.showAdsb === "boolean") setShowAdsb(s.showAdsb);
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (loaded.current) localStorage.setItem("sbvs-map", JSON.stringify({ geo, style, zoom, showAdsb }));
  }, [geo, style, zoom, showAdsb]);

  useEffect(() => {
    if (!open || collapsed) return;
    let raf = 0;
    let last = 0;
    let dirty = true;
    const redraw = () => { dirty = true; };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!dirty && t - last < 100) return;
      last = t;
      dirty = false;
      const cv = canvasRef.current, eng = engineRef.current;
      if (!cv || !eng) return;
      const d = eng.getMapData();
      if (!d) return;
      if (optsRef.current.follow) {
        // se acompanhando um voo ADS-B em 3D, o mapa segue esse voo; senão segue o jogador
        const f = d.followHex ? d.adsb.find((a) => a.hex === d.followHex) : null;
        centerRef.current = f ? { lat: f.lat, lon: f.lon } : { lat: d.self.lat, lon: d.self.lon };
      }
      lastHits.current = drawMap(cv, d, centerRef.current, optsRef.current, t, redraw);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, collapsed, engineRef]);

  // arraste da janela (APENAS no handler de 6 pontos) e redimensionamento pelo canto
  const dragWin = (e: React.PointerEvent, mode: "move" | "size") => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, g0 = { ...geo };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === "move") {
        setGeo({
          ...g0,
          x: Math.max(2, Math.min(window.innerWidth - 200, g0.x + dx)),
          y: Math.max(2, Math.min(window.innerHeight - 60, g0.y + dy)),
        });
      } else {
        setGeo({
          ...g0,
          w: Math.round(Math.max(280, Math.min(window.innerWidth - 40, g0.w + dx))),
          h: Math.round(Math.max(220, Math.min(window.innerHeight - 60, g0.h + dy))),
        });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // pan e seleção de voo ADS-B no canvas do mapa
  const onCanvasDown = (e: React.PointerEvent) => {
    panRef.current = { active: true, moved: false, lx: e.clientX, ly: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onCanvasMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p.active) return;
    const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
    if (Math.hypot(dx, dy) > 3) p.moved = true;
    p.lx = e.clientX;
    p.ly = e.clientY;
    if (!p.moved) return;
    if (follow) setFollow(false);
    const scale = 256 * 2 ** zoom;
    const [mx, my] = merc(centerRef.current.lat, centerRef.current.lon);
    const nmx = mx - dx / scale;
    const nmy = Math.min(0.99, Math.max(0.01, my - dy / scale));
    const n = Math.PI - 2 * Math.PI * nmy;
    const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
    const lon = nmx * 360 - 180;
    const c = { lat, lon };
    centerRef.current = c;
    setCenter(c);
  };
  const onCanvasUp = (e: React.PointerEvent) => {
    const wasMoved = panRef.current.moved;
    panRef.current.active = false;
    if (!wasMoved && onSelectFlight && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      for (const h of lastHits.current) {
        if (Math.hypot(h.px - px, h.py - py) < 16) {
          onSelectFlight(h.hex);
          break;
        }
      }
    }
  };

  if (!open) return null;
  const btn = "flex h-6 items-center justify-center gap-1 rounded px-1.5 text-[9px] font-bold transition";

  return (
    <div
      className="absolute z-30 select-none overflow-hidden rounded-lg border border-sky-800/80 bg-slate-950/95 shadow-[0_10px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
      style={{ left: geo.x, top: geo.y, width: geo.w }}
    >
      {/* cabeçalho — arraste restrito aos 6 pontinhos */}
      <div className="flex items-center gap-1 border-b border-sky-900/70 bg-sky-950/50 px-1.5 py-1">
        <span
          onPointerDown={(e) => dragWin(e, "move")}
          title="Arraste aqui para mover a janela"
          className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-sky-600 transition hover:bg-white/10 hover:text-sky-300 active:cursor-grabbing"
        >
          <GripVertical size={13} />
        </span>
        <MapIcon size={13} className="shrink-0 text-sky-400" />
        <span className="mr-auto truncate font-display text-[11px] font-bold tracking-[0.18em] text-sky-300">MAPA</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setStyle(style === "esri" ? "osm" : "esri")}
            title={style === "esri" ? "Alternar para Mapa de Ruas (OSM)" : "Alternar para Satélite"}
            className={`${btn} bg-sky-900/60 text-sky-200 hover:bg-sky-800/70`}
          >
            {style === "esri" ? <Satellite size={11} /> : <MapPin size={11} />}
            {style === "esri" ? "SAT" : "RUAS"}
          </button>
          <button onClick={() => setZoom((z) => Math.max(7, z - 1))} title="Afastar zoom" className={`${btn} bg-slate-800/80 text-slate-300 hover:bg-slate-700`}><Minus size={11} /></button>
          <span className="w-6 text-center font-mono text-[9px] text-sky-200">Z{zoom}</span>
          <button onClick={() => setZoom((z) => Math.min(17, z + 1))} title="Aproximar zoom" className={`${btn} bg-slate-800/80 text-slate-300 hover:bg-slate-700`}><Plus size={11} /></button>
          <button
            onClick={() => setFollow(!follow)}
            title={follow ? "Seguindo aeronave (arraste o mapa para soltar)" : "Centralizar na aeronave"}
            className={`${btn} ${follow ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/70" : "bg-slate-800 text-slate-400"}`}
          >
            <LocateFixed size={11} />
          </button>
          <button
            onClick={() => setShowAdsb(!showAdsb)}
            title="Mostrar/ocultar aeronaves ADS-B no mapa"
            className={`${btn} ${showAdsb ? "bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/70" : "bg-slate-800 text-slate-500"}`}
          >
            <Plane size={11} /> ADS-B
          </button>
          <button
            onClick={() => setLabels(!labels)}
            title="Indicativos (L)"
            className={`${btn} ${labels ? "bg-sky-500/25 text-sky-200 ring-1 ring-sky-500" : "bg-slate-800 text-slate-500"}`}
          >
            <Tag size={11} />
          </button>
          <button onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expandir" : "Recolher"} className={`${btn} text-sky-500 hover:text-sky-200`}>
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button onClick={onClose} title="Fechar (M)" className={`${btn} text-sky-600 hover:text-red-400`}>
            <X size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="relative">
          <canvas
            ref={canvasRef}
            style={{ width: geo.w, height: geo.h, display: "block", cursor: panRef.current.active ? "grabbing" : "grab" }}
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            onPointerUp={onCanvasUp}
            onPointerCancel={onCanvasUp}
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) => Math.max(7, Math.min(17, z + (e.deltaY < 0 ? 1 : -1))));
            }}
          />
          <div
            onPointerDown={(e) => dragWin(e, "size")}
            title="Arraste para redimensionar"
            className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-sky-400/80 hover:text-sky-200"
          >
            <GripHorizontal size={12} className="-rotate-45" />
          </div>
        </div>
      )}
    </div>
  );
}

function drawMap(
  cv: HTMLCanvasElement,
  d: MapData,
  center: { lat: number; lon: number },
  o: { style: MapStyle; zoom: number; follow: boolean; showAdsb: boolean; labels: boolean; w: number; h: number },
  t: number,
  onTileLoad: () => void
): { hex: string; px: number; py: number }[] {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = o.w, H = o.h;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const c = cv.getContext("2d");
  if (!c) return [];
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = "#0b1522";
  c.fillRect(0, 0, W, H);

  const z = o.zoom;
  const n = 2 ** z;
  const tilePx = 256;
  const [cmx, cmy] = merc(center.lat, center.lon);
  const cPxX = cmx * n * tilePx;
  const cPxY = cmy * n * tilePx;

  const toScreen = (lat: number, lon: number): [number, number] => {
    const [mx, my] = merc(lat, lon);
    return [W / 2 + (mx * n * tilePx - cPxX), H / 2 + (my * n * tilePx - cPxY)];
  };

  // tiles de mapa reais (Satélite Esri ou Ruas OSM)
  const tx0 = Math.floor((cPxX - W / 2) / tilePx);
  const tx1 = Math.floor((cPxX + W / 2) / tilePx);
  const ty0 = Math.floor((cPxY - H / 2) / tilePx);
  const ty1 = Math.floor((cPxY + H / 2) / tilePx);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const sx = W / 2 + tx * tilePx - cPxX;
      const sy = H / 2 + ty * tilePx - cPxY;
      const img = getTile(o.style, z, tx, ty, onTileLoad);
      if (img) c.drawImage(img, Math.floor(sx), Math.floor(sy), tilePx + 1, tilePx + 1);
      else {
        c.strokeStyle = "rgba(56,189,248,0.08)";
        c.strokeRect(sx, sy, tilePx, tilePx);
      }
    }
  }

  // pistas do aeroporto
  for (const r of d.runways) {
    const [x1, y1] = toScreen(r.lat1, r.lon1);
    const [x2, y2] = toScreen(r.lat2, r.lon2);
    c.strokeStyle = r.active ? "#fbbf24" : "#cbd5e1";
    c.lineWidth = r.active ? 4 : 2.5;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }
  c.lineWidth = 1;

  // rastro de voo da sua aeronave
  if (d.trail.length > 1) {
    c.strokeStyle = "rgba(56, 189, 248, 0.85)";
    c.lineWidth = 2;
    c.beginPath();
    d.trail.forEach(([la, lo], i) => {
      const [px, py] = toScreen(la, lo);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    });
    const [sx, sy] = toScreen(d.self.lat, d.self.lon);
    c.lineTo(sx, sy);
    c.stroke();
    c.lineWidth = 1;
  }

  const hits: { hex: string; px: number; py: number }[] = [];

  const drawPlane = (x: number, y: number, hdgDeg: number, color: string, size = 7) => {
    c.save();
    c.translate(x, y);
    c.rotate((hdgDeg * Math.PI) / 180);
    c.fillStyle = color;
    c.strokeStyle = "#04080e";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, -size * 1.3);
    c.lineTo(size * 0.25, -size * 0.3);
    c.lineTo(size * 1.15, size * 0.25);
    c.lineTo(size * 1.15, size * 0.55);
    c.lineTo(size * 0.25, size * 0.25);
    c.lineTo(size * 0.2, size * 0.9);
    c.lineTo(size * 0.55, size * 1.2);
    c.lineTo(-size * 0.55, size * 1.2);
    c.lineTo(-size * 0.2, size * 0.9);
    c.lineTo(-size * 0.25, size * 0.25);
    c.lineTo(-size * 1.15, size * 0.55);
    c.lineTo(-size * 1.15, size * 0.25);
    c.lineTo(-size * 0.25, -size * 0.3);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  };

  c.font = "bold 10px 'IBM Plex Mono', monospace";

  // tráfego IA
  for (const tr of d.traffic) {
    const [px, py] = toScreen(tr.lat, tr.lon);
    if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
    drawPlane(px, py, tr.hdg, "#86efac", 6);
    if (o.labels) {
      c.fillStyle = "rgba(6,12,20,0.75)";
      c.fillRect(px + 9, py - 10, c.measureText(tr.cs).width + 6, 13);
      c.fillStyle = "#86efac";
      c.fillText(tr.cs, px + 12, py);
    }
  }

  // jogadores multiplayer
  for (const pl of d.players) {
    const [px, py] = toScreen(pl.lat, pl.lon);
    if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
    drawPlane(px, py, pl.hdg, "#38bdf8", 7);
    if (o.labels) {
      c.fillStyle = "rgba(6,12,20,0.8)";
      c.fillRect(px + 10, py - 10, c.measureText(pl.cs).width + 6, 13);
      c.fillStyle = "#7dd3fc";
      c.fillText(pl.cs, px + 13, py);
    }
  }

  // aeronaves reais ADS-B (quando habilitado no mapa!)
  if (o.showAdsb) {
    for (const a of d.adsb) {
      const [px, py] = toScreen(a.lat, a.lon);
      if (px < -30 || px > W + 30 || py < -30 || py > H + 30) continue;
      hits.push({ hex: a.hex, px, py });
      const sel = d.selectedHex === a.hex;
      const fol = d.followHex === a.hex;
      if (sel || fol) {
        const pulse = 11 + Math.sin(t * 0.008) * 3;
        c.strokeStyle = fol ? "#38bdf8" : "#f59e0b";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, py, pulse, 0, Math.PI * 2);
        c.stroke();
        c.lineWidth = 1;
      }
      drawPlane(px, py, a.trackDeg, sel || fol ? "#38bdf8" : a.onGround ? "#94a3b8" : "#fbbf24", sel ? 8 : 6.5);
      if (o.labels || sel || fol) {
        const tag = `${a.cs}${a.type ? " · " + a.type : ""}`;
        const sub = a.onGround ? "SOLO" : `${Math.round(a.altFt)}ft · ${a.gsKt}kt`;
        const tw = Math.max(c.measureText(tag).width, c.measureText(sub).width) + 8;
        c.fillStyle = sel ? "rgba(8,25,48,0.88)" : "rgba(6,12,20,0.75)";
        c.fillRect(px + 10, py - 13, tw, 24);
        c.fillStyle = sel ? "#7dd3fc" : "#fcd34d";
        c.fillText(tag, px + 14, py - 3);
        c.fillStyle = "#cbd5e1";
        c.fillText(sub, px + 14, py + 8);
      }
    }
  }

  // sua aeronave
  const [mx, my] = toScreen(d.self.lat, d.self.lon);
  drawPlane(mx, my, d.self.hdg, "#ffffff", 9);

  // barra inferior com coordenadas e legenda
  c.fillStyle = "rgba(4,10,18,0.82)";
  c.fillRect(0, H - 22, W, 22);
  c.fillStyle = "#94a3b8";
  c.font = "10px 'IBM Plex Mono', monospace";
  c.fillText(
    `${d.icao} · ${center.lat.toFixed(4)}°, ${center.lon.toFixed(4)}° · ${Math.round(d.self.altFt)}ft · ${Math.round(d.self.gsKt)}kt`,
    8,
    H - 7
  );
  c.textAlign = "right";
  c.fillStyle = o.style === "esri" ? "#7dd3fc" : "#86efac";
  c.fillText(o.style === "esri" ? "Esri Satélite" : "OpenStreetMap", W - 8, H - 7);
  c.textAlign = "left";
  return hits;
}
