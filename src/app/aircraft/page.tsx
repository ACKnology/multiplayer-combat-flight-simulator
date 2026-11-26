"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plane, Boxes, ArrowLeft, FileJson, Image as ImageIcon, Wrench, Upload } from "lucide-react";
import { safeListAircraft, modelUrl, type RegistryEntry } from "@/lib/aircraft/registry";
import AircraftInspector from "@/components/AircraftInspector";

export const dynamic = "force-dynamic";

export default function AircraftDemoPage() {
  const [list, setList] = useState<RegistryEntry[]>([]);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [openInspector, setOpenInspector] = useState(false);
  const [importMode, setImportMode] = useState(false);

  useEffect(() => {
    setList(safeListAircraft());
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-black tracking-widest text-slate-100">CATÁLOGO DE AERONAVES GLB</h1>
            <p className="mt-1 text-[11px] text-slate-500">
              Sistema universal de aeronaves (GLB) · carregamento, articulação, descoberta e liveries.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelected(null);
                setImportMode(true);
                setOpenInspector(true);
              }}
              className="flex items-center gap-2 rounded bg-amber-500 px-3 py-2 text-[11px] font-black tracking-wider text-slate-950 transition hover:bg-amber-400"
              title="Abrir o Inspector já no modo de importação local (GLB/GLTF do dispositivo, sem upload)"
            >
              <Upload size={13} /> IMPORTAR AERONAVE
            </button>
            <Link href="/" className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold tracking-wider text-slate-300 transition hover:border-amber-400 hover:text-amber-300">
              <ArrowLeft size={13} /> Hangar
            </Link>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-[250px_1fr]">
          {/* catálogo */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.2em] text-slate-400">
              <Plane size={13} className="text-amber-300" /> AERONAVES DISPONÍVEIS
            </h2>
            <div className="space-y-2">
              {list.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    selected?.id === a.id
                      ? "border-amber-400/70 bg-amber-400/10"
                      : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-display text-sm font-bold ${selected?.id === a.id ? "text-amber-300" : "text-slate-100"}`}>{a.name}</span>
                    <span className="text-[9px] text-slate-500">{a.category}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{a.manufacturer} · {a.model}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                    <span className={`rounded px-1.5 py-0.5 ${a.origin === "glb" ? "bg-sky-900/50 text-sky-300" : "bg-emerald-900/50 text-emerald-300"}`}>{a.origin === "glb" ? "GLB" : "PROC"}</span>
                    {(a.liveries ?? []).map((l) => (
                      <span key={l} className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-300">{l}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-2 text-[9px] leading-4 text-slate-500">
              Para adicionar uma aeronave: crie <code>/public/aircraft/&lt;id&gt;/</code> com <code>model.glb</code>, <code>aircraft.json</code> e <code>liveries/</code>, importe o manifesto em <code>src/lib/aircraft/manifest.ts</code> e abra o Inspector.
            </div>
          </div>

          {/* detalhes */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            {!selected ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-slate-500">
                <Boxes size={40} className="mb-3 text-slate-600" />
                <div className="font-display text-sm font-bold tracking-widest text-slate-400">SELECIONE UMA AERONAVE</div>
                <p className="mt-1 max-w-sm text-[11px]">Escolha um modelo na lista para carregar a GLB, inspecionar a hierarquia e testar as articulações.</p>
                <button onClick={() => { setImportMode(true); setOpenInspector(true); }} className="mt-4 rounded bg-emerald-600 px-4 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-500">
                  ou importar um arquivo GLB/GLTF do dispositivo →
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <div className="font-display text-xl font-black text-slate-100">{selected.name}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{selected.manufacturer} · {selected.model} · {selected.variant}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-slate-500">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5">ID: {selected.id}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5">{selected.category}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5">{selected.origin === "glb" ? `${selected.config?.units.length} · ${selected.config?.units.angles}` : "procedural (m · graus)"}</span>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">
                      <span className="mr-1 font-mono text-slate-400">Licença:</span> {selected.license.license} — {selected.license.author}
                    </div>
                  </div>
                  <button
                    onClick={() => setOpenInspector(true)}
                    className="flex h-9 items-center gap-1.5 rounded bg-emerald-600 px-3 text-[11px] font-bold text-white transition hover:bg-emerald-500"
                  >
                    <Wrench size={13} /> ABRIR INSPECTOR
                  </button>
                </div>

                {/* preview simples do modelo (garante que a GLB carrega) */}
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_240px]">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                    <div className="mb-2 text-[10px] font-bold tracking-widest text-slate-500">COMPONENTES CONFIGURADOS {selected.origin === "procedural" ? "(PROCEDURAL — animados pelo motor)" : "(GLB)"}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] md:grid-cols-3">
                      {Object.entries(selected.config?.components ?? {}).map(([k, v]) => {
                        const spec = Array.isArray(v) ? v[0] : v;
                        return (
                          <div key={k} className="flex items-center justify-between rounded bg-slate-900 px-2 py-1">
                            <span className="text-slate-400">{k}</span>
                            <span className="font-mono text-slate-300">{spec?.node ?? "—"}</span>
                          </div>
                        );
                      })}
                      {Object.keys(selected.config?.components ?? {}).length === 0 && <div className="text-slate-500">Nenhum componente mapeado na config GLB. {selected.origin === "procedural" ? "Aeronaves procedurais são animadas pelo motor de voo." : "Use o Inspector."}</div>}
                    </div>
                    <div className="mt-3 text-[10px] font-bold tracking-widest text-slate-500">CAPACIDADES {selected.origin === "glb" ? "(VISUAIS — do manifesto GLB)" : "(DA AERONAVE PROCEDURAL)"}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {Object.entries(selected.config?.manifest?.features ?? (selected.origin === "procedural" ? { motor: true, luzes: true, spoiler: true, trem: true } : {})).map(([k, v]) => (
                        <span key={k} className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${v ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-600"}`}>{k}</span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-[10px] leading-4 text-slate-400">
                      <div className="mb-1 flex items-center gap-1 font-bold tracking-wider text-slate-300"><FileJson size={11} /> CONFIGURAÇÃO</div>
                      <code className="block rounded bg-slate-950 px-2 py-1 text-[9px] text-emerald-300">/aircraft/{selected.id}/aircraft.json</code>
                      <div className="mb-1 mt-2 flex items-center gap-1 font-bold tracking-wider text-slate-300"><ImageIcon size={11} /> MODELO</div>
                      <code className="block truncate rounded bg-slate-950 px-2 py-1 text-[9px] text-emerald-300" title={modelUrl(selected) ?? ""}>{modelUrl(selected) ?? "geometria procedural (src/sim/models.ts)"}</code>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-[10px] text-slate-400">
                      <div className="mb-1 font-bold tracking-wider text-slate-300">LIVERIES ({(selected.liveries ?? []).length})</div>
                      <div className="space-y-1">
                        {(selected.liveries ?? []).map((l) => (
                          <div key={l} className="rounded bg-slate-950 px-2 py-1 font-mono text-[9px] text-slate-300">{l}</div>
                        ))}
                        {(selected.liveries ?? []).length === 0 && <div className="text-slate-600">nenhuma</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {openInspector && (
        <AircraftInspector
          key={importMode ? "import" : selected?.id ?? "none"}
          entry={importMode ? null : selected}
          startLocal={importMode}
          onClose={() => {
            setOpenInspector(false);
            setImportMode(false);
          }}
        />
      )}
    </div>
  );
}
