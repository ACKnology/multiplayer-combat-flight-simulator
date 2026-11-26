"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X, GripVertical } from "lucide-react";

const ACCENT = {
  sky: "border-sky-900/50 bg-sky-950/40 text-sky-300",
  amber: "border-amber-900/40 bg-amber-950/30 text-amber-300",
  emerald: "border-emerald-900/50 bg-emerald-950/40 text-emerald-300",
  slate: "border-slate-800 bg-slate-900/80 text-slate-300",
} as const;

interface Props {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  accent?: keyof typeof ACCENT;
  width?: number;
  defaultPos: { x: number; y: number };
  storageKey?: string;
  collapsible?: boolean;
  closable?: boolean;
  onClose?: () => void;
  open?: boolean;
  onToggle?: (v: boolean) => void;
  children: ReactNode;
  /** conteúdo exibido quando recolhido (ex.: contagem) */
  collapsedHint?: ReactNode;
  headerRight?: ReactNode;
  /** permite elevar a janela acima das demais (ex.: configurações abertas) */
  zIndex?: number;
}

/**
 * Base de todas as janelas do HUD.
 * O arraste fica restrito ao handler (os 6 pontos) — nunca na barra inteira —
 * para que botões, sliders e o botão de recolher funcionem normalmente.
 */
export default function PanelShell({
  title, icon, badge, accent = "slate", width = 300, defaultPos, storageKey,
  collapsible = true, closable = false, onClose, open, onToggle, children, collapsedHint, headerRight, zIndex = 30,
}: Props) {
  const stored = (() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(`sbvs-panel:${storageKey}`);
      return raw ? (JSON.parse(raw) as { x: number; y: number; open: boolean }) : null;
    } catch {
      return null;
    }
  })();
  const [pos, setPos] = useState(stored?.x != null ? { x: stored.x, y: stored.y } : defaultPos);
  const [isOpen, setIsOpen] = useState(open ?? stored?.open ?? true);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const shown = open ?? isOpen;

  useEffect(() => {
    if (open !== undefined) setIsOpen(open);
  }, [open]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`sbvs-panel:${storageKey}`, JSON.stringify({ x: pos.x, y: pos.y, open: shown }));
    } catch {
      /* storage cheio/bloqueado */
    }
  }, [pos.x, pos.y, shown, storageKey]);

  const onDown = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = box.current?.offsetWidth ?? width;
    setPos({
      x: Math.min(Math.max(2, d.ox + e.clientX - d.sx), Math.max(2, window.innerWidth - w - 2)),
      y: Math.min(Math.max(2, d.oy + e.clientY - d.sy), Math.max(2, window.innerHeight - 40)),
    });
  };
  const onUp = () => { drag.current = null; };
  const toggle = () => {
    const v = !shown;
    setIsOpen(v);
    onToggle?.(v);
  };

  return (
    <div
      ref={box}
      style={{ left: pos.x, top: pos.y, width, zIndex }}
      className="absolute select-none overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/92 shadow-[0_6px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <div className={`flex items-center gap-1 border-b px-1.5 py-1.5 ${ACCENT[accent]}`}>
        {/* handler de arraste — os 6 pontos */}
        <span
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          title="Arraste aqui para mover a janela"
          className="flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-current/70 transition hover:bg-white/10 hover:text-current active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </span>
        {icon}
        <span
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          title="Arraste o título para mover a janela"
          className="-my-0.5 cursor-grab touch-none truncate px-0.5 font-display text-[11px] font-bold tracking-[0.2em] active:cursor-grabbing"
        >
          {title}
        </span>
        {badge}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {headerRight}
          {!shown && collapsedHint}
          {collapsible && (
            <button onClick={toggle} title={shown ? "Recolher" : "Expandir"}
              className="rounded p-1 text-current/70 transition hover:bg-white/10 hover:text-current">
              {shown ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          {closable && (
            <button onClick={onClose} title="Fechar e encerrar o stream"
              className="rounded p-1 text-current/70 transition hover:bg-white/10 hover:text-current">
              <X size={13} />
            </button>
          )}
        </span>
      </div>
      {shown && <div className="max-h-[calc(100vh-220px)] overflow-y-auto">{children}</div>}
    </div>
  );
}
