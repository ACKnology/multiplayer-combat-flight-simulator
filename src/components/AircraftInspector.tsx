"use client";
/**
 * AircraftInspector — visualizador e analisador de aeronaves:
 *  - entradas do Registry (procedurais e GLB do servidor)
 *  - importação LOCAL de GLB/GLTF (arquivos do computador/celular, sem upload)
 * Câmera orbital com predefinições, perspectiva/ortográfica, modos de exibição,
 * iluminação/ambiente, hierarquia com visibilidade, seleção destacada, stats
 * geométricas com calibração de escala, inspeção PBR com thumbnails de texturas,
 * laboratório de animações e descarte rigoroso de recursos ao trocar de modelo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { safeListAircraft, checkAvailability, modelUrl, type RegistryEntry } from "@/lib/aircraft/registry";
import { buildProceduralVisual, buildGlbVisual, type AircraftVisualInstance } from "@/lib/aircraft/visual";
import { inspectionOf, type InspectionResult } from "@/lib/aircraft/discovery";
import type { ControlChannel, DiscoveryStatus } from "@/lib/aircraft/types";
import {
  importFiles, disposeImported, computeStats, autoUnitFactor, materialTextureSlots,
  type ModelStats, type ImportResult,
} from "@/lib/aircraft/glbImport";
import {
  X, Play, Square, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, Crosshair, Boxes, Wrench,
  Upload, Download, Trash2, Eye, EyeOff, Camera, Lightbulb, Grid3x3, SunMedium, Film, Gauge, FolderOpen,
} from "lucide-react";
import {
  ArticulationEngine, suggestArticulations, loadLabSession, saveLabSession, toArticulationState,
  type ArticulationDef, type LabConfig,
} from "@/lib/aircraft/articulation";
import AnimationLab from "./AnimationLab";

interface Props {
  entry?: RegistryEntry | null;
  /** abre direto no importador local (botão "Importar aeronave") */
  startLocal?: boolean;
  onClose: () => void;
}

interface ChannelRow {
  channel: ControlChannel;
  node: string | null;
  confidence: number;
  status: DiscoveryStatus;
  source: string;
}
type DisplayMode = "original" | "wireframe" | "normals" | "neutral" | "texture";
type ViewPreset = "persp" | "front" | "rear" | "left" | "right" | "top";
interface TreeNode {
  name: string; id: string; kind: string; mesh: boolean; triangles: number; visible: boolean; children: TreeNode[];
}

const STATUS_COLOR: Record<DiscoveryStatus, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-300",
  probable: "bg-amber-500/20 text-amber-300",
  ambiguous: "bg-orange-500/20 text-orange-300",
  unidentified: "bg-slate-700/60 text-slate-400",
};

const fmt = (n: number, d = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d });

function kindOf(o: THREE.Object3D): string {
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) return "SkinnedMesh";
  if ((o as THREE.Bone).isBone) return "Bone";
  if ((o as THREE.Mesh).isMesh) return "Mesh";
  if ((o as THREE.Camera).isCamera) return "Camera";
  if ((o as THREE.Light).isLight) return "Luz";
  if ((o as THREE.Group).isGroup) return o.type === "Scene" ? "Scene" : "Grupo";
  return o.type;
}

/** thumbnail 64px do mapa de uma textura (image decodificada) */
function Thumb({ tex }: { tex: THREE.Texture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
    if (!cv || !img) return;
    const w = (img as HTMLImageElement).width ?? (img as ImageBitmap).width ?? 0;
    const h = (img as HTMLImageElement).height ?? (img as ImageBitmap).height ?? 0;
    if (!w || !h) return;
    const S = 64;
    cv.width = S; cv.height = S;
    const c = cv.getContext("2d");
    if (!c) return;
    c.fillStyle = "#0b1220";
    c.fillRect(0, 0, S, S);
    const s = Math.min(S / w, S / h);
    try {
      c.drawImage(img as CanvasImageSource, (S - w * s) / 2, (S - h * s) / 2, w * s, h * s);
    } catch {
      /* formato não desenhável */
    }
  }, [tex]);
  const has = Boolean((tex.image as { width?: number } | undefined)?.width);
  return <canvas ref={ref} className={`h-16 w-16 rounded border border-slate-700 bg-slate-900 ${has ? "" : "opacity-30"}`} />;
}

