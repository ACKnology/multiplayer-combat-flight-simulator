"use client";
/**
 * LABORATÓRIO DE ANIMAÇÕES (PRD 02)
 * A. Animações incorporadas (AnimationMixer/AnimationClip): lista, reproduzir,
 *    pausar, reiniciar, velocidade, loop, seleção.
 * B. Articulações procedurais: objeto, pai, pivô (auto/manual + centro visível),
 *    eixo, sentido, neutro, mín/máx, atuação, ganho, escala, slider, posições
 *    predefinidas, testes individuais/combinados, presets e persistência.
 * Nenhuma física nova: apenas calibração visual, usando o MESMO
 * `ArticulationEngine` consumido pela camada visual da simulação.
 */
import { useMemo, useState, type ReactNode } from "react";
import type * as THREE from "three";
import {
  Play, Square, Pause, RotateCcw, Repeat, Plus, Trash2, SlidersHorizontal,
  Save, CirclePlay, LocateFixed, ChevronDown, ChevronRight, Wand2, Cpu, Layers3, Gauge,
} from "lucide-react";
import {
  LAB_GROUPS, STATE_CHANNELS, TEST_COMMANDS, presetArticulations, suggestArticulations,
  type ArticulationDef, type ArticulationEngine, type LabChannel, type LabConfig,
} from "@/lib/aircraft/articulation";

interface Props {
  lab: ArticulationDef[];
  onChange: (defs: ArticulationDef[]) => void;
  getArt: () => ArticulationEngine | null;
  clips: { name: string; duration: number }[];
  clipIdx: number;
  onSelectClip: (i: number) => void;
  onStopClip: () => void;
  clipPaused: boolean;
  setClipPaused: (v: boolean) => void;
  clipLoop: boolean;
  setClipLoop: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  nodes: { uuid: string; name: string; kind: string; parent: string }[];
  showPivots: boolean;
  setShowPivots: (v: boolean) => void;
  preset: LabConfig["preset"];
  setPreset: (p: LabConfig["preset"]) => void;
  getModel: () => THREE.Object3D | null;
  onSave: (useInSim: boolean) => void;
  onMessage: (s: string) => void;
}

const fmt = (n: number, d = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: d });
const CH_LABEL: Record<LabChannel, string> = {
  aileron: "Aileron", elevator: "Profundor", rudder: "Leme", flaps: "Flaps", spoiler: "Spoiler",
  gear: "Trem", throttle: "Potência", afterburner: "Pós-combustão", propeller: "Motor/Hélice",
  reverser: "Reverso", canopy: "Canopy", doors: "Portas", brake: "Freio", custom: "Independente",
};