export default function AircraftInspector({ entry, startLocal, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const hdrInputRef = useRef<HTMLInputElement | null>(null);

  type Engine = {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    persp: THREE.PerspectiveCamera;
    ortho: THREE.OrthographicCamera;
    active: "persp" | "ortho";
    controls: OrbitControls;
    key: THREE.DirectionalLight;
    amb: THREE.AmbientLight;
    hemi: THREE.HemisphereLight;
    rim: THREE.DirectionalLight;
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
    shadowPlane: THREE.Mesh;
    model: THREE.Object3D | null;
    visual: AircraftVisualInstance | null;
    disposeModel: (() => void) | null;
    box: THREE.Box3 | null;
    highlight: THREE.BoxHelper | null;
    selUuid: string | null;
    mixer: THREE.AnimationMixer | null;
    action: THREE.AnimationAction | null;
    clock: THREE.Clock;
    originals: Map<string, THREE.Material | THREE.Material[]>;
    subs: { normal: THREE.MeshNormalMaterial; neutral: THREE.MeshStandardMaterial; basic: Map<string, THREE.MeshBasicMaterial> };
    pmrem: THREE.PMREMGenerator | null;
    envRT: THREE.WebGLRenderTarget | null;
    raf: number;
    hostW: () => number;
    hostH: () => number;
    clips: THREE.AnimationClip[];
    art: ArticulationEngine | null;
    clipSpeed: number;
    clipPaused: boolean;
    clipLoop: boolean;
    testIv: number;
    testChannel: ControlChannel | null;
    testT: number;
    state: { rollIn: number; pitchIn: number; yawIn: number; flaps: number; spoilerPos: number; gearDown: boolean; propAngle: number };
  };
  const engineRef = useRef<Engine | null>(null);

  const [catalog] = useState<RegistryEntry[]>(() => safeListAircraft());
  const [selectedId, setSelectedId] = useState<string>(entry?.id ?? catalog[0]?.id ?? "");
  const selected = useMemo(() => catalog.find((c) => c.id === selectedId) ?? null, [catalog, selectedId]);
  const [mode, setMode] = useState<"registry" | "local">(startLocal && (entry === null || entry === undefined) ? "local" : "registry");
  useEffect(() => {
    if (startLocal) setMode("local");
  }, [startLocal]);

  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [loadStage, setLoadStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragOn, setDragOn] = useState(false);

  const [report, setReport] = useState<InspectionResult | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ControlChannel | null>(null);
  const [testing, setTesting] = useState(false);
  const [assetAvailable, setAssetAvailable] = useState<boolean | null>(null);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selNode, setSelNode] = useState<{ uuid: string; name: string; kind: string } | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [calib, setCalib] = useState(1);
  const [unitNote, setUnitNote] = useState("");

  const [display, setDisplay] = useState<DisplayMode>("original");
  const [ortho, setOrtho] = useState(false);
  const [bg, setBg] = useState<"dark" | "light" | "grid">("dark");
  const [ambient, setAmbient] = useState(0.65);
  const [keyI, setKeyI] = useState(2.2);
  const [shadows, setShadows] = useState(true);
  const [envOn, setEnvOn] = useState(false);
  const [clips, setClips] = useState<{ name: string; duration: number }[]>([]);
  const [clipIdx, setClipIdx] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [matInfo, setMatInfo] = useState<{ name: string; type: string; color: string; metal: number | null; rough: number | null; opacity: number; transparent: boolean; slots: { slot: string; size: string }[] }[]>([]);
  const [localName, setLocalName] = useState<string | null>(null);

  const [tab, setTab] = useState<"hier" | "mats" | "anims" | "lab">("hier");

  // ---------------- laboratório de animações / articulações (PRD 02) ----------------
  const [lab, setLab] = useState<ArticulationDef[]>([]);
  const [labPreset, setLabPreset] = useState<LabConfig["preset"]>("none");
  const [labSessionId, setLabSessionId] = useState("");
  const [clipPaused, setClipPaused] = useState(false);
  const [clipLoop, setClipLoop] = useState(true);
  const [showPivots, setShowPivots] = useState(false);
  const [labMsg, setLabMsg] = useState<string | null>(null);
  const [manualT, setManualT] = useState(0);
  void manualT;


  // ---------------- engine persistente (monta 1×) ----------------
  useEffect(() => {
    const hostEl = document.createElement("div");
    hostEl.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    hostRef.current?.appendChild(hostEl);
    canvasHostRef.current = hostEl;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;";
    hostEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const amb = new THREE.AmbientLight(0xbfd6ff, 0.65);
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a3426, 0.5);
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(8, 14, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const ksc = key.shadow.camera;
    ksc.left = -20; ksc.right = 20; ksc.top = 20; ksc.bottom = -20; ksc.near = 1; ksc.far = 80;
    const rim = new THREE.DirectionalLight(0x66aaff, 0.8);
    rim.position.set(-8, 4, -7);
    scene.add(amb, hemi, key, key.target, rim);
    const grid = new THREE.GridHelper(60, 60, 0x334155, 0x1e293b);
    scene.add(grid);
    const axes = new THREE.AxesHelper(3);
    scene.add(axes);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.32 })
    );
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 800);
    persp.position.set(14, 6, 14);
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 800);
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.target.set(0, 1.4, 0);

    const e: Engine = {
      renderer, scene, persp, ortho, active: "persp", controls, key, amb, hemi, rim, grid, axes, shadowPlane,
      model: null, visual: null, disposeModel: null, box: null, highlight: null, selUuid: null,
      mixer: null, action: null, clock: new THREE.Clock(),
      originals: new Map(),
      subs: {
        normal: new THREE.MeshNormalMaterial(),
        neutral: new THREE.MeshStandardMaterial({ color: 0xd6d9de, roughness: 0.92, metalness: 0.02 }),
        basic: new Map(),
      },
      pmrem: null, envRT: null, raf: 0, testIv: 0, testChannel: null, testT: 0, hostW: () => 1, hostH: () => 1, clips: [],
      art: null, clipSpeed: 1, clipPaused: false, clipLoop: true,
      state: { rollIn: 0, pitchIn: 0, yawIn: 0, flaps: 0, spoilerPos: 0, gearDown: true, propAngle: 0 },
    };
    engineRef.current = e;
    (window as unknown as { __insp?: Engine }).__insp = e; // gancho p/ testes de memória

    const resize = () => {
      const w = hostEl.clientWidth || 1;
      const h = hostEl.clientHeight || 1;
      renderer.setSize(w, h, false);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      const hs = (ortho.top - ortho.bottom) / 2;
      ortho.left = -hs * (w / h);
      ortho.right = hs * (w / h);
      ortho.updateProjectionMatrix();
    };
    resize();
    e.hostW = () => hostEl.clientWidth || 1;
    e.hostH = () => hostEl.clientHeight || 1;
    window.addEventListener("resize", resize);

    const loop = () => {
      e.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, e.clock.getDelta());
      e.controls.update();
      if (e.mixer && e.action && !e.clipPaused) e.mixer.update(dt * e.clipSpeed);
      if (e.art) {
        const st = e.state;
        e.art.update(dt, toArticulationState({
          rollIn: st.rollIn, pitchIn: st.pitchIn, yawIn: st.yawIn,
          flaps: st.flaps, spoilerPos: st.spoilerPos, gearPos: st.gearDown ? 1 : 0,
          gearDown: st.gearDown, eng: 0, propAngle: st.propAngle,
        }));
      }

      if (e.visual) {
        if (e.testChannel) {
          const st = e.state;
          e.visual.update(1 / 60, {
            pitchIn: st.pitchIn, rollIn: st.rollIn, yawIn: st.yawIn, flaps: st.flaps, spoilerPos: st.spoilerPos,
            gearPos: st.gearDown ? 1 : 0, gearMoving: true, gearDown: st.gearDown, eng: 0,
            propAngle: st.propAngle, mainRotorAngle: st.propAngle, tailRotorAngle: st.propAngle,
            navLights: true, beacon: true, strobe: false, landing: false,
          });
        }
      }
      if (e.highlight && e.selUuid) e.highlight.setFromObject(e.scene.getObjectByProperty("uuid", e.selUuid) ?? e.scene);
      renderer.render(scene, e.active === "persp" ? persp : ortho);
    };
    loop();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(e.raf);
      if (e.testIv) window.clearInterval(e.testIv);
      e.controls.dispose();
      e.art?.dispose();
      e.subs.basic.forEach((m) => m.dispose());
      e.subs.normal.dispose();
      e.subs.neutral.dispose();
      e.envRT?.dispose();
      e.pmrem?.dispose();
      shadowPlane.geometry.dispose();
      (shadowPlane.material as THREE.Material).dispose();
      grid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      hostEl.remove();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- enquadramento e predefinições ----------------
  const frame = useCallback((preset: ViewPreset = "persp") => {
    const e = engineRef.current;
    if (!e || !e.box) return;
    const c = e.box.getCenter(new THREE.Vector3());
    const r = Math.max(0.6, e.box.getBoundingSphere(new THREE.Sphere()).radius);
    const d = r * 2.7;
    const places: Record<ViewPreset, [number, number, number]> = {
      persp: [c.x + d * 0.72, c.y + r * 0.85, c.z + d * 0.72],
      front: [c.x, c.y + r * 0.08, c.z - d],
      rear: [c.x, c.y + r * 0.08, c.z + d],
      left: [c.x - d, c.y + r * 0.08, c.z],
      right: [c.x + d, c.y + r * 0.08, c.z],
      top: [c.x, c.y + d, c.z + 0.0001],
    };
    e.controls.target.copy(c);
    const p = places[preset];
    e.persp.position.set(p[0], p[1], p[2]);
    e.ortho.position.set(p[0], p[1], p[2]);
    const hs = r * 1.45;
    e.ortho.top = hs; e.ortho.bottom = -hs;
    const asp = (e.hostW() || 1) / (e.hostH() || 1);
    e.ortho.left = -hs * asp; e.ortho.right = hs * asp;
    e.ortho.updateProjectionMatrix();
    e.persp.updateProjectionMatrix();
    e.controls.update();
  }, []);

  // ---------------- display modes ----------------
  const applyDisplay = useCallback((m: DisplayMode) => {
    const e = engineRef.current;
    if (!e || !e.model) return;
    e.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const orig = e.originals.get(mesh.uuid) ?? mesh.material;
      if (m === "original") {
        mesh.material = orig;
        const list = Array.isArray(orig) ? orig : [orig];
        for (const mm of list) (mm as THREE.MeshStandardMaterial).wireframe = false;
      } else if (m === "wireframe") {
        mesh.material = orig;
        const list = Array.isArray(orig) ? orig : [orig as THREE.Material];
        for (const mm of list) (mm as THREE.MeshStandardMaterial).wireframe = true;
      } else if (m === "normals") {
        mesh.material = e.subs.normal;
      } else if (m === "neutral") {
        mesh.material = e.subs.neutral;
      } else {
        const src = (Array.isArray(orig) ? orig[0] : orig) as THREE.MeshStandardMaterial;
        const key = src?.uuid ?? "none";
        let basic = e.subs.basic.get(key);
        if (!basic) {
          basic = new THREE.MeshBasicMaterial({ map: src?.map ?? null, color: src?.map ? 0xffffff : (src?.color ?? new THREE.Color(0x888888)) });
          e.subs.basic.set(key, basic);
        }
        mesh.material = basic;
      }
    });
  }, []);

  // ---------------- carregar modelo do Registry ----------------
  const loadRegistry = useCallback(async () => {
    const e = engineRef.current;
    if (!e || !selected) return;
    setLoading(true);
    setError(null);
    setWarnings([]);
    setReport(null);
    setChannels([]);
    setSelectedChannel(null);
    setLocalName(null);
    setClipIdx(-1);
    setAssetAvailable(selected.origin === "procedural" ? true : null);
    try {
      const available = await checkAvailability(selected);
      setAssetAvailable(available);
      let visual: AircraftVisualInstance;
      if (selected.origin === "glb" && selected.config && available) visual = await buildGlbVisual(selected.config, { modelLengthMeters: 14 });
      else if (selected.origin === "glb") visual = buildProceduralVisual(selected.config?.manifest?.aircraftId === "c172" ? "c172" : "b737");
      else visual = buildProceduralVisual(selected.specId ?? selected.id);
      const prev = e.disposeModel;
      e.model = visual.group;
      e.visual = visual;
      e.disposeModel = () => {
        prev?.();
        try { visual.dispose(); } catch { /* noop */ }
        e.scene.remove(visual.group);
      };
      e.scene.add(visual.group);
      const box = new THREE.Box3().setFromObject(visual.group);
      e.box = box;
      e.shadowPlane.position.y = box.min.y - 0.02;
      frame("persp");
      const res = inspectionOf(visual.group, [], selected.id);
      setReport(res);
      setChannels(res.components.map((c): ChannelRow => ({ channel: c.channel, node: c.node, confidence: c.confidence, status: c.status, source: c.source })));
      setTree(buildTree(visual.group));
      const st = computeStats(visual.group);
      setStats(st);
      const au = autoUnitFactor(st);
      setCalib(1);
      setUnitNote(au.guessed);
      setMatInfo(collectMats(visual.group));
      setupLab(e, selected.id, visual.group);
      setClips([]);
      e.clips = [];
      e.mixer = null;
      e.action = null;
      reindex(e);
      applyDisplay(display);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, frame, applyDisplay, display]);

  // ---------------- importar arquivo local ----------------
  const importLocal = useCallback(
    async (files: File[]) => {
      const e = engineRef.current;
      if (!e || !files.length) return;
      setLoading(true);
      setError(null);
      setWarnings([]);
      setLoadPct(0);
      setLoadStage("validando…");
      try {
        const res: ImportResult = await importFiles(files, (p, stage) => {
          setLoadPct(Math.round(p));
          setLoadStage(stage);
        });
        setWarnings(res.warnings);
        // descarta anterior
        const prev = e.disposeModel;
        prev?.();
        e.visual = null;
        e.model = res.root;
        e.scene.add(res.root);
        e.disposeModel = () => {
          disposeImported(res.root);
          res.urls.length = 0;
        };
        const box = new THREE.Box3().setFromObject(res.root);
        e.box = box;
        e.shadowPlane.position.y = box.min.y - 0.02;
        frame("persp");
        setLocalName(res.name);
        setTree(buildTree(res.root));
        const st = computeStats(res.root);
        setStats(st);
        const au = autoUnitFactor(st);
        setCalib(au.factor);
        setUnitNote(au.guessed);
        setMatInfo(collectMats(res.root));
        setClips(res.clips.map((c) => ({ name: c.name || "(sem nome)", duration: c.duration })));
        e.clips = res.clips;
        e.mixer = res.clips.length ? new THREE.AnimationMixer(res.root) : null;
        e.action = null;
        setClipIdx(-1);
        const rep = inspectionOf(res.root, res.clips, "importado");
        setReport(rep);
        setChannels(rep.components.map((c): ChannelRow => ({ channel: c.channel, node: c.node, confidence: c.confidence, status: c.status, source: c.source })));
        setupLab(e, `imported:${res.name}`, res.root);
        reindex(e);
        applyDisplay(display);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadStage("");
      }
    },
    [frame, applyDisplay, display]
  );

  // reindexa materiais originais após troca de modelo
  function reindex(e: Engine) {
    e.originals.clear();
    e.subs.basic.clear();
    if (!e.model) return;
    e.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) e.originals.set(m.uuid, m.material);
    });
  }
  /** Instala o mesmo mecanismo de articulação usado pela simulação. */
  function setupLab(e: Engine, id: string, root: THREE.Object3D) {
    e.art?.dispose();
    const art = new ArticulationEngine(root);
    const saved = loadLabSession(id);
    const defs = saved?.articulations.length
      ? saved.articulations
      : suggestArticulations(root);
    art.setDefs(defs);
    e.art = art;
    setLab(defs);
    setLabPreset(saved?.preset ?? "none");
    setLabSessionId(id);
    if (saved?.clip) {
      setSpeed(saved.clip.speed);
      setClipLoop(saved.clip.loop);
      setClipIdx(saved.clip.idx);
    }
    if (saved) setLabMsg(`Configuração de sessão restaurada (${saved.articulations.length} articulações).`);
    else if (defs.length) setLabMsg(`${defs.length} articulações sugeridas por nome de nó — calibre eixos/sentidos no LABORATÓRIO.`);
  }

  function buildTree(root: THREE.Object3D): TreeNode[] {
    const conv = (o: THREE.Object3D): TreeNode => {
      const mesh = o as THREE.Mesh;
      return {
        name: o.name || `(${o.type})`,
        id: o.uuid,
        kind: kindOf(o),
        mesh: Boolean(mesh.isMesh),
        triangles: mesh.isMesh && mesh.geometry ? Math.floor((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute("position")?.count ?? 0) / 3) : 0,
        visible: o.visible,
        children: o.children.map(conv),
      };
    };
    return [conv(root)];
  }
  function collectMats(root: THREE.Object3D) {
    const seen = new Map<string, { name: string; type: string; color: string; metal: number | null; rough: number | null; opacity: number; transparent: boolean; slots: { slot: string; size: string }[] }>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of list) {
        if (!mat || seen.has(mat.uuid)) continue;
        const s = mat as THREE.MeshStandardMaterial;
        seen.set(mat.uuid, {
          name: mat.name || "(sem nome)",
          type: (mat as { type?: string }).type ?? mat.constructor.name,
          color: s.color ? `#${s.color.getHexString()}` : "—",
          metal: typeof s.metalness === "number" ? s.metalness : null,
          rough: typeof s.roughness === "number" ? s.roughness : null,
          opacity: s.opacity ?? 1,
          transparent: Boolean(s.transparent),
          slots: materialTextureSlots(mat).map((x) => {
            const img = x.tex.image as { width?: number; height?: number } | undefined;
            return { slot: x.slot, size: img?.width ? `${img.width}×${img.height}` : "—" };
          }),
        });
      }
    });
    return [...seen.values()];
  }

  // efeito de carga do modo registry
  useEffect(() => {
    if (mode === "registry") void loadRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedId]);

  // seleção de câmera / controles reagem a toggles
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.active = ortho ? "ortho" : "persp";
    e.controls.object = ortho ? e.ortho : e.persp;
    e.controls.update();
  }, [ortho]);
  useEffect(() => {
    const e = engineRef.current;
    if (e) e.amb.intensity = ambient, e.hemi.intensity = Math.max(0, ambient - 0.15);
  }, [ambient]);
  useEffect(() => {
    const e = engineRef.current;
    if (e) e.key.intensity = keyI;
  }, [keyI]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.renderer.shadowMap.enabled = shadows;
    e.key.castShadow = shadows;
    e.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => (mm.needsUpdate = true));
    });
  }, [shadows]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.scene.background = new THREE.Color(bg === "light" ? 0xdfe7f0 : 0x0b1220);
    e.grid.visible = bg === "grid" || bg === "dark";
  }, [bg]);
  // estado do clip player → engine (evita closure stale dentro do loop)
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.clipSpeed = speed;
    e.clipPaused = clipPaused;
    e.clipLoop = clipLoop;
    if (e.action) {
      e.action.paused = clipPaused;
      e.action.setLoop(clipLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    }
  }, [speed, clipPaused, clipLoop]);

  // sincroniza defs do laboratório com o engine (estrutural → rebind; numérico → patch)
  useEffect(() => {
    const e = engineRef.current;
    const art = e?.art;
    if (!art) return;
    const ids = art.defs.map((d) => d.id);
    const next = lab.map((d) => d.id);
    if (ids.length !== next.length || ids.some((x, i) => x !== next[i])) {
      art.setDefs(lab);
    } else {
      for (const d of lab) art.patch(d.id, { ...d, manual: undefined });
    }
    art.showPivots(showPivots, e!.scene);
  }, [lab, showPivots]);

  // reinício de clipe, pausa e parada usados pelo laboratório
  const restartClip = () => {
    const e = engineRef.current;
    if (!e?.action) return;
    e.action.reset().play();
    e.action.paused = false;
    setClipPaused(false);
  };
  const stopClip = () => {
    const e = engineRef.current;
    e?.action?.stop();
    if (e) e.action = null;
    setClipIdx(-1);
  };
  const saveLab = (useInSim: boolean) => {
    const e = engineRef.current;
    if (!e?.art || !e.model) {
      setLabMsg("Carregue um modelo antes de salvar.");
      return;
    }
    const id = labSessionId || labSessionIdFromMode();
    const cfg = e.art.serialize(id, mode === "local" ? localName ?? "Importado" : selected?.name ?? id, { idx: clipIdx, speed, loop: clipLoop }, labPreset);
    saveLabSession({ ...cfg, aircraftId: id });
    if (useInSim && mode !== "local" && selected?.origin === "glb") {
      // chave que buildGlbVisual lê na simulação
      saveLabSession({ ...cfg, aircraftId: selected.id });
      setLabMsg(`Configuração aplicada à simulação para ${selected.id}. Recarregue o voo para ver as superfícies seguirem o motor.`);
      return;
    }
    setLabMsg(useInSim
      ? "Para usar na simulação, cadastre o GLB no Registry e abra esta aeronave pelo catálogo."
      : `Sessão salva: ${cfg.articulations.length} articulações (${id}).`);
  };
  const labSessionIdFromMode = () => (mode === "local" ? `imported:${localName ?? "modelo"}` : selectedId);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (!envOn) {
      e.scene.environment = null;
      return;
    }
    if (!e.pmrem) e.pmrem = new THREE.PMREMGenerator(e.renderer);
    if (!e.envRT) {
      const room = new RoomEnvironment();
      e.envRT = e.pmrem.fromScene(room, 0.04);
      room.dispose?.();
    }
    e.scene.environment = e.envRT.texture;
  }, [envOn]);
  useEffect(() => {
    applyDisplay(display);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, mode]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !e.model) return;
    e.model.scale.setScalar(Math.max(0.05, calib));
    const box = new THREE.Box3().setFromObject(e.model);
    e.box = box;
    e.shadowPlane.position.y = box.min.y - 0.02;
  }, [calib]);

  // ---------------- clip player ----------------
  const playClip = (idx: number) => {
    const e = engineRef.current;
    if (!e || !e.mixer) return;
    if (e.action) e.action.stop();
    if (idx < 0) {
      e.action = null;
      return;
    }
    const c = e.clips[idx];
    if (!c) return;
    setClipIdx(idx);
    e.action = e.mixer.clipAction(c);
    e.action.setLoop(e.clipLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    e.action.paused = e.clipPaused;
    e.action.reset().play();
  };

  // ---------------- drop/input ----------------
  const gatherFiles = async (dt: DataTransfer): Promise<File[]> => {
    const out: File[] = [];
    const items = dt.items ? Array.from(dt.items) : [];
    const entryOf = (it: DataTransferItem): (FileSystemEntry | null) =>
      typeof (it as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry === "function"
        ? (it as unknown as { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry()
        : null;
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        out.push(new File([f], entry.name, { type: f.type }));
        void prefix;
      } else if (entry.isDirectory) {
        const rd = (entry as FileSystemDirectoryEntry).createReader();
        for (;;) {
          let kids: FileSystemEntry[] = [];
          try {
            kids = await new Promise((res, rej) => rd.readEntries(res, rej));
          } catch {
            break;
          }
          if (!kids.length) break;
          for (const k of kids) await walk(k, prefix + entry.name + "/");
        }
      }
    };
    if (items.length && items.some((i) => i.kind === "file")) {
      for (const it of items) {
        const fe = entryOf(it);
        if (fe) await walk(fe, "");
        else if (it.getAsFile) {
          const f = it.getAsFile();
          if (f) out.push(f);
        }
      }
    } else if (dt.files) out.push(...Array.from(dt.files));
    return out;
  };

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDragOn(false);
    const files = await gatherFiles(ev.dataTransfer);
    if (files.length) {
      setMode("local");
      await importLocal(files);
    }
  };

  // persistência leve da última importação: não guarda (memória); ok.

  const closeAll = useCallback(() => {
    stopTest();
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  function stopTest() {
    const e = engineRef.current;
    if (e) {
      e.testChannel = null;
      if (e.testIv) window.clearInterval(e.testIv);
      e.testIv = 0;
    }
    setTesting(false);
  }
  const startTest = useCallback(() => {
    const e = engineRef.current;
    if (!e || !selectedChannel || !e.visual) return;
    e.testChannel = selectedChannel;
    e.testT = 0;
    setTesting(true);
    e.testIv = window.setInterval(() => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.testT += 0.016;
      const v = Math.sin(eng.testT * 2.2);
      switch (selectedChannel) {
        case "aileronLeft": case "aileronRight": eng.state.rollIn = v; break;
        case "elevator": eng.state.pitchIn = v; break;
        case "rudder": eng.state.yawIn = v; break;
        case "flapL": case "flapR": eng.state.flaps = Math.max(0, v); break;
        case "spoiler": case "speedbrake": eng.state.spoilerPos = Math.max(0, v); break;
        case "gear": case "gearLeft": case "gearRight": case "gearNose": case "gearDoor": eng.state.gearDown = v > 0; break;
        case "propeller": case "prop": case "mainRotor": case "tailRotor": eng.state.propAngle += 0.35; break;
      }
    }, 16);
  }, [selectedChannel]);

  const rerunDiscovery = useCallback(() => {
    const e = engineRef.current;
    if (!e || !e.model) return;
    const res = inspectionOf(e.model, [], mode === "local" ? "importado" : selectedId);
    setReport(res);
    setChannels(res.components.map((c): ChannelRow => ({ channel: c.channel, node: c.node, confidence: c.confidence, status: c.status, source: c.source })));
    setTree(buildTree(e.model));
    setMatInfo(collectMats(e.model));
    const st = computeStats(e.model);
    setStats(st);
  }, [mode, selectedId]);

  const flatNodes = useMemo(() => {
    const out: { uuid: string; name: string; kind: string; parent: string }[] = [];
    const walk = (n: TreeNode, parent: string) => {
      out.push({ uuid: n.id, name: n.name, kind: n.kind, parent });
      n.children.forEach((c) => walk(c, n.name));
    };
    tree.forEach((n) => walk(n, "scene"));
    return out;
  }, [tree]);

  const exportJson = useCallback(() => {
    const labCfg = engineRef.current?.art
      ? engineRef.current.art.serialize(labSessionId || selectedId, mode === "local" ? localName ?? "Importado" : selected?.name ?? selectedId, { idx: clipIdx, speed, loop: clipLoop }, labPreset)
      : null;
    const payload = {
      id: mode === "local" ? "imported-aircraft" : selectedId,
      name: mode === "local" ? localName ?? "Importado" : selected?.name,
      origin: mode === "local" ? "local-import" : "registry",
      category: selected?.category ?? "experimental",
      stats,
      displayScale: calib,
      unitNote,
      components: channels.map((c) => ({ channel: c.channel, node: c.node, status: c.status, confidence: +c.confidence.toFixed(2) })),
      materials: matInfo.map((m) => ({ name: m.name, type: m.type, metalness: m.metal, roughness: m.rough, maps: m.slots.map((s) => s.slot) })),
      animations: clips.map((c) => c.name),
      lab: labCfg,
      warnings,
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aircraft-config-${payload.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mode, selectedId, localName, selected, stats, calib, unitNote, channels, matInfo, clips, warnings, labSessionId, clipIdx, speed, clipLoop, labPreset]);

  // seleção na árvore ↔ highlight
  const selectNode = (id: string, name: string, kind: string) => {
    const e = engineRef.current;
    if (!e) return;
    if (e.selUuid === id) {
      e.selUuid = null;
      e.highlight?.removeFromParent();
      e.highlight = null;
      setSelNode(null);
      return;
    }
    const obj = e.scene.getObjectByProperty("uuid", id);
    if (!obj) return;
    e.selUuid = id;
    if (!e.highlight) {
      e.highlight = new THREE.BoxHelper(obj, 0xf59e0b);
      e.scene.add(e.highlight);
    } else {
      e.highlight.setFromObject(obj);
    }
    setSelNode({ uuid: id, name, kind });
  };
  const toggleVisible = (id: string) => {
    const e = engineRef.current;
    const obj = e?.scene.getObjectByProperty("uuid", id);
    if (obj) obj.visible = !obj.visible;
    setTree((t) => rebuild(t));
    function rebuild(list: TreeNode[]): TreeNode[] {
      return list.map((n) => ({
        ...n,
        visible: (e?.scene.getObjectByProperty("uuid", n.id) as { visible?: boolean } | undefined)?.visible ?? n.visible,
        children: rebuild(n.children),
      }));
    }
  };

  const toggleNode = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedObj = selNode ? engineRef.current?.scene.getObjectByProperty("uuid", selNode.uuid) ?? null : null;
  const tf = selectedObj
    ? {
        pos: selectedObj.position.toArray().map((n) => fmt(n, 2)),
        rot: [selectedObj.rotation.x, selectedObj.rotation.y, selectedObj.rotation.z].map((r) => fmt((r * 180) / Math.PI, 1)),
        scl: selectedObj.scale.toArray().map((n) => fmt(n, 3)),
      }
    : null;

  const dimM = stats ? (["x", "y", "z"] as const).map((i) => fmt(stats.size[i === "x" ? 0 : i === "y" ? 1 : 2] * calib, 2)) : null;

  const renderTree = (n: TreeNode, depth = 0): React.ReactNode => {
    const open = expanded.has(n.id) || depth < 1;
    const hasKids = n.children.length > 0;
    const isSel = selNode?.uuid === n.id;
    return (
      <div key={n.id} style={{ paddingLeft: depth * 10 }}>
        <div className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-mono transition ${isSel ? "bg-amber-400/15 ring-1 ring-amber-400/50" : "hover:bg-slate-800"}`}>
          <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => (hasKids ? toggleNode(n.id) : undefined)}>
            {hasKids ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : <span className="w-2.5" />}
          </button>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => selectNode(n.id, n.name, n.kind)}>
            <span className={n.mesh ? "text-emerald-300" : "text-slate-500"}>{n.name}</span>
            <span className="shrink-0 rounded bg-slate-800 px-1 text-[8px] text-slate-400">{n.kind}</span>
            {n.triangles > 0 && <span className="shrink-0 text-[8px] text-slate-600">{fmt(n.triangles)} tri</span>}
          </button>
          <button className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200" title={n.visible ? "Ocultar objeto" : "Exibir objeto"} onClick={() => toggleVisible(n.id)}>
            {n.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
        </div>
        {open && n.children.map((c) => renderTree(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950/97">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench size={15} className="shrink-0 text-amber-300" />
          <span className="font-display text-sm font-bold tracking-[0.2em] text-amber-300">INSPECTOR</span>
          <span className="truncate font-display text-sm font-bold text-slate-100">
            — {mode === "local" ? localName ?? "Importação local" : selected?.name}
          </span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${mode === "local" ? "bg-fuchsia-500/20 text-fuchsia-300" : "bg-emerald-500/10 text-emerald-300"}`}>
            {mode === "local" ? "ARQUIVO LOCAL" : "REGISTRY"}
          </span>
          {stats && (
            <span className="hidden shrink-0 font-mono text-[9px] text-slate-500 md:block">
              {fmt(stats.triangles)} tri · {fmt(stats.vertices)} verts · {stats.materials} mat.
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded bg-amber-500 px-3 py-1.5 text-[10px] font-black tracking-widest text-slate-950 transition hover:bg-amber-400"
            title="Selecionar .glb ou .gltf (+ .bin/texturas) do dispositivo — nada é enviado ao servidor"
          >
            <Upload size={12} /> IMPORTAR AERONAVE
          </button>
          {mode === "local" && (
            <>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-slate-300 hover:border-amber-400">
                <FolderOpen size={11} /> ABRIR ARQUIVO
              </button>
              <button
                onClick={() => {
                  const e = engineRef.current;
                  e?.art?.dispose();
                  e?.disposeModel?.();
                  if (e) {
                    e.model = null; e.visual = null; e.disposeModel = null; e.box = null; e.mixer = null; e.action = null; e.art = null; e.selUuid = null;
                    e.highlight?.removeFromParent(); e.highlight = null;
                  }
                  setStats(null); setTree([]); setClips([]); setMatInfo([]); setReport(null); setChannels([]); setLocalName(null); setSelNode(null); setLab([]); setShowPivots(false);
                }}
                className="flex items-center gap-1 rounded border border-red-800/70 bg-red-950/40 px-2 py-1.5 text-[10px] font-bold text-red-300 hover:border-red-500"
              >
                <Trash2 size={11} /> DESCARREGAR
              </button>
              <button
                onClick={() => {
                  const e = engineRef.current;
                  e?.art?.dispose();
                  e?.disposeModel?.();
                  if (e) { e.visual = null; e.model = null; e.disposeModel = null; e.art = null; e.highlight?.removeFromParent(); e.highlight = null; e.selUuid = null; }
                  setShowPivots(false);
                  setMode("registry");
                }}
                className="flex items-center gap-1 rounded border border-emerald-700 bg-emerald-950/40 px-2 py-1.5 text-[10px] font-bold text-emerald-300 hover:border-emerald-400"
              >
                <RefreshCw size={11} /> RESTAURAR PROCEDURAL
              </button>
            </>
          )}
          <button onClick={closeAll} className="rounded p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"><X size={16} /></button>
        </div>
      </div>

      {/* faixas: catálogo (registry) */}
      {mode === "registry" && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-950/80 px-4 py-2">
          <Boxes size={13} className="shrink-0 text-slate-500" />
          {catalog.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold transition ${
                selectedId === c.id ? "border-amber-400/70 bg-amber-400/10 text-amber-300" : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              {c.model || c.name}
              <span className={`ml-1.5 rounded px-1 text-[8px] ${c.origin === "glb" ? "bg-sky-900/60 text-sky-400" : "bg-emerald-900/60 text-emerald-400"}`}>{c.origin === "glb" ? "GLB" : "PROC"}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ------- viewport ------- */}
        <div
          ref={hostRef}
          className={`relative flex-1 bg-slate-950 ${dragOn ? "outline outline-2 -outline-offset-2 outline-amber-400" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (!dragOn) setDragOn(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOn(false); }}
          onDrop={(e) => void onDrop(e)}
        >
          {/* toolbar de visualização (topo do viewport) */}
          <div className="absolute left-2 right-2 top-2 z-10 flex flex-wrap items-center gap-1.5 text-[9px]">
            {(
              [
                ["persp", "PERSP"], ["front", "FRENTE"], ["rear", "TRÁS"], ["right", "DIR."], ["left", "ESQ."], ["top", "TOPO"],
              ] as [ViewPreset, string][]
            ).map(([p, l]) => (
              <button key={p} onClick={() => frame(p)} className="rounded border border-slate-700 bg-slate-950/85 px-2 py-1 font-bold text-slate-300 backdrop-blur hover:border-amber-400" title={`Vista ${l}`}>
                <Camera size={9} className="mr-1 inline" />
                {l}
              </button>
            ))}
            <button onClick={() => setOrtho((v) => !v)} className={`rounded border px-2 py-1 font-bold backdrop-blur ${ortho ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-slate-700 bg-slate-950/85 text-slate-300"}`} title="Alternar perspectiva ⇄ ortográfica">
              ORTO
            </button>
            <div className="mx-1 h-4 w-px bg-slate-700" />
            {(["original", "wireframe", "normals", "neutral", "texture"] as DisplayMode[]).map((d) => (
              <button key={d} onClick={() => setDisplay(d)} className={`rounded border px-2 py-1 font-bold uppercase backdrop-blur ${display === d ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : "border-slate-700 bg-slate-950/85 text-slate-400"}`}>
                {d === "original" ? "MATERIAL" : d === "texture" ? "TEXTURA" : d}
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-slate-700" />
            <button onClick={() => setBg(bg === "dark" ? "light" : bg === "light" ? "grid" : "dark")} className="rounded border border-slate-700 bg-slate-950/85 px-2 py-1 font-bold text-slate-300 backdrop-blur hover:border-amber-400" title="Fundo">
              <Grid3x3 size={9} className="mr-1 inline" />
              {bg.toUpperCase()}
            </button>
            <label className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/85 px-2 py-1 text-slate-300 backdrop-blur" title="Intensidade ambiente">
              <Lightbulb size={9} />
              <input type="range" min={0} max={2} step={0.05} value={ambient} onChange={(e) => setAmbient(Number(e.target.value))} className="w-14 accent-amber-400" />
            </label>
            <label className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/85 px-2 py-1 text-slate-300 backdrop-blur" title="Luz direcional">
              <SunMedium size={9} />
              <input type="range" min={0} max={4} step={0.1} value={keyI} onChange={(e) => setKeyI(Number(e.target.value))} className="w-14 accent-amber-400" />
            </label>
            <button onClick={() => setShadows((v) => !v)} className={`rounded border px-2 py-1 font-bold backdrop-blur ${shadows ? "border-emerald-400 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-950/85 text-slate-500"}`} title="Sombras">
              SOMBRAS
            </button>
            <button onClick={() => setEnvOn((v) => !v)} className={`rounded border px-2 py-1 font-bold backdrop-blur ${envOn ? "border-sky-400 bg-sky-500/15 text-sky-300" : "border-slate-700 bg-slate-950/85 text-slate-500"}`} title="Ambiente estúdio (HDRI procedural) — para PBR">
              HDRI
            </button>
            <button onClick={() => hdrInputRef.current?.click()} className="rounded border border-slate-700 bg-slate-950/85 px-2 py-1 font-bold text-slate-300 backdrop-blur hover:border-sky-400" title="Carregar um .hdr próprio como ambiente">
              .HDR
            </button>
            <div className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/85 px-2 py-1 text-slate-300 backdrop-blur" title="Calibração da escala de visualização (não altera o arquivo)">
              <Gauge size={9} />
              <input type="range" min={0.1} max={5} step={0.05} value={calib} onChange={(e) => setCalib(Number(e.target.value))} className="w-16 accent-amber-400" />
              <span className="font-mono text-[8px] text-amber-300">×{fmt(calib, 2)}</span>
            </div>
          </div>

          {/* dimensões */}
          {stats && dimM && (
            <div className="absolute bottom-2 left-2 z-10 rounded border border-slate-700 bg-slate-950/85 px-2.5 py-1.5 font-mono text-[9px] leading-4 text-slate-300 backdrop-blur">
              <span className="text-slate-500">CAIXA (m): </span>
              X {dimM[0]} · Y {dimM[1]} · Z {dimM[2]}
              <div className="text-slate-500">centro {fmt(stats.center[0] * calib, 2)}, {fmt(stats.center[1] * calib, 2)}, {fmt(stats.center[2] * calib, 2)} · {unitNote}</div>
            </div>
          )}

          {/* avisos */}
          {warnings.length > 0 && (
            <div className="absolute bottom-2 right-2 z-10 max-w-[300px] rounded border border-amber-600/60 bg-amber-950/80 px-3 py-2 text-[9px] leading-4 text-amber-200 backdrop-blur">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* overlay de carregamento */}
          {loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/85">
              <div className="radar-loader mb-4 h-14 w-14 rounded-full border-2 border-amber-400/40" />
              <div className="font-display text-sm font-bold tracking-[0.25em] text-amber-300">CARREGANDO…</div>
              <div className="mt-2 h-1.5 w-64 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all" style={{ width: `${loadPct}%` }} />
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-slate-400">{loadStage || "preparando…"}</div>
            </div>
          )}

          {/* erro */}
          {error && !loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90 p-8">
              <div className="max-w-md rounded-lg border border-red-800 bg-slate-900 p-5">
                <AlertTriangle className="mx-auto text-red-400" size={32} />
                <div className="mt-3 text-center text-sm font-bold text-red-300">Falha na importação</div>
                <div className="mt-2 max-h-40 overflow-y-auto break-words text-center font-mono text-[10px] leading-4 text-slate-400">{error}</div>
                <div className="mt-3 flex justify-center gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="rounded bg-red-700 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-red-600">TENTAR OUTRO ARQUIVO</button>
                  {mode === "registry" && (
                    <button onClick={() => void loadRegistry()} className="rounded bg-slate-800 px-3 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-700">TENTAR NOVAMENTE</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* drop zone / vazio */}
          {!loading && !error && mode === "local" && !localName && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="max-w-sm rounded-xl border-2 border-dashed border-slate-600 bg-slate-950/80 p-8 text-center backdrop-blur">
                <Upload size={30} className="mx-auto text-amber-400" />
                <div className="mt-2 font-display text-sm font-bold tracking-widest text-slate-200">ARRASTE O GLB AQUI</div>
                <p className="mt-2 text-[11px] leading-4 text-slate-400">
                  ou use <b className="text-amber-300">IMPORTAR AERONAVE</b>. Nada é enviado ao servidor — a leitura é feita no dispositivo.
                  Para <code className="text-sky-300">.gltf</code>, selecione junto os arquivos <code className="text-sky-300">.bin</code> e texturas.
                </p>
              </div>
            </div>
          )}
          {assetAvailable === false && mode === "registry" && !loading && (
            <div className="absolute left-3 top-14 z-10 max-w-xs rounded-md border border-amber-600/60 bg-amber-950/70 px-3 py-2 text-[10px] leading-4 text-amber-200 backdrop-blur">
              <b>GLB não disponível no servidor.</b> Fallback procedural ativo — use IMPORTAR para carregar o arquivo local.
            </div>
          )}
        </div>

        {/* ------- painel lateral ------- */}
        <div className="flex w-[390px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/95">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 px-3 py-2">
            <button onClick={rerunDiscovery} className="flex h-7 items-center gap-1.5 rounded bg-emerald-700 px-2 text-[10px] font-bold text-white hover:bg-emerald-600"><RefreshCw size={11} /> RE-ANALISAR</button>
            <button onClick={exportJson} className="flex h-7 items-center gap-1.5 rounded bg-sky-700 px-2 text-[10px] font-bold text-white hover:bg-sky-600"><Download size={11} /> EXPORTAR</button>
          </div>

          {/* abas */}
          <div className="flex shrink-0 border-b border-slate-800 text-[9px] font-bold tracking-widest">
            {(
              [
                ["hier", "HIERARQUIA"], ["mats", `MATERIAIS (${matInfo.length})`],
                ["anims", `CLIPS (${clips.length})`], ["lab", `LABORATÓRIO (${lab.length})`],
              ] as ["hier" | "mats" | "anims" | "lab", string][]
            ).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 transition ${tab === k ? "bg-slate-800 text-amber-300" : "text-slate-500 hover:text-slate-300"}`}>{l}</button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
            {tab === "hier" && (
              <>
                {selNode && tf && (
                  <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 font-mono text-[9px] leading-4 text-amber-200">
                    <div className="flex items-center justify-between">
                      <b className="truncate">{selNode.name}</b>
                      <span>{selNode.kind}</span>
                    </div>
                    <div className="text-amber-300/80">pos {tf.pos.join(", ")} · rot {tf.rot.join(", ")}° · scale {tf.scl.join(", ")}</div>
                  </div>
                )}
                <div className="rounded border border-slate-800 bg-slate-900/40 p-1">
                  {tree.length ? tree.map((n) => renderTree(n)) : <div className="p-2 text-[9px] text-slate-500">Nada carregado.</div>}
                </div>
                <div className="mt-3 text-[10px] font-bold tracking-widest text-slate-400">GEOMETRIA</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-slate-800 bg-slate-900/40 p-2 font-mono text-[9px] text-slate-300">
                  <span>malhas: <b>{stats ? fmt(stats.meshes) : "—"}</b></span>
                  <span>vértices: <b>{stats ? fmt(stats.vertices) : "—"}</b></span>
                  <span>triângulos: <b>{stats ? fmt(stats.triangles) : "—"}</b></span>
                  <span>materiais: <b>{stats ? fmt(stats.materials) : "—"}</b></span>
                  <span>skinned: <b>{stats ? fmt(stats.skinned) : "—"}</b></span>
                  <span>bones: <b>{stats ? fmt(stats.bones) : "—"}</b></span>
                </div>
                {stats && (
                  <div className="mt-1.5 rounded border border-slate-800 bg-slate-900/40 p-2 text-[9px] text-slate-400">
                    Eixos: X largura · Y vertical · Z proa-popa — {unitNote}. Calibração ×{fmt(calib, 2)} afeta apenas a visualização.
                  </div>
                )}
                <div className="mt-3 text-[10px] font-bold tracking-widest text-slate-400">COMPONENTES DETECTADOS</div>
                <div className="mt-1 space-y-1">
                  {channels.length === 0 && <div className="rounded border border-slate-800 bg-slate-900/50 p-2 text-[9px] leading-4 text-slate-500">Nenhum componente identificado por alias. Os nomes de nós importados podem exigir dicionário próprio (PRD futuro).</div>}
                  {channels.map((c) => (
                    <button key={c.channel} onClick={() => setSelectedChannel(c.channel)} className={`w-full rounded-md border px-2 py-1.5 text-left text-[10px] ${selectedChannel === c.channel ? "border-sky-400/80 bg-sky-500/15" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-200">{c.channel}</span>
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[8px] font-bold ${STATUS_COLOR[c.status]}`}>{c.status} · {c.confidence.toFixed(2)}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[9px] text-slate-500">nó: {c.node ?? "—"} · {c.source}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === "mats" && (
              <div className="space-y-2">
                {matInfo.length === 0 && <div className="rounded border border-slate-800 bg-slate-900/50 p-3 text-[10px] text-slate-500">Nenhum material encontrado.</div>}
                {matInfo.map((m, i) => (
                  <div key={i} className="rounded border border-slate-800 bg-slate-900/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 shrink-0 rounded border border-slate-600" style={{ background: m.color }} />
                      <span className="min-w-0 flex-1 truncate font-display text-[11px] font-bold text-slate-100">{m.name}</span>
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[8px] text-sky-300">{m.type.replace("Material", "")}</span>
                    </div>
                    <div className="mt-1 font-mono text-[9px] text-slate-400">
                      metalness <b className="text-slate-200">{m.metal === null ? "—" : fmt(m.metal, 2)}</b> · roughness <b className="text-slate-200">{m.rough === null ? "—" : fmt(m.rough, 2)}</b>
                      {m.transparent && <> · <span className="text-sky-300">alpha {fmt(m.opacity, 2)}</span></>}
                    </div>
                    {m.slots.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.slots.map((s, j) => (
                          <span key={j} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[8px] text-slate-300">{s.slot}: {s.size}</span>
                        ))}
                      </div>
                    )}
                    {m.slots.length === 0 && <div className="mt-0.5 text-[8px] text-slate-600">sem texturas (fatores PBR puros)</div>}
                  </div>
                ))}
                <button onClick={() => setDisplay(display === "texture" ? "original" : "texture")} className={`flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[10px] font-bold ${display === "texture" ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-300" : "border-slate-700 text-slate-400"}`}>
                  <Film size={11} /> MODO TEXTURA {display === "texture" ? "ATIVO" : "— ver texturas no 3D"}
                </button>
              </div>
            )}

            {tab === "anims" && (
              <div className="space-y-1.5">
                {clips.length === 0 && <div className="rounded border border-slate-800 bg-slate-900/50 p-3 text-[10px] leading-4 text-slate-500">Nenhuma AnimationClip no modelo. Animações de trem/hélices podem vir associadas a nós por nome — use RE-ANALISAR.</div>}
                {clips.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setClipIdx(i);
                      playClip(i);
                    }}
                    className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-[10px] font-mono ${clipIdx === i ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-200" : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600"}`}
                  >
                    <span className="truncate">▶ {c.name}</span>
                    <span className="shrink-0 text-slate-500">{fmt(c.duration, 1)}s</span>
                  </button>
                ))}
                {clips.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={stopClip} className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300"><Square size={9} /> PARAR</button>
                    <label className="flex flex-1 items-center gap-1.5 font-mono text-[9px] text-slate-400">
                      velocidade
                      <input type="range" min={0.1} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="flex-1 accent-emerald-500" />
                      ×{fmt(speed, 1)}
                    </label>
                  </div>
                )}
              </div>
            )}

            {tab === "lab" && (
              <>
                {labMsg && (
                  <div className="mb-2 rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-1.5 text-[9px] leading-4 text-emerald-200">{labMsg}
                    <button className="ml-2 font-bold text-emerald-400" onClick={() => setLabMsg(null)}>×</button>
                  </div>
                )}
                <AnimationLab
                  lab={lab}
                  onChange={(defs) => { setLab(defs); setManualT((x) => x + 1); }}
                  getArt={() => engineRef.current?.art ?? null}
                  getModel={() => engineRef.current?.model ?? null}
                  clips={clips}
                  clipIdx={clipIdx}
                  onSelectClip={(i) => playClip(i)}
                  onStopClip={stopClip}
                  clipPaused={clipPaused}
                  setClipPaused={setClipPaused}
                  clipLoop={clipLoop}
                  setClipLoop={setClipLoop}
                  speed={speed}
                  setSpeed={setSpeed}
                  nodes={flatNodes}
                  showPivots={showPivots}
                  setShowPivots={setShowPivots}
                  preset={labPreset}
                  setPreset={setLabPreset}
                  onSave={saveLab}
                  onMessage={setLabMsg}
                />
              </>
            )}
          </div>

          {/* teste de articulação (registry/procedural) */}
          <div className="shrink-0 border-t border-slate-800 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-slate-500">Testar articulação visual</span>
              {!testing ? (
                <button onClick={startTest} disabled={!selectedChannel || !engineRef.current?.visual} className="flex items-center gap-1 rounded bg-sky-700 px-2 py-1 text-[10px] font-bold text-white hover:bg-sky-600 disabled:opacity-40"><Play size={10} /> TESTAR</button>
              ) : (
                <button onClick={stopTest} className="flex items-center gap-1 rounded bg-red-700 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-600"><Square size={10} /> PARAR</button>
              )}
            </div>
            {selectedChannel && (
              <div className="mt-1 rounded bg-slate-900/80 px-2 py-1.5 font-mono text-[9px] text-slate-400"><span className="flex items-center gap-1"><Crosshair size={10} /> {selectedChannel}</span></div>
            )}
            {mode === "local" && (
              <div className="mt-1.5 rounded bg-fuchsia-950/40 px-2 py-1.5 text-[9px] leading-4 text-fuchsia-200/80">
                Modelo importado é exibido como está no arquivo — nada é alterado nos dados originais. Use a seleção na hierarquia para inspecionar nós.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* inputs ocultos */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.bin,image/*,.ktx2"
        multiple
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.currentTarget.value = "";
          if (fs.length) {
            setMode("local");
            void importLocal(fs);
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error atributo não-padrão suportado em Chromium/Android
        webkitdirectory=""
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []).filter((f) => /\.(glb|gltf|bin|png|jpg|jpeg|webp|ktx2)$/i.test(f.name));
          e.currentTarget.value = "";
          if (fs.length) {
            setMode("local");
            void importLocal(fs);
          } else setError("A pasta não contém arquivos de modelo (.glb/.gltf).");
        }}
      />
      <input
        ref={hdrInputRef}
        type="file"
        accept=".hdr,image/vnd.radiance"
        className="hidden"
        onChange={(e) => {
          const f = (e.target.files ?? [])[0];
          e.currentTarget.value = "";
          if (!f) return;
          const e2 = engineRef.current;
          if (!e2) return;
          const url = URL.createObjectURL(f);
          new RGBELoader().load(
            url,
            (tex) => {
              if (!e2.pmrem) e2.pmrem = new THREE.PMREMGenerator(e2.renderer);
              e2.envRT?.dispose();
              e2.envRT = e2.pmrem.fromEquirectangular(tex as THREE.Texture);
              (tex as THREE.Texture).dispose();
              e2.scene.environment = e2.envRT.texture;
              setEnvOn(true);
              setWarnings((w) => [...w, `Ambiente HDRI aplicado: ${f.name}`]);
              URL.revokeObjectURL(url);
            },
            undefined,
            () => {
              URL.revokeObjectURL(url);
              setWarnings((w) => [...w, "Falha ao ler o .hdr (formato não suportado neste dispositivo?)"]);
            }
          );
        }}
      />
    </div>
  );

}

// silhueta p/ tipos DOM de pasta
type FileSystemEntry = { isFile: boolean; isDirectory: boolean; name: string };
type FileSystemFileEntry = FileSystemEntry & { file: (ok: (f: File) => void, ko: (e: unknown) => void) => void };
type FileSystemDirectoryEntry = FileSystemEntry & { createReader: () => { readEntries: (ok: (e: FileSystemEntry[]) => void, ko: (e: unknown) => void) => void } };