const inputCls = "w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-200 outline-none focus:border-emerald-500";
const numCls = `${inputCls} text-right`;
const btn = "flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[9px] font-bold tracking-wide text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300";
const activeBtn = "border-emerald-400/70 bg-emerald-500/15 text-emerald-200";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[8px] font-bold tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export default function AnimationLab(p: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [manualVals, setManualVals] = useState<Record<string, number>>({});
  const [testKey, setTestKey] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const flatNodes = useMemo(() => p.nodes, [p.nodes]);
  const patch = (id: string, o: Partial<ArticulationDef>) => {
    p.onChange(p.lab.map((d) => (d.id === id ? { ...d, ...o } : d)));
  };
  const remove = (id: string) => p.onChange(p.lab.filter((d) => d.id !== id));
  const addCustom = () => {
    const d: ArticulationDef = {
      id: `art-manual-${Date.now()}`, label: "Nova articulação", channel: "custom",
      object: flatNodes[1]?.uuid ?? "", objectName: flatNodes[1]?.name ?? "",
      axis: [1, 0, 0], reverse: false, neutral: 0, min: -25, max: 25, slew: 8, gain: 25,
      pivot: null, autoPivot: true, enabled: true, manual: null, confidence: 0, source: "manual",
    };
    p.onChange([...p.lab, d]);
    setOpenIds((s) => new Set(s).add(d.id));
  };

  const applyPreset = (key: "fighter" | "airliner" | "propeller") => {
    const model = p.getModel();
    if (!model) return p.onMessage("Carregue um modelo antes de aplicar o preset.");
    p.onChange(presetArticulations(model, key));
    p.setPreset(key);
    p.onMessage(`Preset ${key === "fighter" ? "jato militar" : key === "airliner" ? "jato civil" : "hélice"} aplicado — revise cada articulação.`);
  };
  const autoDetect = () => {
    const model = p.getModel();
    if (!model) return p.onMessage("Carregue um modelo antes da detecção.");
    const found = suggestArticulations(model);
    p.onChange(found.length ? found : presetArticulations(model, "propeller"));
    p.setPreset("none");
    p.onMessage(`${found.length} articulações sugeridas por nome de nó — confira eixos e sentidos.`);
  };
  const setManual = (d: ArticulationDef, v: number) => {
    setManualVals((s) => ({ ...s, [d.id]: v }));
    p.getArt()?.setManual(d.id, v);
  };
  const clearManual = (d: ArticulationDef) => {
    setManualVals((s) => {
      const n = { ...s };
      delete n[d.id];
      return n;
    });
    p.getArt()?.setManual(d.id, null);
  };

  const runTest = (cmd: (typeof TEST_COMMANDS)[number]) => {
    const art = p.getArt();
    if (!art) return p.onMessage("Carregue um modelo e configure as articulações.");
    p.getArt()?.clearManuals();
    setManualVals({});
    if (testKey === cmd.key) {
      art.stopSequence();
      setTestKey(null);
      return;
    }
    art.playSequence(cmd.channels, cmd.key === "combo" ? 7 : 4.5, cmd.key === "combo");
    setTestKey(cmd.key);
    window.setTimeout(() => setTestKey((k) => (k === cmd.key ? null : k)), (cmd.key === "combo" ? 7 : 4.5) * 1000 + 80);
  };

  const togg = (id: string) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // --------------------------- seção A: clips ---------------------------
  const clipSection = (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-sky-300">
        <Cpu size={12} /> A · ANIMAÇÕES INCORPORADAS
        <span className="ml-auto font-mono text-[9px] text-slate-500">{p.clips.length} clip(s)</span>
      </div>
      {p.clips.length === 0 ? (
        <div className="rounded border border-slate-800 bg-slate-950/50 p-2 text-[9px] leading-4 text-slate-500">
          Este GLB não traz AnimationClips. Use as <b className="text-emerald-300">articulações procedurais</b> abaixo — funcionam sem animações originais.
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {p.clips.map((c, i) => (
              <button key={i} onClick={() => p.onSelectClip(i)}
                className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left font-mono text-[10px] ${p.clipIdx === i ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-200" : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-600"}`}>
                <span className="truncate">▶ {c.name}</span><span className="text-slate-500">{fmt(c.duration, 1)}s</span>
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            <button onClick={() => p.onSelectClip(p.clipIdx < 0 ? 0 : p.clipIdx)} className={btn} title="Reproduzir"><Play size={11} /></button>
            <button onClick={() => p.setClipPaused(!p.clipPaused)} className={`${btn} ${p.clipPaused ? activeBtn : ""}`} title="Pausar/retomar"><Pause size={11} /></button>
            <button onClick={() => { p.onSelectClip(p.clipIdx); }} className={btn} title="Reiniciar"><RotateCcw size={11} /></button>
            <button onClick={() => p.onStopClip()} className={btn} title="Parar"><Square size={11} /></button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => p.setClipLoop(!p.clipLoop)} className={`${btn} ${p.clipLoop ? activeBtn : ""}`} title="Loop">
              <Repeat size={11} /> LOOP
            </button>
            <label className="flex flex-1 items-center gap-1.5 font-mono text-[9px] text-slate-400">
              vel.
              <input type="range" min={0.1} max={2} step={0.1} value={p.speed} onChange={(e) => p.setSpeed(Number(e.target.value))} className="flex-1 accent-sky-400" />
              ×{fmt(p.speed, 1)}
            </label>
          </div>
        </>
      )}
    </section>
  );

  // --------------------------- seção B: articulações ---------------------------
  const articulationSection = (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-emerald-300">
        <SlidersHorizontal size={12} /> B · ARTICULAÇÕES PROCEDURAIS
        <span className="ml-auto font-mono text-[9px] text-slate-500">{p.lab.filter((d) => d.enabled && d.object).length}/{p.lab.length} ativas</span>
      </div>

      {/* presets */}
      <div className="mb-2 grid grid-cols-2 gap-1">
        <button onClick={() => applyPreset("fighter")} className={`${btn} ${p.preset === "fighter" ? activeBtn : ""}`}>✈ JATO MILITAR</button>
        <button onClick={() => applyPreset("airliner")} className={`${btn} ${p.preset === "airliner" ? activeBtn : ""}`}>🛫 JATO CIVIL</button>
        <button onClick={() => applyPreset("propeller")} className={`${btn} ${p.preset === "propeller" ? activeBtn : ""}`}>🌀 A HÉLICE</button>
        <button onClick={autoDetect} className={btn}><Wand2 size={11} /> AUTO-DETECTAR</button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button onClick={addCustom} className={`${btn} flex-1`}><Plus size={11} /> ADICIONAR</button>
        <button onClick={() => { p.onChange([]); p.setPreset("none"); p.getArt()?.stopSequence(); setTestKey(null); }} className={`${btn} flex-1`}><Trash2 size={11} /> LIMPAR</button>
        <button onClick={() => p.setShowPivots(!p.showPivots)} className={`${btn} flex-1 ${p.showPivots ? activeBtn : ""}`} title="Visualizar centro de rotação"><LocateFixed size={11} /> PIVÔS</button>
      </div>

      {p.lab.length === 0 && (
        <div className="rounded border border-dashed border-slate-700 bg-slate-950/50 p-3 text-center text-[9px] leading-4 text-slate-500">
          Nenhuma articulação configurada. Aplique um preset, use AUTO-DETECTAR (nomes como <code>Aileron_L</code>, <code>Rudder</code>, <code>Gear_Nose</code>) ou adicione manualmente.
        </div>
      )}

      <div className="space-y-1.5">
        {p.lab.map((d) => {
          const open = openIds.has(d.id);
          const manual = manualVals[d.id];
          const node = flatNodes.find((n) => n.uuid === d.object);
          return (
            <div key={d.id} className={`rounded-md border ${open ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-800 bg-slate-950/50"}`}>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button onClick={() => togg(d.id)} className="text-slate-500 hover:text-slate-200">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
                <button onClick={() => patch(d.id, { enabled: !d.enabled })} title={d.enabled ? "Desativar" : "Ativar"}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
                <button onClick={() => togg(d.id)} title="Expandir / recolher configuração"
                  className="min-w-0 flex-1 truncate text-left font-display text-[10px] font-bold text-slate-200 hover:text-amber-300">{d.label}</button>
                <span className="shrink-0 rounded bg-slate-800 px-1 font-mono text-[8px] text-sky-300">{CH_LABEL[d.channel]}</span>
                <span className={`shrink-0 font-mono text-[8px] ${d.confidence && d.confidence >= 0.9 ? "text-emerald-400" : "text-amber-400"}`}>
                  {d.confidence ? `${Math.round(d.confidence * 100)}%` : "?"}
                </span>
                <button onClick={() => remove(d.id)} className="shrink-0 text-slate-600 hover:text-red-400" title="Remover"><Trash2 size={10} /></button>
              </div>

              {open && (
                <div className="space-y-2 border-t border-slate-800 px-2 py-2">
                  {/* objeto + pai */}
                  <Row label={`OBJETO · PAI: ${node?.parent ?? "—"}`}>
                    <select value={d.object} onChange={(e) => {
                      const n = flatNodes.find((x) => x.uuid === e.target.value);
                      patch(d.id, { object: e.target.value, objectName: n?.name ?? "" });
                    }} className={inputCls}>
                      <option value="">— selecione um nó —</option>
                      {flatNodes.map((n) => <option key={n.uuid} value={n.uuid}>{n.name} ({n.kind})</option>)}
                    </select>
                    <input value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })} className={`${inputCls} mt-1`} aria-label="Nome da articulação" />
                  </Row>

                  {/* comando + escala */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Row label="COMANDO SBVS">
                      <select value={d.channel} onChange={(e) => patch(d.id, { channel: e.target.value as LabChannel })} className={inputCls}>
                        {STATE_CHANNELS.map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}
                      </select>
                    </Row>
                    <Row label="ESCALA (°)">
                      <input type="number" step={1} value={d.gain} onChange={(e) => patch(d.id, { gain: Number(e.target.value) })} className={numCls} />
                    </Row>
                  </div>

                  {/* eixo + sentido */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Row label="EIXO DE ROTAÇÃO">
                      <div className="flex gap-1">
                        {(["X", "Y", "Z"] as const).map((ax, i) => (
                          <button key={ax} onClick={() => {
                            const v: [number, number, number] = [0, 0, 0];
                            v[i] = 1;
                            patch(d.id, { axis: v });
                          }} className={`flex-1 rounded border py-1 font-mono text-[10px] font-bold ${d.axis[i] === 1 ? activeBtn : "border-slate-700 bg-slate-950 text-slate-400"}`}>{ax}</button>
                        ))}
                      </div>
                    </Row>
                    <Row label="SENTIDO">
                      <button onClick={() => patch(d.id, { reverse: !d.reverse })} className={`${btn} w-full ${d.reverse ? activeBtn : ""}`}>
                        {d.reverse ? "INVERTIDO" : "POSITIVO"}
                      </button>
                    </Row>
                  </div>

                  {/* neutro / min / max / slew */}
                  <div className="grid grid-cols-4 gap-1">
                    {(["neutral", "min", "max", "slew"] as const).map((k) => (
                      <Row key={k} label={k === "neutral" ? "NEUTRO°" : k === "slew" ? "ATUAÇÃO/s" : k === "min" ? "MÍN°" : "MÁX°"}>
                        <input type="number" step={k === "slew" ? 1 : 5} value={d[k]} onChange={(e) => patch(d.id, { [k]: Number(e.target.value) })} className={numCls} />
                      </Row>
                    ))}
                  </div>

                  {/* pivô */}
                  <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[8px] font-bold tracking-wider text-slate-500">PIVÔ / CENTRO DE ROTAÇÃO</span>
                      <button onClick={() => patch(d.id, { autoPivot: !d.autoPivot, pivot: d.autoPivot ? null : [0, 0, 0] })} className={`rounded border px-1.5 py-0.5 text-[8px] font-bold ${d.autoPivot ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-300" : "border-slate-700 text-slate-400"}`}>
                        {d.autoPivot ? "AUTO (bbox)" : "MANUAL"}
                      </button>
                    </div>
                    {!d.autoPivot && (
                      <div className="grid grid-cols-3 gap-1">
                        {([0, 1, 2] as const).map((i) => (
                          <Row key={i} label={["X", "Y", "Z"][i]}>
                            <input type="number" step={0.1} value={d.pivot?.[i] ?? 0}
                              onChange={(e) => {
                                const v: [number, number, number] = [d.pivot?.[0] ?? 0, d.pivot?.[1] ?? 0, d.pivot?.[2] ?? 0];
                                v[i] = Number(e.target.value);
                                patch(d.id, { pivot: v });
                              }} className={numCls} />
                          </Row>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[8px] leading-3 text-slate-600">
                      Grupo-pivô intermediário criado sem alterar a geometria original; pai preservado. Ative PIVÔS para ver o centro e o eixo no 3D.
                    </p>
                  </div>

                  {/* translação linear (trem) */}
                  <label className="flex items-center gap-2 text-[9px] text-slate-400">
                    <input type="checkbox" checked={!!d.translate} onChange={(e) => patch(d.id, { translate: e.target.checked ? { vector: [0, -1, 0], distance: 3 } : undefined })} className="accent-emerald-500" /> translação linear (amortecedor/trem) em vez de rotação
                  </label>

                  {/* slider manual */}
                  <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5">
                    <div className="mb-1 flex items-center justify-between font-mono text-[9px]">
                      <span className="text-slate-500">TESTE MANUAL</span>
                      <span className="text-amber-300">{manual === undefined ? "AUTO (comando)" : `${fmt(manual * 100)}%`}</span>
                    </div>
                    <input type="range" min={-1} max={1} step={0.02} value={manual ?? 0}
                      onChange={(e) => setManual(d, Number(e.target.value))} className="w-full accent-amber-400" />
                    <div className="mt-1 grid grid-cols-4 gap-1">
                      {([[-1, "-100%"], [-0.5, "-50%"], [0, "NEUTRO"], [1, "+100%"]] as [number, string][]).map(([v, l]) => (
                        <button key={l} onClick={() => setManual(d, v)} className={btn}>{l}</button>
                      ))}
                    </div>
                    {manual !== undefined && (
                      <button onClick={() => clearManual(d)} className={`${btn} mt-1 w-full`}>VOLTAR AO COMANDO</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  // --------------------------- seção C: testes ---------------------------
  const testSection = (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-amber-300">
        <CirclePlay size={12} /> C · TESTES DE MOVIMENTO
      </div>
      <div className="grid grid-cols-2 gap-1">
        {TEST_COMMANDS.map((c) => (
          <button key={c.key} onClick={() => runTest(c)}
            className={`${btn} ${testKey === c.key ? "border-amber-400 bg-amber-500/15 text-amber-200" : ""}`}>
            {testKey === c.key ? <Square size={10} /> : <Play size={10} />}{c.label.replace("TESTAR ", "").replace("SEQUÊNCIA ", "")}
          </button>
        ))}
      </div>
      {testKey && (
        <button onClick={() => { p.getArt()?.stopSequence(); setTestKey(null); }} className={`${btn} mt-1 w-full`}>PARAR TESTES</button>
      )}
      <p className="mt-1.5 text-[8px] leading-3.5 text-slate-500">
        Ailerons: esquerdo sobe / direito desce conforme o mapeamento (sentido ajustável). O sistema não assume eixos universais — calibre cada articulação. Movimentos combinados executam todos os canais em sequência.
      </p>
    </section>
  );

  const guide = (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
      <button onClick={() => setShowGuide(!showGuide)} className="flex w-full items-center justify-between text-[10px] font-bold tracking-widest text-slate-300">
        <span className="flex items-center gap-1.5"><Layers3 size={12} /> GRUPOS SUPORTADOS ({LAB_GROUPS.length})</span>
        {showGuide ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {showGuide && (
        <div className="mt-2 flex flex-wrap gap-1">
          {LAB_GROUPS.map((g) => (
            <span key={g.key} className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] text-slate-300" title={`${g.label} · ${CH_LABEL[g.channel]} · eixo ${g.axis.join(",")}`}>{g.label}</span>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-2.5">
      {clipSection}
      {articulationSection}
      {testSection}
      {guide}
      <section className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-emerald-300"><Save size={12} /> CONFIGURAÇÃO DA SESSÃO</div>
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => p.onSave(false)} className={`${btn} ${activeBtn}`}><Save size={11} /> SALVAR SESSÃO</button>
          <button onClick={() => p.onSave(true)} className={btn}><Gauge size={11} /> USAR NA SIMULAÇÃO</button>
        </div>
        <p className="mt-1.5 text-[8px] leading-3.5 text-slate-500">
          A config fica em sessão/localStorage e é lida por <code>visual.ts</code> — o mesmo <code>ArticulationEngine</code> recebe os estados do motor de voo na simulação. Nenhuma física é criada aqui.
        </p>
      </section>
    </div>
  );
}
