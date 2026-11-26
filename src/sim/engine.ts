import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { byId, computeMassKg, type AircraftSpec, type WeaponKind } from "./aircraft";
import { buildAircraft, makeLabel, type AircraftModel } from "./models";
import { buildWorld, computeLayout, flatZones, placeFacilities, insideRunway, type World, type Layout } from "./world";
import { Terrain, groundHeight, isWater, setActiveTerrain, type Quality } from "./terrain";
import { GeoFrame, type MapProvider } from "./geo";
import { FX } from "./fx";
import { Scars } from "./scars";
import { DamageRegistry, segSphere, type Damageable, type WeaponType } from "./damage";
import { WeaponSystem, type PlayerState, type Warning } from "./weapons";
import { TrafficSystem } from "./traffic";
import { LiveTraffic, type LiveFollowState, type LiveInfo } from "./liveTraffic";
import { Precip } from "./precip";
import { FlightAudio } from "./sound";
import type { WeatherRadarCell } from "./clouds";
import { tzOf, type Airport } from "./airports";
import { DEFAULT_WX, airDensity, fetchWeather, startEpoch, windKt, windText, type Weather } from "./weather";

export type CameraMode = "chase" | "cockpit" | "tower" | "orbit" | "flyby";

export interface Snapshot {
  speedKt: number; ias: number; mach: number;
  altFt: number; aglFt: number; vsFpm: number;
  headingDeg: number; pitchDeg: number; rollDeg: number;
  throttle: number; afterburner: boolean; gForce: number;
  fuelPct: number; gear: boolean; gearPos: number; flaps: number; brake: boolean;
  stall: boolean; overspeed: boolean; onGround: boolean; crashed: boolean;
  score: number; kills: number;
  weapon: WeaponKind;
  ammo: { cannon: number; bomb: number; missileIR: number; missileRAD: number };
  cm: { flare: number; chaff: number };
  threat: Warning | null;
  lock: { name: string; dist: number } | null;
  camera: CameraMode;
  airspaceWarning: boolean;
  radar: { x: number; y: number; kind: "traffic" | "hostile" | "player" }[];
  time: number;
  hp: number; hpMax: number; hitFlash: number; engineFire: boolean;
  repair: number; towerAlive: boolean; runway: string;
  mouse: { on: boolean; x: number; y: number };
  spoiler: number;
  lights: { nav: boolean; beacon: boolean; strobe: boolean; landing: boolean };
  invert: boolean;
  rudderCoupled: boolean;
  massKg: number; fuelKg: number; weaponsKg: number;
  gearCompression: number;
  inCloud: number; inCB: boolean;
  paused: boolean; muted: boolean;
  followHex: string | null;
  followed: LiveFollowState["info"] | null;
  simMs: number; timeScale: number; sunEl: number;
  wx: { summary: string; tempC: number; wind: string; windKt: number; windDir: number; visKm: number; cloud: number; qnh: number; precip: number; live: boolean };
  adsb: LiveInfo;
}

export interface RadarContact {
  id: string; hex?: string; x: number; z: number; altFt: number; gsKt: number; hdg: number; vx: number; vz: number;
  callsign: string; type: string; kind: "traffic" | "player" | "hostile" | "missile";
}

export interface RadarData {
  self: { x: number; z: number; hdg: number; altFt: number; gsKt: number; callsign: string };
  contacts: RadarContact[];
  weatherCells: WeatherRadarCell[];
  windDir: number;
  windKt: number;
  selectedHex: string | null;
  runways: { x1: number; z1: number; x2: number; z2: number; id1: string; id2: string; active: boolean }[];
  thr: { x: number; z: number; dx: number; dz: number };
  tower: { x: number; z: number };
  icao: string;
}

export interface MapData {
  self: { lat: number; lon: number; hdg: number; altFt: number; gsKt: number; callsign: string };
  trail: [number, number][];
  adsb: { hex: string; cs: string; type: string; lat: number; lon: number; altFt: number; gsKt: number; trackDeg: number; onGround: boolean }[];
  traffic: { id: string; cs: string; lat: number; lon: number; hdg: number }[];
  players: { id: string; cs: string; lat: number; lon: number; hdg: number }[];
  runways: { lat1: number; lon1: number; lat2: number; lon2: number; id1: string; id2: string; active: boolean }[];
  selectedHex: string | null;
  followHex: string | null;
  icao: string;
}

export interface RemoteState {
  id: string; callsign: string; aircraft: string;
  x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number; speed: number; gear: boolean; hp: number; alive: boolean;
  flares: number; chaff: number;
}

export interface EngineOpts {
  aircraftId: string;
  callsign: string;
  airport: Airport;
  runway: string;
  mapProvider: MapProvider;
  quality: Quality;
  timeMode: "real" | "custom";
  startHour: number;
  liveWeather: boolean;
  /** 0 = brilho mínimo, 1 = máximo (slider de vídeo do hangar) */
  glare?: number;
  rudderCoupled?: boolean;
  /** local de nascimento: "apron" (pátio, padrão) ou "runway" (pista) */
  spawnLocation?: "apron" | "runway";
  arcade: boolean;
  onSnapshot: (s: Snapshot) => void;
  onRadio: (callsign: string, text: string, kind: "pilot" | "atc" | "system") => void;
  onLoading: (text: string, pct: number) => void;
  onReady: () => void;
  onRemoteHit: (targetId: string, dmg: number, weapon: string) => void;
  onKilled: (by: string | null, cause: string) => void;
}

interface Remote {
  model: AircraftModel; label: THREE.Sprite; st: RemoteState; t: number; dmg: Damageable;
  alive: boolean; lastHitByMe: number; spec: AircraftSpec; fl: number; ch: number;
}

const KTS = 1.94384, FT = 3.28084;
const UP = new THREE.Vector3(0, 1, 0);
const WEAPON_DMG: Record<string, number> = { f16: 16, a10: 30, su35: 26, fa18: 16 };
const clamp = THREE.MathUtils.clamp;
const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class FlightEngine {
  spec: AircraftSpec;
  opts: EngineOpts;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  frame: GeoFrame;
  layout: Layout;
  terrain: Terrain;
  registry = new DamageRegistry();
  fx: FX;
  scars: Scars;
  precip: Precip;
  model: AircraftModel;
  world!: World;
  weapons!: WeaponSystem;
  traffic!: TrafficSystem;
  live!: LiveTraffic;
  ready = false;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  throttle = 0;
  eng = 0;
  gear = true;
  gearPos = 1;
  flaps = 0;
  brake = true;
  crashed = false;
  crashTimer = 0;
  fuel = 1;
  hp: number;
  hpMax: number;
  cameraMode: CameraMode = "chase";
  weapon: WeaponKind = "cannon";
  ammo: { cannon: number; bomb: number; missileIR: number; missileRAD: number };
  cm: { flare: number; chaff: number };
  clearance = { taxi: false, takeoff: false, landing: false, airspace: false };
  airspaceWarning = false;
  score = 0;
  kills = 0;
  labelsOn = true;
  wx: Weather = { ...DEFAULT_WX };
  simMs = Date.now();
  timeScale = 1;
  mouseMode = false;
  invertPitch = false;
  /** leme acoplado aos ailerons (false = independente nas teclas < / > e Q / E) */
  rudderCoupled = false;
  /** luzes externas — teclas 5 (nav) 6 (beacon) 7 (strobe) 8 (pouso/táxi) */
  lights = { nav: true, beacon: true, strobe: false, landing: false };
  /** freio aerodinâmico (spoiler/speedbrake) — tecla / ou 9 */
  spoiler = false;
  spoilerPos = 0;
  /** 0 = sem brilho, 1 = máximo (regulagem do hangar) */
  glare = 0.5;
  /** pausa da simulação (mantém render e HUD vivos) */
  paused = false;
  /** mute global de todos os áudios */
  muted = false;
  /** local de nascimento escolhido no hangar */
  spawnLocation: "apron" | "runway" = "apron";
  /** vagas de nascimento espaçadas (multiplayer sem sobreposição) */
  private spawnSlots: THREE.Vector3[] = [];
  /** proteção breve após nascer: ignora colisão com outros jogadores */
  private spawnProtectUntil = 0;
  /** hex do voo ADS-B selecionado no radar/mapa e hex sendo acompanhado em câmera 3D */
  selectedHex: string | null = null;
  followHex: string | null = null;

  // ---- controles virtuais (mobile): mesmas entradas que teclado/mouse ----
  /** pitch positivo = nariz para cima; roll positivo = asa direita para baixo */
  private virtualStick = { pitch: 0, roll: 0, active: false };
  /** potência definida diretamente pela manete virtual (null = usa teclado) */
  private virtualThrottle: number | null = null;
  private virtualFire = false;
  private virtualFlares = false;
  private virtualChaff = false;

  private mouse = { x: 0, y: 0 };
  private mouseFire = false;
  private mouseFlare = false;
  private camOrbit = { yaw: 0, pitch: 0.2, distMul: 1, dragging: false, lx: 0, ly: 0 };
  private gearCompression = 0;
  private gearCompVel = 0;
  private gearPrevMoving = false;
  private inCloud = 0;
  private inCB = false;
  private cloudThunderT = 0;
  private trailGeo: [number, number][] = [];
  private trailGeoT = 0;
  private composer: EffectComposer | null = null;
  private ctl = { pitch: 0, roll: 0, yaw: 0 };
  private keys = new Set<string>();
  private raf = 0;
  private lastT = 0;
  private snapT = 0;
  private cannonT = 0;
  private fireT = 0;
  private cmT = 0;
  private chaffT = 0;
  private netFl = 0;
  private netCh = 0;
  private lastWarn = 0;
  private lastLockTone = 0;
  private lastThreatBeep = 0;
  private lastViolation = 0;
  private lastFriendly = 0;
  private lastHit = -1e9;
  private lastCrater = -1e9;
  private repairT = 0;
  private orbitAng = 0;
  private gForce = 1;
  private trailT = 0;
  private flybyPos = new THREE.Vector3();
  private lockTarget: Damageable | null = null;
  private remotes = new Map<string, Remote>();
  private abLight: THREE.PointLight;
  private landLight: THREE.SpotLight;
  private audio: FlightAudio | null = null;
  private currentMassKg = 0;
  private currentFuelKg = 0;
  private currentWeaponsKg = 0;
  private disposed = false;
  private prevPos = new THREE.Vector3();
  private wasTouching = true;
  private onGroundNow = true;
  private stallFlag = false;
  private clmax: number;
  private kInd: number;
  private windVec = new THREE.Vector3();
  private turb = new THREE.Vector3();
  private envT = 0;
  private envDirty = true;
  private hemiBase = 0.4;
  private flash = 0;
  private thunderT = 6;
  private wxTimer = 0;
  private camVel = new THREE.Vector3();
  private lastCam = new THREE.Vector3();

  constructor(container: HTMLElement, opts: EngineOpts) {
    this.opts = opts;
    this.spec = byId(opts.aircraftId);
    this.ammo = { ...this.spec.loadout };
    this.cm = { ...this.spec.cm };
    this.hpMax = this.spec.hp;
    this.hp = this.hpMax;
    this.rudderCoupled = Boolean(opts.rudderCoupled);
    this.spawnLocation = opts.spawnLocation === "runway" ? "runway" : "apron";
    const m0 = computeMassKg(this.spec, 1, this.ammo);
    this.currentMassKg = m0.totalKg;
    this.currentFuelKg = m0.fuelKg;
    this.currentWeaponsKg = m0.weaponsKg;
    this.clmax = ((2 * this.spec.mass * 9.81) / (1.225 * this.spec.stallSpeed ** 2 * this.spec.wingArea)) * 1.22;
    this.kInd = 1 / (Math.PI * 0.8 * (this.spec.span ** 2 / this.spec.wingArea));
    const q = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === "high" ? 2 : q === "medium" ? 1.5 : 1));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = q !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.45;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.8, 46000);
    this.frame = new GeoFrame(opts.airport.lat, opts.airport.lon);
    this.layout = computeLayout(opts.airport, opts.runway, this.frame);
    this.terrain = new Terrain({
      frame: this.frame, elevM: opts.airport.elevM, zones: flatZones(this.layout), provider: opts.mapProvider,
      quality: q, anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    });
    setActiveTerrain(this.terrain);
    this.scene.add(this.terrain.group);
    this.fx = new FX(this.scene, q);
    this.scars = new Scars(this.scene, q);
    this.fx.scars = this.scars;
    this.precip = new Precip(this.scene);
    this.model = buildAircraft(this.spec, opts.callsign);
    this.scene.add(this.model.group);
    this.abLight = new THREE.PointLight(0xff9a40, 0, 120, 2);
    this.abLight.position.copy(this.model.exhausts[0] ?? new THREE.Vector3(0, 0, 8)).add(new THREE.Vector3(0, 0, 4));
    this.model.group.add(this.abLight);
    this.landLight = new THREE.SpotLight(0xfff4e0, 0, 1400, 0.32, 0.5, 1.2);
    this.landLight.position.set(0, -0.6, -this.spec.length * 0.35);
    this.landLight.target.position.set(0, -60, -500);
    this.model.group.add(this.landLight, this.landLight.target);

    this.simMs = startEpoch(tzOf(opts.airport), opts.timeMode, opts.startHour);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("pointerup", this.onPointerUp);
    const cvs = this.renderer.domElement;
    cvs.addEventListener("pointerdown", this.onPointerDown);
    cvs.addEventListener("dblclick", this.onDblClick);
    cvs.addEventListener("wheel", this.onWheel, { passive: false });
    cvs.addEventListener("contextmenu", this.onContext);
    void this.init();
  }

  get windString() {
    return windText(this.wx);
  }

  private async init() {
    const ap = this.opts.airport;
    this.opts.onLoading("Consultando meteorologia ao vivo…", 0.02);
    const wxP: Promise<Weather> = this.opts.liveWeather
      ? fetchWeather(ap.lat, ap.lon, 6000)
      : Promise.resolve({ ...DEFAULT_WX, summary: "Céu limpo (clima fixo)" });
    try {
      await this.terrain.init((t, p) => this.opts.onLoading(t, p * 0.9));
    } catch {
      this.opts.onLoading("Relevo indisponível — usando terreno plano", 0.9);
    }
    this.wx = await wxP;
    if (this.disposed) return;
    this.opts.onLoading("Montando aeroporto, tráfego e alvos…", 0.95);
    placeFacilities(this.layout, this.terrain, ap.terminalSide);
    this.world = buildWorld({
      scene: this.scene, renderer: this.renderer, airport: ap, layout: this.layout, terrain: this.terrain,
      quality: this.opts.quality, registry: this.registry, fx: this.fx, scars: this.scars, wx: this.wx,
    });
    this.weapons = new WeaponSystem(this.scene, this.registry, this.fx, this.scars, {
      onEvent: (t) => this.opts.onRadio("SISTEMA", t, "system"),
      onSound: (_k, d, s) => this.boomSound(d, s),
      onThreat: (t) => {
        this.opts.onRadio("SISTEMA", t, "system");
        this.blip(1500, 0.25, 0.12, "square");
      },
      onPlayerHit: (dmg, by) => this.applyDamage(dmg, by, `atingido por míssil de ${by}`),
    });
    this.weapons.buildTargets(this.layout, this.terrain);
    this.traffic = new TrafficSystem(this.scene, this.layout, this.registry, this.fx, { atcName: ap.atcName, gnd: ap.freqs.gnd, wind: this.windString }, ap.traffic, (c, t, k) => this.opts.onRadio(c, t, k));
    this.live = new LiveTraffic(this.scene, this.frame, this.registry, this.fx, ap.elevM, ap.lat, ap.lon, (t) => this.opts.onRadio("SISTEMA", t, "system"));
    this.registry.remoteHit = (owner, dmg, w) => {
      this.opts.onRemoteHit(owner, dmg, w);
      const r = this.remotes.get(owner);
      if (r) r.lastHitByMe = performance.now();
    };
    this.registry.destroyListeners.push((d, w, byPlayer) => this.onDestroyed(d, w, byPlayer));
    this.registry.explosionListeners.push((c, r, dmg) => this.nearExplosion(c, r, dmg));

    if (this.opts.quality === "high") {
      const el = this.renderer.domElement;
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.55, 0.5, 3.4));
      this.composer.addPass(new OutputPass());
    }
    this.buildSpawnSlots();
    this.onResize();
    this.glare = this.opts.glare ?? 0.5;
    this.world.setGlare(0.15 + 1.7 * this.glare);
    this.applyWeather();
    this.respawn();
    const qnh = Math.round(this.wx.pressureHpa);
    this.opts.onRadio(
      `TORRE ${ap.atcName.toUpperCase()}`,
      `${this.opts.callsign}, bem-vindo a ${ap.name} (${ap.icao}). Pista em uso ${this.layout.activeIdent}, vento ${this.windString}, QNH ${qnh}, ${this.wx.summary.toLowerCase()}. Solicite táxi no Solo ${ap.freqs.gnd}. Segure V para falar ou T para o chat.`,
      "atc"
    );
    this.opts.onRadio("SISTEMA", "Solte o freio (B) · W/S/↑/↓ profundor · A/D aileron · Q/E ou ,/. leme (TAB acopla) · / ou 9 spoiler · SHIFT/CTRL potência · G trem · F flaps · Z/N flares/chaff · O mouse · R radar · M mapa · U ADS-B · Y Live ATC · P painel · J rádio · H ajuda", "system");
    this.opts.onLoading("Pronto", 1);
    this.ready = true;
    this.opts.onReady();
    this.wxTimer = window.setInterval(async () => {
      if (!this.opts.liveWeather) return;
      const w = await fetchWeather(ap.lat, ap.lon, 6000);
      if (w.source === "live") {
        this.wx = w;
        this.applyWeather();
      }
    }, 600000);
    this.lastT = performance.now();
    this.loop(this.lastT);
  }

  private applyWeather() {
    const w = this.wx;
    const snow = w.snow > 0.05 || (w.tempC < 0.5 && w.precip > 0.05);
    const k = clamp(snow ? Math.max(w.snow / 1.5, w.precip / 3) : w.precip / 4, 0, 1);
    this.precip.set(snow ? "snow" : "rain", k, this.windVec);
    this.envDirty = true;
  }

  // ------------------------------------------------------------ relógio
  getSimDate() {
    return new Date(this.simMs);
  }
  shiftTime(hours: number) {
    this.simMs += hours * 3600000;
    this.envDirty = true;
  }
  setTimeScale(n: number) {
    this.timeScale = n;
  }
  syncRealTime() {
    this.simMs = Date.now();
    this.timeScale = 1;
    this.envDirty = true;
  }

  // ------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    this.initAudio();
    const c = e.code;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Backspace"].includes(c)) e.preventDefault();
    if (this.keys.has(c)) return;
    this.keys.add(c);
    if (!this.ready) return;
    const say = (t: string) => this.opts.onRadio("SISTEMA", t, "system");
    // spoiler: suporta '/' em qualquer layout (ABNT2 IntlRo, US Slash, NumPad) ou tecla 9
    if (e.key === "/" || c === "Slash" || c === "IntlRo" || c === "NumpadDivide" || c === "Digit9") {
      if (e.shiftKey && (e.key === "?" || c === "Slash" || c === "IntlRo")) this.syncRealTime();
      else this.toggleSpoiler();
      return;
    }
    switch (c) {
      case "KeyG":
        if (this.spec.fixedGear) say("O Cessna 172 tem trem de pouso fixo.");
        else if (this.onGroundNow && this.gear) say("Trem travado: peso sobre as rodas (WOW). Decole para recolher.");
        else {
          this.gear = !this.gear;
          this.gearPrevMoving = true;
          this.audio?.playGearMove(this.gear);
          say(this.gear ? "Baixando trem de pouso…" : "Recolhendo trem de pouso…");
        }
        break;
      case "KeyF": this.flaps = this.flaps >= 1 ? 0 : this.flaps + 0.5; break;
      case "KeyB": this.brake = !this.brake; break;
      case "KeyC": {
        if (this.followHex) {
          this.setFollowAdsb(null);
          break;
        }
        const modes: CameraMode[] = ["chase", "cockpit", "tower", "orbit", "flyby"];
        this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
        if (this.cameraMode === "flyby") this.placeFlyby();
        break;
      }
      case "Enter":
      case "NumpadEnter":
        if (this.crashed) this.respawn();
        break;
      case "Escape":
        if (this.followHex) this.setFollowAdsb(null);
        break;
      case "Tab":
        this.toggleRudderCoupled();
        break;
      case "Digit1": this.weapon = "cannon"; break;
      case "Digit2": if (this.spec.loadout.bomb) this.weapon = "bomb"; break;
      case "Digit3": if (this.spec.loadout.missileIR) this.weapon = "missileIR"; break;
      case "Digit4": if (this.spec.loadout.missileRAD) this.weapon = "missileRAD"; break;
      case "KeyX": this.fireOnce(); break;
      case "KeyO":
        this.mouseMode = !this.mouseMode;
        this.mouse.x = 0;
        this.mouse.y = 0;
        this.mouseFire = false;
        this.mouseFlare = false;
        this.camOrbit.dragging = false;
        say(this.mouseMode ? "🖱 Controle aviônico por MOUSE ativado — mova o mouse para comandar profundor/aileron; roda = potência; esquerdo = disparar; direito = flares. (O desativa)" : "Controle aviônico por mouse desativado — arraste no fundo para orbitar a câmera externa e use a roda para zoom.");
        break;
      case "KeyI":
        this.invertPitch = !this.invertPitch;
        say(this.invertPitch ? "Profundor das setas/mouse INVERTIDO (↑ puxa o nariz para cima)." : "Profundor padrão: ↑ empurra o nariz para baixo, ↓ puxa para cima.");
        break;
      case "Minus": this.shiftTime(-1); break;
      case "Equal":
        if (e.shiftKey) this.syncRealTime();
        else this.shiftTime(1);
        break;
      case "Digit0": this.syncRealTime(); break;
      case "KeyU": this.toggleLiveTraffic(); break;
      case "Digit5":
        this.lights.nav = !this.lights.nav;
        say(`Luzes de navegação ${this.lights.nav ? "ACESAS" : "APAGADAS"} (5)`);
        break;
      case "Digit6":
        this.lights.beacon = !this.lights.beacon;
        say(`Beacon (anti-colisão vermelho) ${this.lights.beacon ? "LIGADO" : "DESLIGADO"} (6)`);
        break;
      case "Digit7":
        this.lights.strobe = !this.lights.strobe;
        say(`Strobes (flash branco) ${this.lights.strobe ? "LIGADOS" : "DESLIGADOS"} (7)`);
        break;
      case "Digit8":
        this.lights.landing = !this.lights.landing;
        say(`Luzes de pouso/táxi ${this.lights.landing ? "ACESAS" : "APAGADAS"} (8)`);
        break;
      case "KeyK": {
        const scales = [1, 60, 600];
        this.timeScale = scales[(scales.indexOf(this.timeScale) + 1) % scales.length] ?? 1;
        say(`Velocidade do relógio: ${this.timeScale}×`);
        break;
      }
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    if (this.mouseMode) {
      const sc = window.innerHeight * 0.4;
      const curve = (v: number) => {
        const a = Math.abs(v);
        const d = a < 0.05 ? 0 : (a - 0.05) / 0.95;
        return Math.sign(v) * Math.min(1, Math.pow(d, 1.25));
      };
      this.mouse.x = curve(clamp((e.clientX - window.innerWidth / 2) / sc, -1, 1));
      this.mouse.y = curve(clamp((e.clientY - window.innerHeight / 2) / sc, -1, 1));
      return;
    }
    if (this.camOrbit.dragging) {
      const dx = e.clientX - this.camOrbit.lx;
      const dy = e.clientY - this.camOrbit.ly;
      this.camOrbit.lx = e.clientX;
      this.camOrbit.ly = e.clientY;
      this.camOrbit.yaw -= dx * 0.0065;
      this.camOrbit.pitch = clamp(this.camOrbit.pitch + dy * 0.006, -0.7, 1.42);
    }
  };
  private onPointerDown = (e: PointerEvent) => {
    this.initAudio();
    if (this.mouseMode) {
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseFlare = true;
      e.preventDefault();
      return;
    }
    // câmera externa livre com o mouse (chase, orbit ou acompanhando ADS-B)
    if (this.followHex || this.cameraMode === "chase" || this.cameraMode === "orbit") {
      this.camOrbit.dragging = true;
      this.camOrbit.lx = e.clientX;
      this.camOrbit.ly = e.clientY;
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) this.mouseFire = false;
    if (e.button === 2) this.mouseFlare = false;
    this.camOrbit.dragging = false;
  };
  private onDblClick = () => {
    if (!this.mouseMode && (this.followHex || this.cameraMode === "chase" || this.cameraMode === "orbit")) {
      this.camOrbit.yaw = 0;
      this.camOrbit.pitch = 0.2;
      this.camOrbit.distMul = 1;
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (this.mouseMode) {
      e.preventDefault();
      this.throttle = clamp(this.throttle - Math.sign(e.deltaY) * 0.05, 0, 1);
      return;
    }
    if (this.followHex || this.cameraMode === "chase" || this.cameraMode === "orbit") {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      this.camOrbit.distMul = clamp(this.camOrbit.distMul * factor, 0.3, 5.5);
    }
  };
  private onContext = (e: Event) => e.preventDefault();
  private onResize = () => {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.composer?.setSize(el.clientWidth, el.clientHeight);
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
  };

  setClearance(c: Partial<FlightEngine["clearance"]>) {
    Object.assign(this.clearance, c);
  }

  /** Pausa/retoma a simulação (física, tráfego, relógio e áudio) mantendo o render ativo */
  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    if (this.audio) {
      const ctx = (this.audio as unknown as { ctx?: AudioContext }).ctx;
      if (ctx) {
        if (p) void ctx.suspend().catch(() => undefined);
        else void ctx.resume().catch(() => undefined);
      }
    }
    this.opts.onRadio(
      "SISTEMA",
      p ? "⏸ SIMULAÇÃO PAUSADA — o mundo continua congelado (tecla Pause para retomar)." : "▶ SIMULAÇÃO RETOMADA.",
      "system"
    );
  }

  /** Mute global: motor da aeronave, rádio e TTS */
  setMuted(m: boolean) {
    this.muted = m;
    this.audio?.setMuted(m);
    if (!m) this.initAudio();
  }

  /** Clique de PTT (abertura/fechamento do canal) */
  pttClick(open: boolean) {
    this.initAudio();
    if (open) this.blip(1180, 0.07, 0.07, "square");
    else this.blip(760, 0.06, 0.05, "square");
    this.noiseBurst(0.1, 0.05, 2400, "bandpass");
  }

  /** tráfego real ADS-B — tecla U */
  toggleLiveTraffic(): boolean {
    if (!this.ready) return true;
    const on = this.live.toggle();
    this.opts.onRadio(
      "SISTEMA",
      on
        ? "📡 Tráfego real ADS-B ATIVADO — aeronaves reais nas posições transmitidas agora (adsb.fi/OpenSky)."
        : "Tráfego ADS-B desativado — apenas o tráfego IA do aeroporto permanece.",
      "system"
    );
    return on;
  }

  // ---------- API dos controles virtuais (mobile) ----------
  /** Comando do manche virtual. pitch > 0 = puxar (nariz sobe); roll > 0 = rolar à direita. */
  setVirtualStick(pitch: number, roll: number) {
    this.virtualStick.pitch = clamp(pitch, -1, 1);
    this.virtualStick.roll = clamp(roll, -1, 1);
    this.virtualStick.active = true;
  }
  releaseVirtualStick() {
    this.virtualStick.pitch = 0;
    this.virtualStick.roll = 0;
    this.virtualStick.active = false;
  }
  /** Manete: 0 = mínimo, 1 = máximo (aplicada no próximo quadro). */
  setVirtualThrottle(v: number | null) {
    this.virtualThrottle = v === null ? null : clamp(v, 0, 1);
  }
  setVirtualFire(on: boolean) {
    this.virtualFire = on;
    if (on) this.initAudio();
  }
  setVirtualCountermeasure(kind: "flare" | "chaff", on: boolean) {
    if (kind === "flare") this.virtualFlares = on;
    else this.virtualChaff = on;
    if (on) this.initAudio();
  }
  /** Seleção de armamento por botão (valida a disponibilidade na aeronave). */
  setWeapon(w: WeaponKind) {
    if (w === "cannon" && this.spec.loadout.cannon === 0) return;
    if (w === "bomb" && this.spec.loadout.bomb === 0) return;
    if (w === "missileIR" && this.spec.loadout.missileIR === 0) return;
    if (w === "missileRAD" && this.spec.loadout.missileRAD === 0) return;
    this.weapon = w;
  }
  /** Disparo único (toque no botão de tiro). */
  fireVirtualOnce() {
    if (this.weapon === "cannon") return; // canhão é contínuo
    this.fireOnce();
  }
  toggleGearVirtual() {
    if (this.spec.fixedGear) return;
    if (this.onGroundNow && this.gear) return;
    this.gear = !this.gear;
    this.gearPrevMoving = true;
    this.audio?.playGearMove(this.gear);
  }
  cycleFlapsVirtual() {
    this.flaps = this.flaps >= 1 ? 0 : this.flaps + 0.5;
  }
  toggleBrakeVirtual() {
    this.brake = !this.brake;
  }

  /** Ciclo de câmera exposto aos botões virtuais (mobile). */
  cycleCamera() {
    if (this.followHex) {
      this.setFollowAdsb(null);
      return;
    }
    const modes: CameraMode[] = ["chase", "cockpit", "tower", "orbit", "flyby"];
    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
    if (this.cameraMode === "flyby") this.placeFlyby();
  }

  toggleSpoiler() {
    this.spoiler = !this.spoiler;
    this.initAudio();
    this.audio?.playSpoiler(this.spoiler);
    this.opts.onRadio(
      "SISTEMA",
      this.spoiler
        ? "SPOILER (freio aerodinâmico) ESTENDIDO — sustentação reduzida, arrasto alto (9 ou /)"
        : "Spoiler recolhido",
      "system"
    );
  }

  toggleRudderCoupled() {
    this.rudderCoupled = !this.rudderCoupled;
    this.opts.onRadio(
      "SISTEMA",
      this.rudderCoupled
        ? "Leme ACOPLADO aos ailerons (coordenação automática ativada — TAB alterna)"
        : "Leme INDEPENDENTE dos ailerons — use Q / E ou < / > (TAB alterna)",
      "system"
    );
  }

  setSelectedAdsb(hex: string | null) {
    this.selectedHex = hex;
  }

  setFollowAdsb(hex: string | null) {
    this.followHex = hex;
    if (hex) {
      this.selectedHex = hex;
      this.camOrbit.yaw = 0.55;
      this.camOrbit.pitch = 0.22;
      this.camOrbit.distMul = 1;
      const f = this.live?.getFlight(hex);
      if (f) this.opts.onRadio("SISTEMA", `🎥 Acompanhando ${f.cs} (${f.type}) em câmera 3D livre — arraste o mouse para girar, roda para zoom, ESC para voltar.`, "system");
    } else {
      this.camOrbit.yaw = 0;
      this.camOrbit.pitch = 0.2;
      this.camOrbit.distMul = 1;
      this.opts.onRadio("SISTEMA", `Retornando à sua aeronave (${this.opts.callsign}).`, "system");
    }
  }

  /** 0 = sem brilho do sol, 1 = máximo (slider de vídeo do hangar) */
  setGlare(v: number) {
    this.glare = Math.min(1, Math.max(0, v));
    if (this.ready) this.world.setGlare(0.15 + 1.7 * this.glare);
  }

  setLabels(on: boolean) {
    this.labelsOn = on;
    if (!this.ready) return;
    this.traffic.setLabels(on);
    for (const r of this.remotes.values()) r.label.visible = on && r.alive;
  }

  // ------------------------------------------------------------ áudio
  private initAudio() {
    if (this.audio || this.disposed) return;
    try {
      this.audio = new FlightAudio(this.spec);
    } catch {
      /* sem áudio */
    }
  }

  private blip(freq: number, dur: number, vol = 0.12, type: OscillatorType = "square") {
    this.audio?.blip(freq, dur, vol, type);
  }

  private noiseBurst(dur: number, vol: number, freq: number, type: BiquadFilterType, delay = 0) {
    this.audio?.noiseBurst(dur, vol, freq, type, delay);
  }

  private boomSound(dist: number, size: number) {
    this.audio?.boom(dist, size);
  }

  squelch() {
    this.initAudio();
    this.audio?.squelch();
  }

  // ------------------------------------------------------------ util
  private forward() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat); }
  private up() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat); }
  private gearDown() { return this.spec.fixedGear || this.gearPos > 0.5; }

  /** vento de superfície real, com cisalhamento, rajadas e curva com a altura */
  private windAt(agl: number, now: number): THREE.Vector3 {
    const w = this.wx;
    const alt = clamp(agl / 1200, 0, 1);
    const sp = w.windMs * (1 + 0.7 * alt);
    const gustAmp = clamp((w.gustMs - w.windMs) / Math.max(w.windMs, 3), 0, 0.7);
    const g = 1 + gustAmp * (0.5 * Math.sin(now * 0.0011) + 0.3 * Math.sin(now * 0.0037 + 1.3) + 0.2 * Math.sin(now * 0.0091 + 2.1));
    const dir = ((w.windDir + 20 * alt) * Math.PI) / 180;
    return this.windVec.set(-Math.sin(dir) * sp * g, 0, Math.cos(dir) * sp * g);
  }

  // ------------------------------------------------------------ armas e contramedidas
  private fireOnce() {
    if (this.crashed || this.fireT > 0) return;
    const fwd = this.forward();
    const nose = this.pos.clone().addScaledVector(fwd, this.spec.length * 0.4);
    if (this.weapon === "bomb" && this.ammo.bomb > 0) {
      this.ammo.bomb--;
      this.fireT = 0.45;
      this.weapons.fireBomb(this.pos.clone().addScaledVector(this.up(), -1.6), this.vel);
      this.blip(160, 0.15, 0.1, "sine");
    } else if (this.weapon === "missileIR" && this.ammo.missileIR > 0) {
      if (this.lockTarget) {
        this.ammo.missileIR--;
        this.fireT = 1.0;
        this.weapons.fireIR(nose.addScaledVector(this.up(), -1), fwd, this.vel, this.lockTarget);
        this.noiseBurst(1.2, 0.35, 900, "lowpass");
      } else {
        this.opts.onRadio("SISTEMA", "Sem trava IR. Aponte o nariz para um alvo quente (blindados, drones, aeronaves) até ouvir o tom.", "system");
      }
    } else if (this.weapon === "missileRAD" && this.ammo.missileRAD > 0) {
      this.ammo.missileRAD--;
      this.fireT = 1.0;
      this.weapons.fireRadio(nose.addScaledVector(this.up(), -1), fwd, this.vel);
      this.noiseBurst(1.2, 0.35, 800, "lowpass");
    }
  }

  private dispenseCM(dt: number) {
    this.cmT -= dt;
    this.chaffT -= dt;
    const k = this.keys;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    if ((k.has("KeyZ") || this.mouseFlare || this.virtualFlares) && this.cm.flare > 0 && this.cmT <= 0) {
      this.cmT = 0.3;
      const n = Math.min(2, this.cm.flare);
      this.cm.flare -= n;
      this.netFl += n;
      this.weapons.dispenseFlares(this.pos, this.vel, this.up(), right, n);
      this.noiseBurst(0.18, 0.2, 1800, "bandpass");
    }
    if ((k.has("KeyN") || this.virtualChaff) && this.cm.chaff > 0 && this.chaffT <= 0) {
      this.chaffT = 0.45;
      this.cm.chaff -= 1;
      this.netCh += 1;
      this.weapons.dispenseChaff(this.pos, this.vel, this.up());
      this.noiseBurst(0.12, 0.14, 2600, "highpass");
    }
  }

  private onDestroyed(d: Damageable, _w: WeaponType, byPlayer: boolean) {
    if (!byPlayer) return;
    this.score += d.points;
    const now = performance.now();
    if (d.team === "hostile") {
      this.kills++;
      this.opts.onRadio("SISTEMA", `SPLASH! ${d.name} destruído (+${d.points} pts)`, "system");
    } else if (d.team === "friendly") {
      this.opts.onRadio("SISTEMA", `FOGO AMIGO! ${d.name} destruído (${d.points} pts)`, "system");
      if (now - this.lastFriendly > 15000) {
        this.lastFriendly = now;
        this.opts.onRadio(`TORRE ${this.opts.airport.atcName.toUpperCase()}`, `${this.opts.callsign}, CESSAR FOGO IMEDIATAMENTE! Você atingiu ${d.name}. Isto será reportado ao comando.`, "atc");
      }
    } else {
      this.opts.onRadio("SISTEMA", `Dano colateral: ${d.name} (${d.points} pts)`, "system");
    }
  }

  private nearExplosion(c: THREE.Vector3, r: number, dmg: number) {
    if (this.crashed) return;
    const dist = this.pos.distanceTo(c) - this.spec.span * 0.3;
    if (dist < r) this.applyDamage(dmg * 0.6 * (1 - Math.max(0, dist) / r), null, "atingido por estilhaços de explosão");
  }

  applyDamage(dmg: number, by: string | null, cause: string) {
    if (this.crashed || !this.ready || dmg <= 0) return;
    this.hp -= dmg;
    this.lastHit = performance.now();
    this.noiseBurst(0.12, 0.25, 1200, "bandpass");
    if (this.hp <= 0) this.crash(cause, by);
    else if (this.hp < this.hpMax * 0.3) this.opts.onRadio("SISTEMA", "⚠ DANO CRÍTICO — fogo no motor, perda de potência!", "system");
  }

  applyExternalDamage(dmg: number, from: string, weapon: string) {
    this.applyDamage(dmg, from, weapon === "collision" ? `colisão em voo com ${from}` : `abatido por ${from}`);
  }

  private guide(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return { origin: this.camera.position.clone(), dir };
  }

  private playerState(): PlayerState {
    const gnd = groundHeight(this.pos.x, this.pos.z);
    return {
      pos: this.pos, vel: this.vel, alive: !this.crashed,
      heat: 0.5 + this.eng * 0.5 + (this.spec.afterburner && this.eng > 0.9 ? 0.5 : 0),
      onGround: this.onGroundNow, agl: this.pos.y - gnd, g: this.gForce, radius: this.spec.span * 0.4,
    };
  }

  // ------------------------------------------------------------ queda / renascimento
  private crash(cause: string, by: string | null = null) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 5;
    this.hp = 0;
    const gy = groundHeight(this.pos.x, this.pos.z);
    this.fx.explosion(this.pos.clone(), Math.max(18, this.spec.span * 1.2), { groundY: gy, water: isWater(this.pos.x, this.pos.z) });
    this.fx.burn(this.pos.clone().setY(Math.max(this.pos.y, gy + 1)), this.spec.span * 0.2, 30000);
    this.boomSound(0, 40);
    this.model.group.visible = false;
    this.opts.onRadio("SISTEMA", `💥 ${this.opts.callsign}: ${cause}. Renascendo na pista ${this.layout.activeIdent}… (R)`, "system");
    this.opts.onKilled(by, cause);
  }

  /**
   * Gera as vagas de nascimento: próximas umas das outras, porém espaçadas o
   * suficiente para que duas aeronaves não se sobreponham (e não colidam).
   * - pista: fila ao longo do eixo da pista ativa, a partir do ponto de decolagem
   * - pátio: malha em torno do pátio, afastada das aeronaves estacionadas
   */
  private buildSpawnSlots() {
    const L = this.layout;
    const slots: THREE.Vector3[] = [];
    // folga lateral/longitudinal com base na maior envergadura possível do catálogo
    const span = Math.max(this.spec.span, 36);
    if (this.spawnLocation === "runway") {
      // Fila de decolagem a partir da cabeceira: espaçadas entre si, sempre sobre o
      // pavimento e ocupando no máximo 40% da pista — assim todo piloto mantém
      // pelo menos 60% do comprimento disponível para a corrida de decolagem.
      const step = Math.max(60, span * 1.8);
      const maxSlots = clamp(Math.floor((L.active.len * 0.4) / step), 1, 8);
      for (let i = 0; i < maxSlots; i++) {
        const p = L.spawn.clone().addScaledVector(L.dir, i * step);
        if (!insideRunway(L, p.x, p.z, -2)) break;
        slots.push(p);
      }
      if (!slots.length) slots.push(L.spawn.clone());
    } else {
      // malha no pátio: linhas ao longo do eixo da pista, colunas na direção do pátio
      const along = Math.max(90, span * 2.5);
      const across = Math.max(52, span * 1.5);
      // deslocado para fora do pátio, longe das aeronaves estacionadas
      const base = L.apron.clone().addScaledVector(L.out, 78).addScaledVector(L.dir, 30);
      for (let r = -2; r <= 3; r++) {
        for (let c = 0; c < 4; c++) {
          slots.push(base.clone().addScaledVector(L.dir, r * along).addScaledVector(L.out, c * across));
        }
      }
    }
    // descarta vagas sobre água (modo mapa real)
    const filtered = slots.filter((p) => !isWater(p.x, p.z));
    if (filtered.length) slots.length = 0, slots.push(...filtered);

    if (this.spawnLocation === "runway") {
      // fila: da cabeceira para dentro (quem chega primeiro pega a vaga mais próxima)
      const thr = L.thr;
      slots.sort((a, b) => a.distanceToSquared(thr) - b.distanceToSquared(thr));
    } else {
      // pátio: distribuição determinística por jogador (cada um tende a usar a mesma vaga)
      let h = 0;
      const id = this.opts.callsign || "PILOTO";
      for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      slots.sort((a, b) => {
        const ka = (Math.round(a.x * 7 + a.z * 13) + h) % 97;
        const kb = (Math.round(b.x * 7 + b.z * 13) + h) % 97;
        return ka - kb;
      });
    }
    this.spawnSlots = slots;
  }

  /**
   * Escolhe uma vaga livre: nenhuma outra aeronave (jogador remoto ou estacionada)
   * dentro da folga. Se todas estiverem ocupadas, usa a mais distante.
   */
  private pickSpawnSlot(): THREE.Vector3 {
    const L = this.layout;
    if (!this.spawnSlots.length) return L.spawn.clone();
    const span = Math.max(this.spec.span, 24);
    const clearance = Math.max(45, span * 1.35);
    const busy: { x: number; z: number }[] = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const g = r.model.group.position;
      busy.push({ x: g.x, z: g.z });
    }
    // aeronaves estacionadas / tráfego IA no solo também ocupam espaço
    for (const d of this.registry.items) {
      if (!d.alive || d.kind !== "aircraft") continue;
      if (d.center.y > 40) continue; // só o que está no chão
      busy.push({ x: d.center.x, z: d.center.z });
    }
    for (const p of this.traffic.planes) {
      if (p.state !== "ok") continue;
      busy.push({ x: p.pos.x, z: p.pos.z });
    }
    let best: THREE.Vector3 | null = null;
    let bestMin = -1;
    for (const slot of this.spawnSlots) {
      let min = Infinity;
      for (const b of busy) min = Math.min(min, Math.hypot(slot.x - b.x, slot.z - b.z));
      if (!busy.length) return slot.clone();
      if (min >= clearance) return slot.clone();
      if (min > bestMin) {
        bestMin = min;
        best = slot;
      }
    }
    return (best ?? this.spawnSlots[0]).clone();
  }

  respawn() {
    const slot = this.pickSpawnSlot();
    this.pos.copy(slot).setY(groundHeight(slot.x, slot.z) + this.spec.gearHeight);
    // alinha à pista (nascimento) ou ao eixo do pátio
    const yaw = this.spawnLocation === "runway"
      ? this.layout.spawnRotY
      : Math.atan2(-this.layout.dir.x, -this.layout.dir.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.throttle = 0;
    this.eng = 0;
    this.crashed = false;
    // proteção curta: evita colisão imediata caso outra aeronave chegue perto
    this.spawnProtectUntil = performance.now() + 4000;
    this.gear = true;
    this.gearPos = 1;
    this.brake = true;
    this.flaps = 0; // sempre inicia sem flap: o jogador escolhe
    this.fuel = 1;
    this.hp = this.hpMax;
    this.wasTouching = true;
    this.ammo = { ...this.spec.loadout };
    this.cm = { ...this.spec.cm };
    this.model.group.visible = true;
  }

  private placeFlyby() {
    const dir = this.vel.lengthSq() > 4 ? this.vel.clone().normalize() : this.forward();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    this.flybyPos.copy(this.pos).addScaledVector(dir, 120 + this.vel.length() * 4).addScaledVector(side, 25 + this.spec.span).addScaledVector(UP, 6);
    const gy = groundHeight(this.flybyPos.x, this.flybyPos.z) + 2;
    if (this.flybyPos.y < gy) this.flybyPos.y = gy;
  }

  // ------------------------------------------------------------ multiplayer
  updateRemotes(list: RemoteState[], myId: string) {
    if (!this.ready) return;
    const now = performance.now();
    const seen = new Set<string>();
    for (const r of list) {
      if (r.id === myId) continue;
      seen.add(r.id);
      let e = this.remotes.get(r.id);
      if (!e) {
        const spec = byId(r.aircraft);
        const model = buildAircraft(spec);
        const label = makeLabel(r.callsign, "#7dd3fc", spec.short);
        label.visible = this.labelsOn;
        model.group.add(label);
        model.group.position.set(r.x, r.y, r.z);
        model.group.quaternion.set(r.qx, r.qy, r.qz, r.qw);
        this.scene.add(model.group);
        const dmg = this.registry.add({
          id: `remote-${r.id}`, name: r.callsign, kind: "remote", team: "neutral", owner: r.id,
          center: new THREE.Vector3(r.x, r.y, r.z), radius: spec.span * 0.42, hp: 100, points: 0, heat: 0.9, respawnMs: 0,
        });
        e = { model, label, st: r, t: now, dmg, alive: r.alive, lastHitByMe: -1e9, spec, fl: r.flares ?? 0, ch: r.chaff ?? 0 };
        this.remotes.set(r.id, e);
        this.opts.onRadio("SISTEMA", `✈ ${r.callsign} (${spec.short}) entrou no espaço aéreo.`, "system");
      }
      // contramedidas dos outros jogadores (visíveis para todos e capazes de enganar mísseis)
      const g = e.model.group;
      const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion), ut = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      const vel = new THREE.Vector3(r.vx, r.vy, r.vz);
      if ((r.flares ?? 0) > e.fl) this.weapons.dispenseFlares(g.position, vel, ut, rt, Math.min(8, r.flares - e.fl), r.id);
      if ((r.chaff ?? 0) > e.ch) this.weapons.dispenseChaff(g.position, vel, ut, r.id);
      e.fl = r.flares ?? 0;
      e.ch = r.chaff ?? 0;
      if (e.alive && !r.alive) {
        this.fx.explosion(g.position.clone(), Math.max(18, e.spec.span));
        g.visible = false;
        if (now - e.lastHitByMe < 15000) {
          this.score += 1000;
          this.kills++;
          this.opts.onRadio("SISTEMA", `🎯 ABATE CONFIRMADO: ${r.callsign} (+1000 pts)`, "system");
        }
      }
      if (!e.alive && r.alive) {
        g.visible = true;
        g.position.set(r.x, r.y, r.z);
      }
      e.alive = r.alive;
      e.dmg.alive = r.alive;
      e.label.visible = this.labelsOn && r.alive;
      e.st = r;
      e.t = now;
    }
    for (const [id, e] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(e.model.group);
      this.registry.remove(e.dmg);
      this.remotes.delete(id);
      this.opts.onRadio("SISTEMA", `${e.st.callsign} deixou o espaço aéreo.`, "system");
    }
  }

  getNetState() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      qx: this.quat.x, qy: this.quat.y, qz: this.quat.z, qw: this.quat.w,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      speed: this.vel.length(), gear: this.gearDown(), hp: Math.max(0, this.hp), alive: !this.crashed,
      fl: this.netFl, ch: this.netCh,
    };
  }

  getRadarData(): RadarData | null {
    if (!this.ready) return null;
    const hdgOf = (vx: number, vz: number) => ((Math.atan2(vx, -vz) * 180) / Math.PI + 360) % 360;
    const fwd = this.forward();
    const elev = this.opts.airport.elevM;
    const contacts: RadarContact[] = [];
    for (const p of this.traffic.planes) {
      if (p.state !== "ok") continue;
      contacts.push({ id: p.id, x: p.pos.x, z: p.pos.z, altFt: (p.pos.y + elev) * FT, gsKt: p.vel.length() * KTS, hdg: hdgOf(p.vel.x, p.vel.z), vx: p.vel.x, vz: p.vel.z, callsign: p.callsign, type: p.spec.short, kind: "traffic" });
    }
    for (const c of this.live.contacts()) {
      contacts.push({
        id: `adsb-${c.hex}`, hex: c.hex, x: c.pos.x, z: c.pos.z, altFt: (c.pos.y + elev) * FT, gsKt: c.vel.length() * KTS,
        hdg: hdgOf(c.vel.x, c.vel.z), vx: c.vel.x, vz: c.vel.z, callsign: c.cs, type: c.type, kind: "traffic",
      });
    }
    for (const [id, r] of this.remotes) {
      if (!r.alive) continue;
      const g = r.model.group.position;
      contacts.push({ id, x: g.x, z: g.z, altFt: (g.y + elev) * FT, gsKt: r.st.speed * KTS, hdg: hdgOf(r.st.vx, r.st.vz), vx: r.st.vx, vz: r.st.vz, callsign: r.st.callsign, type: r.spec.short, kind: "player" });
    }
    for (const d of this.registry.items) {
      if (!d.alive || d.team !== "hostile") continue;
      contacts.push({ id: d.id, x: d.center.x, z: d.center.z, altFt: (d.center.y + elev) * FT, gsKt: 0, hdg: 0, vx: 0, vz: 0, callsign: d.name, type: d.kind, kind: "hostile" });
    }
    this.weapons.missiles().forEach((m, i) => contacts.push({ id: `m${i}`, x: m.x, z: m.z, altFt: (m.y + elev) * FT, gsKt: 0, hdg: 0, vx: 0, vz: 0, callsign: "MSL", type: "", kind: "missile" }));
    return {
      self: { x: this.pos.x, z: this.pos.z, hdg: hdgOf(fwd.x, fwd.z), altFt: (this.pos.y + elev) * FT, gsKt: this.vel.length() * KTS, callsign: this.opts.callsign },
      contacts,
      weatherCells: this.world.clouds.weatherCells(),
      windDir: this.wx.windDir,
      windKt: windKt(this.wx),
      selectedHex: this.selectedHex,
      runways: this.layout.runways.map((r) => ({ x1: r.lx, z1: r.lz, x2: r.hx, z2: r.hz, id1: r.leId, id2: r.heId, active: r === this.layout.active })),
      thr: { x: this.layout.thr.x, z: this.layout.thr.z, dx: this.layout.dir.x, dz: this.layout.dir.z },
      tower: { x: this.layout.tower.x, z: this.layout.tower.z },
      icao: this.opts.airport.icao,
    };
  }

  getMapData(): MapData | null {
    if (!this.ready) return null;
    const hdgOf = (vx: number, vz: number) => ((Math.atan2(vx, -vz) * 180) / Math.PI + 360) % 360;
    const fwd = this.forward();
    const [sLat, sLon] = this.frame.toLatLon(this.pos.x, this.pos.z);
    const elev = this.opts.airport.elevM;
    return {
      self: { lat: sLat, lon: sLon, hdg: hdgOf(fwd.x, fwd.z), altFt: (this.pos.y + elev) * FT, gsKt: this.vel.length() * KTS, callsign: this.opts.callsign },
      trail: this.trailGeo,
      adsb: this.live.contacts().map((c) => {
        const [lat, lon] = this.frame.toLatLon(c.pos.x, c.pos.z);
        return { hex: c.hex, cs: c.cs, type: c.type, lat, lon, altFt: c.altFt, gsKt: Math.round(c.gsKt), trackDeg: c.trackDeg, onGround: c.onGround };
      }),
      traffic: this.traffic.planes.filter((p) => p.state === "ok").map((p) => {
        const [lat, lon] = this.frame.toLatLon(p.pos.x, p.pos.z);
        return { id: p.id, cs: p.callsign, lat, lon, hdg: hdgOf(p.vel.x, p.vel.z) };
      }),
      players: [...this.remotes.entries()].filter(([, r]) => r.alive).map(([id, r]) => {
        const [lat, lon] = this.frame.toLatLon(r.model.group.position.x, r.model.group.position.z);
        return { id, cs: r.st.callsign, lat, lon, hdg: hdgOf(r.st.vx, r.st.vz) };
      }),
      runways: this.layout.runways.map((r) => {
        const [lat1, lon1] = this.frame.toLatLon(r.lx, r.lz);
        const [lat2, lon2] = this.frame.toLatLon(r.hx, r.hz);
        return { lat1, lon1, lat2, lon2, id1: r.leId, id2: r.heId, active: r === this.layout.active };
      }),
      selectedHex: this.selectedHex,
      followHex: this.followHex,
      icao: this.opts.airport.icao,
    };
  }

  // ------------------------------------------------------------ física
  private physics(dt: number, now: number) {
    if (this.crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.respawn();
      return;
    }
    const s = this.spec, k = this.keys, arcade = this.opts.arcade;
    const key = (c: string) => (k.has(c) ? 1 : 0);

    // ---- comandos (teclado + mouse). Setas: ↑ empurra o nariz para baixo, ↓ puxa (padrão de aviação).
    const inv = this.invertPitch ? -1 : 1;
    let pitchIn = key("KeyS") - key("KeyW") + (key("ArrowDown") - key("ArrowUp")) * inv;
    let rollIn = key("KeyD") + key("ArrowRight") - key("KeyA") - key("ArrowLeft");
    // leme: Q/E e < / > (Comma / Period) — acoplado aos ailerons se rudderCoupled estiver ligado
    const rawYaw = key("KeyE") + key("Period") - key("KeyQ") - key("Comma");
    if (this.mouseMode) {
      pitchIn += this.mouse.y * inv;
      rollIn += this.mouse.x;
    }
    // manche virtual (mobile) — mesmas variáveis de comando do teclado/mouse
    if (this.virtualStick.active) {
      pitchIn += this.virtualStick.pitch * inv;
      rollIn += this.virtualStick.roll;
    }
    pitchIn = clamp(pitchIn, -1, 1);
    rollIn = clamp(rollIn, -1, 1);
    const yawIn = clamp(rawYaw + (this.rudderCoupled ? rollIn * 0.45 : 0), -1, 1);
    const rate = Math.min(1, 7 * dt);
    this.ctl.pitch += (pitchIn - this.ctl.pitch) * rate;
    this.ctl.roll += (rollIn - this.ctl.roll) * rate;
    this.ctl.yaw += (yawIn - this.ctl.yaw) * rate;
    if (k.has("ShiftLeft") || k.has("ShiftRight")) this.throttle = Math.min(1, this.throttle + 0.45 * dt);
    const ctrl = k.has("ControlLeft") || k.has("ControlRight");
    if (ctrl) this.throttle = Math.max(0, this.throttle - 0.45 * dt);
    // manete virtual: autoridade direta sobre a potência
    if (this.virtualThrottle !== null) this.throttle = this.virtualThrottle;
    const brakeHeld = k.has("Backspace") || (ctrl && this.throttle < 0.08);

    // ---- trem de pouso (animação + som de trava mecânica)
    if (!s.fixedGear) {
      const tgt = this.gear ? 1 : 0;
      const prevGP = this.gearPos;
      this.gearPos += Math.sign(tgt - this.gearPos) * Math.min(Math.abs(tgt - this.gearPos), dt / 3.2);
      if (this.gearPrevMoving && this.gearPos === tgt && prevGP !== tgt) {
        this.gearPrevMoving = false;
        this.audio?.playGearLock();
      }
    } else this.gearPos = 1;

    const fwd = this.forward(), up = this.up();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const groundY = groundHeight(this.pos.x, this.pos.z);
    const agl = this.pos.y - groundY;
    const msl = this.pos.y + this.opts.airport.elevM;
    const gh = s.gearHeight * (0.42 + 0.58 * this.gearPos);
    const contactNow = this.pos.y <= groundY + gh + 0.08;
    this.onGroundNow = contactNow;
    const hpFrac = Math.max(0, this.hp / this.hpMax);

    // ---- dados do ar (vento real, densidade por temperatura/QNH/altitude) e entrada em nuvem densa
    const wind = this.windAt(agl, now);
    const va = this.vel.clone().sub(wind);
    const V = va.length();
    const atm = airDensity(msl, this.opts.airport.elevM, this.wx);
    const rho = atm.rho, sigma = atm.sigma;
    const q = 0.5 * rho * V * V;
    const vhat = V > 1 ? va.clone().divideScalar(V) : fwd.clone();
    const vfw = Math.max(1, va.dot(fwd));
    const alpha = Math.atan2(-va.dot(up), vfw);
    const beta = Math.atan2(va.dot(right), vfw);
    const mach = V / atm.a;

    // ---- peso real = massa seca + combustível atual + armamentos carregados
    const massInfo = computeMassKg(s, this.fuel, this.ammo);
    this.currentMassKg = massInfo.totalKg;
    this.currentFuelKg = massInfo.fuelKg;
    this.currentWeaponsKg = massInfo.weaponsKg;
    const m = massInfo.totalKg;
    const S = s.wingArea;

    // ---- amostragem de nuvens densas / CB
    const cloudSample = this.world.clouds.sample(this.pos);
    this.inCloud = cloudSample.density;
    this.inCB = cloudSample.isCB;
    if (cloudSample.isCB && cloudSample.density > 0.35) {
      this.cloudThunderT -= dt;
      if (this.cloudThunderT <= 0) {
        this.cloudThunderT = 2.5 + Math.random() * 5;
        this.flash = 0.9;
        this.noiseBurst(1.8, 0.45, 190, "lowpass", 0.2 + Math.random() * 0.8);
      }
    }

    // ---- spoiler (freio aerodinâmico): anima, mata sustentação e aumenta fortemente o arrasto
    this.spoilerPos += ((this.spoiler ? 1 : 0) - this.spoilerPos) * Math.min(1, 3.6 * dt);
    const sp = this.spoilerPos * clamp(V / (s.stallSpeed * 0.7), 0, 1);

    // ---- aerodinâmica calibrada: decolagem realista dependente do peso e rotação de nariz
    const flaps = this.flaps;
    const aStall = s.aStall * (1 + 0.08 * flaps);
    // sustentação nula mais próxima de 0°: exige corrida e rotação de nariz para decolar!
    const a0 = -0.012 - 0.042 * flaps;
    const clMax = this.clmax * (1 + 0.28 * flaps);
    const aEff = arcade ? Math.min(alpha, aStall * 0.95) : alpha;
    let CL: number;
    if (aEff > aStall) CL = clMax * Math.max(0.4, 1 - (aEff - aStall) * 3.5);
    else if (aEff < -aStall) CL = -0.7 * clMax * Math.max(0.4, 1 - (-aEff - aStall) * 3.5);
    else CL = Math.max(-0.7 * clMax, (clMax * (aEff - a0)) / (aStall - a0));
    const stalled = !contactNow && !arcade && alpha > aStall;
    this.stallFlag = !contactNow && alpha > aStall * 0.92 && V < s.stallSpeed * Math.sqrt(m / s.mass) * 1.4;
    const wave = s.supersonic ? 0.024 * smooth01(0.88, 1.15, mach) : 0.032 * smooth01(0.72, 0.88, mach);
    const CD0 = s.cd0 + wave + (s.fixedGear ? 0 : 0.02 * this.gearPos) + flaps * 0.018 + (hpFrac < 0.5 ? 0.012 : 0);
    CL *= 1 - 0.55 * sp; // spoilers reduzem sustentação sobre a asa
    if (cloudSample.isCB && cloudSample.density > 0.4) CL *= 1 - 0.12 * cloudSample.density; // formação de gelo / downdraft leve em CB
    let CD = CD0 + this.kInd * CL * CL + 0.12 * sp;
    if (stalled) CD += 0.14;
    const Ln = q * S * CL, Dn = q * S * CD;
    const liftDir = new THREE.Vector3().crossVectors(right, vhat);
    if (liftDir.lengthSq() < 0.05) liftDir.copy(up);
    else liftDir.normalize();

    // ---- empuxo (spool realista da turbina / hélice)
    const ab = s.afterburner && this.eng > 0.9 && this.fuel > 0;
    const cmd = this.fuel > 0 ? this.throttle : 0;
    const spool = s.propeller ? 2.4 : s.id === "b737" ? (cmd > this.eng ? 0.35 : 0.65) : cmd > this.eng ? 0.85 : 1.4;
    this.eng += Math.sign(cmd - this.eng) * Math.min(Math.abs(cmd - this.eng), spool * dt);
    const e = this.eng;
    let T = s.thrust * (0.02 + (0.98 * Math.min(e, 0.9)) / 0.9) + (ab ? ((s.abThrust - s.thrust) * (e - 0.9)) / 0.1 : 0);
    if (s.propeller) T *= Math.max(0.22, 1 - V / (1.35 * s.maxSpeed)) * Math.pow(sigma, 0.9);
    else T *= Math.pow(sigma, 0.8);
    if (hpFrac < 0.3) T *= 0.55;
    if (this.fuel <= 0) T = 0;
    this.fuel = Math.max(0, this.fuel - dt * (0.00035 + this.throttle * 0.0009 + (ab ? 0.0022 : 0)));

    // ---- forças
    const acc = new THREE.Vector3(0, -9.81, 0);
    acc.addScaledVector(liftDir, Ln / m);
    acc.addScaledVector(vhat, -Dn / m);
    acc.addScaledVector(fwd, T / m);
    acc.addScaledVector(right, -(q * S * 0.72 * Math.sin(beta)) / m);

    // turbulência atmosférica + entrada em nuvens densas / cumulonimbus
    const wxTurb = clamp(this.wx.gustMs / 25, 0, 1) * (this.wx.thunder ? 1.8 : 1) * (agl < 2500 ? 1 : 0.4);
    const cloudTurb = cloudSample.turb * (cloudSample.isCB ? 2.6 : 0.9);
    const turbK = Math.max(wxTurb, cloudTurb) * (contactNow ? 0.12 : 1);
    if (turbK > 0.02) {
      this.turb.x += (Math.sin(now * 0.0037) * 5 + Math.cos(now * 0.011) * 3 - this.turb.x) * Math.min(1, 3 * dt);
      this.turb.y += (Math.sin(now * 0.0053 + 2) * 6.5 - this.turb.y) * Math.min(1, 3.5 * dt);
      this.turb.z += (Math.sin(now * 0.0029 + 4) * 5 - this.turb.z) * Math.min(1, 3 * dt);
      acc.addScaledVector(this.turb, turbK * (0.55 + 0.55 * Math.min(1, V / 80)));
    }
    this.gForce = contactNow ? 1 + this.gearCompression * 0.8 : clamp(Ln / (m * 9.81), -3, 12);
    if (!arcade && !contactNow && this.gForce > s.gLimit * 1.2) {
      this.applyDamage((this.gForce - s.gLimit * 1.2) * 6 * dt, null, "falha estrutural por excesso de G");
      if (this.crashed) return;
    }

    // ---- atitude: SEM piso artificial no solo! Parado não responde a profundor nem aileron!
    const qRef = 0.5 * 1.225 * (1.25 * s.stallSpeed * Math.sqrt(m / s.mass)) ** 2;
    const rawEff = Math.sqrt(Math.min(1, q / Math.max(qRef, 50)));
    let eff = contactNow ? (V < s.stallSpeed * 0.55 ? 0 : smooth01(s.stallSpeed * 0.55, s.stallSpeed * 1.05, V) * rawEff) : Math.max(0.05, rawEff);
    if (hpFrac < 0.5) eff *= 0.6 + hpFrac * 0.8;
    if (stalled) eff *= 0.45;
    const gLim = s.gLimit * 9.81 * (arcade ? 1.3 : 1);
    const omegaCap = gLim / Math.max(V, 45);
    const pitchCmd = this.ctl.pitch * Math.min(s.pitchRate * (arcade ? 1.25 : 1) * eff, omegaCap);
    let rollCmd = -this.ctl.roll * s.rollRate * eff * (arcade ? 1.2 : 1);
    let yawCmd = -this.ctl.yaw * s.yawRate * eff;
    let wvP = 0, wvY = 0, levelRate = 0;
    if (!contactNow) {
      const pitchAtt = Math.asin(clamp(fwd.y, -1, 1));
      const cosB = clamp(up.y / Math.max(0.2, Math.cos(pitchAtt)), 0.3, 1);
      const trimN = arcade ? 1 / cosB : Math.cos(Math.asin(clamp(vhat.y, -1, 1)));
      const clReq = (trimN * m * 9.81) / (Math.max(q, 50) * S);
      const aTrim = clamp(a0 + (clReq * (aStall - a0)) / clMax, a0, aStall * 0.92);
      if (alpha <= aStall || arcade) wvP = -s.stab * eff * (alpha - aTrim);
      else wvP = -(s.stab * eff * (aStall - aTrim) + 1.6 * (alpha - aStall + 0.04));
      wvP = clamp(wvP, -1.2, 1.2);
      wvY = clamp(-1.4 * eff * beta, -0.8, 0.8);
      const euR = new THREE.Euler().setFromQuaternion(this.quat, "YXZ");
      const levelK = arcade ? 0.35 : s.rollStab;
      if (Math.abs(rollIn) < 0.05 && levelK > 0) levelRate = -euR.z * levelK * eff;
      if (turbK > 0.02) {
        rollCmd += (Math.sin(now * 0.0061) + 0.5 * Math.cos(now * 0.013)) * 0.28 * turbK;
        wvP += Math.sin(now * 0.0049 + 1.5) * 0.16 * turbK;
      }
    } else {
      rollCmd = 0;
      yawCmd = 0;
      // só gira em pitch no solo quando há autoridade aerodinâmica na empenagem (velocidade de rotação);
      // se parado/lento, a gravidade na bequilha mantém o avião nivelado nas 3 rodas!
      if (eff <= 0.01) {
        const euG = new THREE.Euler().setFromQuaternion(this.quat, "YXZ");
        wvP = -euG.x * 4.5;
      }
    }
    this.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((pitchCmd + wvP) * dt, (yawCmd + wvY) * dt, (rollCmd + levelRate) * dt, "XYZ"))).normalize();

    // ---- integração
    this.prevPos.copy(this.pos);
    this.vel.addScaledVector(acc, dt);
    if (this.vel.length() > s.maxSpeed) this.vel.multiplyScalar(1 - 0.5 * dt);
    this.pos.addScaledVector(this.vel, dt);

    // ---- solo: suspensão óleo-pneumática + peso sobre rodas, atrito, freios, direção da bequilha somente em movimento
    const gNow = groundHeight(this.pos.x, this.pos.z);
    const floor = gNow + gh;
    let touching = false;
    if (this.pos.y <= floor) {
      const vyImpact = this.vel.y;
      this.pos.y = floor;
      if (vyImpact <= 0) {
        touching = true;
        const euT = new THREE.Euler().setFromQuaternion(this.quat, "YXZ");
        const onRunway = !!insideRunway(this.layout, this.pos.x, this.pos.z, 12);
        const onField = this.terrain.flatWeight(this.pos.x, this.pos.z) > 0.9;
        const gs = Math.hypot(this.vel.x, this.vel.z);
        if (!this.wasTouching) {
          // toque na pista!
          if (isWater(this.pos.x, this.pos.z) && !onRunway) return this.crash("amerissagem forçada — aeronave perdida na água");
          if (!s.fixedGear && this.gearPos < 0.7) return this.crash("pouso de barriga — trem recolhido");
          if (Math.abs(euT.z) > 0.5) return this.crash("asa tocou o solo");
          if (vyImpact < -(arcade ? 12 : 8.5)) return this.crash(`pouso duro (${Math.round(-vyImpact * 196.85)} fpm)`);
          if (vyImpact < -4.2) {
            this.applyDamage((-vyImpact - 4.2) * 9, null, "trem de pouso colapsou no toque");
            if (this.crashed) return;
            this.opts.onRadio("SISTEMA", `Toque forte: ${Math.round(-vyImpact * 196.85)} fpm — trem danificado.`, "system");
          }
          const flatF = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
          const lat = Math.abs(this.vel.x * -flatF.z + this.vel.z * flatF.x);
          if (lat > (arcade ? 18 : 13)) return this.crash("trem de pouso arrancado por derrapagem lateral");
          if (lat > 7) this.applyDamage((lat - 7) * 4, null, "carga lateral no trem");
          if (this.crashed) return;
          // excitação da suspensão + som mecânico de impacto + chiado de pneu
          this.gearCompVel += clamp(-vyImpact * 0.45, 0.35, 3.8);
          this.audio?.playTouchdown(vyImpact, m);
          // pequeno rebote elástico ao tocar duro sem spoiler — nunca logo após nascer
          if (vyImpact < -3.2 && !this.spoiler && now > this.spawnProtectUntil) {
            this.vel.y = Math.min(1.6, -vyImpact * 0.16);
            touching = false;
          }
        }
        if (touching && !s.fixedGear && this.gearPos < 0.7) return this.crash("pouso de barriga — trem recolhido");
        if (touching && !onField && !onRunway && gs > 45) return this.crash("colisão com o terreno");
        // crateras de bomba na pista são obstáculos reais
        const cr = touching && onRunway && gs > 12 ? this.scars.craterNear(this.pos.x, this.pos.z, 3) : null;
        if (cr && now - this.lastCrater > 2500) {
          this.lastCrater = now;
          if (gs > 75) return this.crash("colidiu em alta velocidade com cratera na pista");
          this.applyDamage(14 + gs * 0.5, null, "rodas destruídas em cratera na pista");
          this.vel.y = 3.2;
          this.pos.y = floor + 0.2;
          this.opts.onRadio("SISTEMA", "💥 Cratera na pista! Trem de pouso danificado.", "system");
          if (this.crashed) return;
          touching = false;
        }
        if (touching) {
          this.vel.y = 0;
          // peso sobre as rodas = peso − sustentação
          const nFrac = clamp(1 - (liftDir.y * Ln + fwd.y * T) / (m * 9.81), 0, 1);
          // dinâmica mola-amortecedor dos amortecedores óleo-pneumáticos
          const targetComp = clamp(0.18 * nFrac * (m / s.mass) + 0.14 * this.spoilerPos * nFrac, 0, 0.85);
          const springAcc = 42 * (targetComp - this.gearCompression) - 9.5 * this.gearCompVel;
          this.gearCompVel += springAcc * dt;
          this.gearCompression = clamp(this.gearCompression + this.gearCompVel * dt, 0, 1);

          const grip = 1 - 0.4 * clamp(this.wx.precip / 3 + this.wx.snow, 0, 1);
          const braking = this.brake || brakeHeld;
          const mu = (braking ? 0.52 * grip : 0.032) + (onRunway || onField ? 0 : 0.07) + 0.04 * sp;
          const spNow = gs;
          if (spNow > 0.05) {
            const ns = Math.max(0, spNow - mu * 9.81 * nFrac * dt);
            this.vel.x *= ns / spNow;
            this.vel.z *= ns / spNow;
          }
          const flatF = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
          const flatR = new THREE.Vector3(-flatF.z, 0, flatF.x);
          const vAlong = this.vel.x * flatF.x + this.vel.z * flatF.z;
          let vLat = this.vel.x * flatR.x + this.vel.z * flatR.z;
          vLat *= Math.exp(-9 * nFrac * grip * dt);
          this.vel.x = flatF.x * vAlong + flatR.x * vLat;
          this.vel.z = flatF.z * vAlong + flatR.z * vLat;
          if (this.brake && this.throttle < 0.05 && spNow < 0.6) {
            this.vel.x = 0;
            this.vel.z = 0;
          }
          // esterçamento pela roda dianteira SOMENTE quando a aeronave está rolando (gs > 0.35 m/s)
          const along = Math.abs(vAlong);
          if (along > 0.35) {
            const steerSrc = this.rudderCoupled ? clamp(this.ctl.yaw + this.ctl.roll * 0.7, -1, 1) : this.ctl.yaw;
            const steerRate = ((0.75 * clamp(along / 5, 0, 1)) / (1 + along / (s.stallSpeed * 0.7))) * nFrac + s.yawRate * eff * 0.45;
            this.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -steerSrc * steerRate * dt));
          }
          // vento forte no solo inclina levemente se não estiver travado
          if (wind.length() > 11 && gs > 1) {
            const crossW = wind.x * flatR.x + wind.z * flatR.z;
            this.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, clamp(crossW * 0.0005, -0.02, 0.02) * dt));
          }
          // atitude no solo: asas niveladas, nariz apoiado na bequilha em baixa velocidade
          const eu = new THREE.Euler().setFromQuaternion(this.quat, "YXZ");
          eu.z *= Math.max(0, 1 - 10 * dt);
          if ((eff <= 0.01 || Math.abs(pitchIn) < 0.05) && nFrac > 0.35) {
            eu.x -= Math.sign(eu.x) * Math.min(Math.abs(eu.x), 0.35 * dt);
          }
          eu.x = clamp(eu.x, -0.025, s.tailStrike);
          this.quat.setFromEuler(eu);
        }
      }
    }
    if (!touching) {
      // no ar, os amortecedores distendem suavemente até zero
      const springAcc = -32 * this.gearCompression - 8 * this.gearCompVel;
      this.gearCompVel += springAcc * dt;
      this.gearCompression = clamp(this.gearCompression + this.gearCompVel * dt, 0, 1);
    }
    this.wasTouching = touching;

    // ---- colisões com aeronaves, prédios e veículos
    this.collisions(now);
    if (this.crashed) return;

    // ---- avisos
    if (this.stallFlag && now - this.lastWarn > 700) {
      this.lastWarn = now;
      this.blip(620, 0.18, 0.1);
    }
    this.lockTarget = s.loadout.missileIR > 0 ? this.weapons.findIRLock(this.pos, fwd) : null;
    if (this.lockTarget && this.weapon === "missileIR" && now - this.lastLockTone > 420) {
      this.lastLockTone = now;
      this.blip(1150, 0.09, 0.06, "sine");
    }
    const tw = this.weapons.warning;
    if (tw) {
      const iv = tw.kind === "lock" ? 1100 : Math.max(110, Math.min(800, tw.dist / 6));
      if (now - this.lastThreatBeep > iv) {
        this.lastThreatBeep = now;
        this.blip(tw.kind === "radar" ? 1300 : tw.kind === "ir" ? 1750 : 900, 0.08, 0.1, "square");
      }
    }

    // ---- canhão, armas e contramedidas
    this.cannonT -= dt;
    this.fireT -= dt;
    if (k.has("Space") || this.mouseFire || this.virtualFire) {
      if (this.weapon === "cannon" && this.ammo.cannon > 0 && this.cannonT <= 0) {
        const a10 = s.id === "a10";
        this.cannonT = 1 / (a10 ? 32 : 16);
        for (let i = 0; i < (a10 ? 2 : 1) && this.ammo.cannon > 0; i++) {
          this.ammo.cannon--;
          this.weapons.fireCannon(this.pos.clone().addScaledVector(fwd, s.length * 0.48), fwd, this.vel, a10 ? 0.011 : 0.005, WEAPON_DMG[s.id] ?? 16);
        }
        this.blip(a10 ? 85 : 140, 0.05, 0.08, "sawtooth");
      } else if (this.weapon !== "cannon") this.fireOnce();
    }
    this.dispenseCM(dt);

    // ---- zona de controle
    const distField = Math.hypot(this.pos.x - this.layout.active.cx, this.pos.z - this.layout.active.cz);
    this.airspaceWarning = !contactNow && distField < 9000 && !this.clearance.airspace && !this.clearance.takeoff;
    if (this.airspaceWarning && now - this.lastViolation > 25000) {
      this.lastViolation = now;
      this.opts.onRadio(`TORRE ${this.opts.airport.atcName.toUpperCase()}`, `${this.opts.callsign}, aeronave sem autorização na zona de controle! Identifique-se e solicite decolagem ou entrada na zona.`, "atc");
    }

    // ---- reabastecer / rearmar / reparar no pátio
    if (contactNow && this.vel.length() < 1 && this.brake && this.pos.distanceTo(this.layout.apron) < 420) {
      this.repairT += dt;
      if (this.repairT >= 4) {
        this.repairT = 0;
        if (this.hp < this.hpMax || this.fuel < 0.99 || JSON.stringify(this.ammo) !== JSON.stringify(s.loadout) || this.cm.flare < s.cm.flare || this.cm.chaff < s.cm.chaff) {
          this.hp = this.hpMax;
          this.fuel = 1;
          this.ammo = { ...s.loadout };
          this.cm = { ...s.cm };
          this.opts.onRadio("SISTEMA", "🔧 Equipe de solo: aeronave reabastecida, rearmada (flares/chaff incluídos) e reparada.", "system");
        }
      }
    } else this.repairT = 0;

    // ---- efeitos visuais da aeronave (compressão real do amortecedor e painéis de spoiler)
    const mdl = this.model;
    const compY = this.gearCompression * s.gearHeight * 0.32;
    mdl.group.position.copy(this.pos);
    mdl.group.position.y -= compY;
    mdl.group.quaternion.copy(this.quat);
    mdl.gear.visible = this.gearPos > 0.03;
    mdl.gear.scale.y = Math.max(0.01, this.gearPos * (1 - this.gearCompression * 0.35));
    for (const spPanel of mdl.spoilers) spPanel.rotation.x = this.spoilerPos * 1.02;
    this.landLight.intensity = this.lights.landing ? 2600 : 0;
    for (const g of mdl.ab) {
      g.visible = ab;
      if (ab) g.scale.set(1, 1, 0.75 + Math.random() * 0.45);
    }
    for (const n of mdl.nozzleGlow) (n.material as THREE.MeshBasicMaterial).opacity = 0.1 + this.eng * 0.55;
    this.abLight.intensity = ab ? 900 + Math.random() * 300 : 0;
    if (mdl.prop) mdl.prop.rotation.z += dt * (8 + this.eng * 70);
    if (mdl.propDisc) (mdl.propDisc.material as THREE.MeshBasicMaterial).opacity = this.eng > 0.15 ? 0.13 : 0;
    // ---- luzes externas (nav / beacon / strobe / pouso-táxi)
    for (const n of mdl.nav) n.visible = this.lights.nav;
    const beaconPhase = now % 1100;
    for (const b of mdl.beacons) b.visible = this.lights.beacon && beaconPhase < 140;
    const strobePhase = now % 1500;
    const strobeOn = this.lights.strobe && (strobePhase < 70 || (strobePhase > 150 && strobePhase < 220));
    for (const st of mdl.strobes) st.visible = strobeOn;
    for (const l of mdl.landing) l.visible = this.lights.landing;
    mdl.stores.bomb.forEach((o, j) => (o.visible = j < this.ammo.bomb));
    mdl.stores.missileIR.forEach((o, j) => (o.visible = j < this.ammo.missileIR));
    mdl.stores.missileRAD.forEach((o, j) => (o.visible = j < this.ammo.missileRAD));

    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.04;
      if (!contactNow && (this.gForce > 4.5 || (Math.abs(alpha) > 0.2 && V > 90))) {
        for (const wt of mdl.wingtips) this.fx.puff(mdl.group.localToWorld(wt.clone()), [2.2, 2.2, 2.3], 0.45, 0.6, 3.5, 1.1);
      }
      if (hpFrac < 0.6) {
        for (const ex of mdl.exhausts.length ? mdl.exhausts : [new THREE.Vector3(0, 0, s.length * 0.5)]) {
          const p = mdl.group.localToWorld(ex.clone());
          this.fx.puff(p, [0.12, 0.11, 0.1], 0.75, 1.5, 9, 3.5);
          if (hpFrac < 0.3) this.fx.flame(p, 1.6);
        }
      }
      // fumaça dos pneus no toque
      if (touching && !this.wasTouchingSmoke && this.vel.length() > 25) {
        for (const gx of [-1.2, 1.2]) this.fx.dust(mdl.group.localToWorld(new THREE.Vector3(gx, -s.gearHeight, 0.5)), false);
      }
    }
    this.wasTouchingSmoke = touching;

    // ---- áudio realista (atualizado também quando acompanhando voo ADS-B)
    if (this.audio) {
      const followed = this.followHex ? this.live?.getFollowView(this.followHex) : null;
      if (followed) {
        const fFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(followed.quat);
        const fAgl = Math.max(0, followed.pos.y - groundHeight(followed.pos.x, followed.pos.z));
        this.audio.update({
          eng: followed.info.onGround ? 0.25 : 0.72,
          ab: false,
          speed: followed.vel.length(),
          alpha: 0.04,
          agl: fAgl,
          gearPos: followed.info.onGround ? 1 : 0,
          spoilerPos: 0,
          inCloud: 0,
          cockpit: false,
          srcPos: followed.pos,
          srcVel: followed.vel,
          srcFwd: fFwd,
          camPos: this.camera.position,
          camVel: this.camVel,
          followingExternal: true,
          isJetOverride: followed.isJet,
        });
      } else {
        this.audio.update({
          eng: this.eng,
          ab,
          speed: V,
          alpha,
          agl,
          gearPos: this.gearPos,
          spoilerPos: this.spoilerPos,
          inCloud: this.inCloud,
          cockpit: this.cameraMode === "cockpit",
          srcPos: this.pos,
          srcVel: this.vel,
          srcFwd: fwd,
          camPos: this.camera.position,
          camVel: this.camVel,
        });
      }
    }
  }
  private wasTouchingSmoke = true;

  private collisions(now: number) {
    const r = this.spec.span * 0.38;
    const protectedNow = now < this.spawnProtectUntil;
    for (const d of this.registry.items) {
      if (!d.alive) continue;
      if (d.kind === "aircraft" || d.kind === "remote" || d.kind === "drone") {
        // logo após nascer não colide com outras aeronaves (evita morte instantânea)
        if (protectedNow && (d.kind === "remote" || d.kind === "aircraft")) continue;
        const rr = r + d.radius * 0.75;
        if (d.center.distanceToSquared(this.pos) > (rr + 60) ** 2) continue;
        if (segSphere(this.prevPos, this.pos, d.center, rr) !== null) {
          const name = d.name;
          this.registry.damage(d, 9999, this.pos.clone(), "collision", true, now);
          this.crash(`colisão em voo com ${name}`, d.kind === "remote" ? name : null);
          return;
        }
      } else if (this.registry.distanceTo(d, this.pos) < r * 0.3) {
        const name = d.name;
        this.registry.damage(d, 600, this.pos.clone(), "collision", true, now);
        this.crash(`colidiu com ${name}`);
        return;
      }
    }
  }

  // ------------------------------------------------------------ câmera
  private updateCamera(dt: number, now: number) {
    // 1. Modo acompanhar voo ADS-B em 3D com câmera livre por mouse + zoom
    if (this.followHex) {
      const fv = this.live?.getFollowView(this.followHex);
      if (fv) {
        const baseR = Math.max(24, fv.span * 1.45) * this.camOrbit.distMul;
        const fFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(fv.quat);
        const hYaw = Math.atan2(fFwd.x, fFwd.z) + this.camOrbit.yaw;
        const cp = Math.cos(this.camOrbit.pitch), sp = Math.sin(this.camOrbit.pitch);
        const offset = new THREE.Vector3(Math.sin(hYaw) * cp, sp, Math.cos(hYaw) * cp).multiplyScalar(baseR);
        const target = fv.pos.clone().add(offset);
        const gy = groundHeight(target.x, target.z) + 2;
        if (target.y < gy) target.y = gy;
        this.camera.position.lerp(target, 1 - Math.exp(-8 * dt));
        this.camera.up.copy(UP);
        this.camera.lookAt(fv.pos);
        this.camera.fov = 58;
        this.camera.updateProjectionMatrix();
        this.model.group.visible = !this.crashed;
        return;
      }
      // se o voo saiu do feed ADS-B, volta suavemente para a própria aeronave
      this.followHex = null;
      this.opts.onRadio("SISTEMA", "Voo seguido saiu do alcance ADS-B — retornando à sua aeronave.", "system");
    }

    const s = this.spec;
    const fwd = this.forward(), up = this.up();
    if (this.cameraMode === "chase") {
      const dist = (s.length * 1.55 + 10) * this.camOrbit.distMul;
      const offset = new THREE.Vector3(0, 0, 1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.camOrbit.pitch)
        .applyAxisAngle(UP, this.camOrbit.yaw)
        .multiplyScalar(dist);
      // quando sem rotação livre do usuário, acompanha a atitude suave da aeronave; quando orbitado com o mouse, orbita livremente
      const userMoved = Math.abs(this.camOrbit.yaw) > 0.02 || Math.abs(this.camOrbit.pitch - 0.2) > 0.02;
      const target = userMoved
        ? this.pos.clone().add(offset.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-fwd.x, -fwd.z))))
        : this.pos.clone().addScaledVector(fwd, -dist).addScaledVector(up, dist * 0.26).add(new THREE.Vector3(0, 1.5 - this.gearCompression * s.gearHeight * 0.2, 0));
      const gy = groundHeight(target.x, target.z) + 1.5;
      if (target.y < gy) target.y = gy;
      this.camera.position.lerp(target, 1 - Math.exp(-7 * dt));
      this.camera.up.copy(userMoved ? UP : up.clone().lerp(UP, 0.6));
      this.camera.lookAt(userMoved ? this.pos : this.pos.clone().addScaledVector(fwd, 40));
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 60 + this.vel.length() * 0.02, 0.05);
    } else if (this.cameraMode === "cockpit") {
      const compOffset = -this.gearCompression * s.gearHeight * 0.32;
      this.camera.position.copy(this.pos).add(new THREE.Vector3(0, s.cockpit[0] + compOffset, s.cockpit[1]).applyQuaternion(this.quat));
      this.camera.quaternion.copy(this.quat);
      this.camera.up.copy(up);
      this.camera.fov = 74;
    } else if (this.cameraMode === "tower") {
      this.camera.position.copy(this.layout.tower);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.pos);
      this.camera.fov = clamp(3500 / Math.max(60, this.camera.position.distanceTo(this.pos)), 4, 60);
    } else if (this.cameraMode === "flyby") {
      if (this.flybyPos.distanceTo(this.pos) > 900 || this.pos.clone().sub(this.flybyPos).dot(this.vel) > 250 * Math.max(1, this.vel.length() / 60)) this.placeFlyby();
      this.camera.position.copy(this.flybyPos);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.pos);
      this.camera.fov = clamp(2400 / Math.max(40, this.flybyPos.distanceTo(this.pos)), 12, 60);
    } else {
      if (!this.camOrbit.dragging) this.camOrbit.yaw += dt * 0.14;
      const r = (s.length * 2.4 + 10) * this.camOrbit.distMul;
      const cp = Math.cos(this.camOrbit.pitch), sp = Math.sin(this.camOrbit.pitch);
      const target = new THREE.Vector3(
        this.pos.x + Math.sin(this.camOrbit.yaw) * cp * r,
        this.pos.y + sp * r,
        this.pos.z + Math.cos(this.camOrbit.yaw) * cp * r
      );
      const gy = groundHeight(target.x, target.z) + 1.5;
      if (target.y < gy) target.y = gy;
      this.camera.position.copy(target);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.pos);
      this.camera.fov = 55;
    }
    const shake = Math.max(0, 1 - (now - this.lastHit) / 450) + (this.stallFlag ? 0.14 : 0) + (this.inCloud * (this.inCB ? 0.25 : 0.08));
    if (shake > 0 && this.cameraMode !== "tower" && this.cameraMode !== "flyby") {
      this.camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(shake * 0.55));
    }
    this.camera.updateProjectionMatrix();
    this.model.group.visible = !this.crashed && this.cameraMode !== "cockpit";
  }

  // ------------------------------------------------------------ loop
  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;

    if (this.paused) {
      // mantém o render e o HUD vivos, mas congela física, tráfego, relógio e áudio
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 12;
        this.opts.onSnapshot(this.snapshot(t));
      }
      return;
    }

    // relógio da simulação + iluminação/clima
    this.simMs += dt * 1000 * this.timeScale;
    this.envT += dt;
    if (this.envDirty || this.envT > (this.timeScale > 1 ? 0.4 : 3)) {
      this.envT = 0;
      this.envDirty = false;
      this.world.setEnvironment(new Date(this.simMs), this.wx);
      this.hemiBase = this.world.hemi.intensity;
      this.applyWeather0();
    }
    if (this.wx.thunder) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 5 + Math.random() * 11;
        this.flash = 1;
        this.noiseBurst(2.4, 0.5, 170, "lowpass", 0.8 + Math.random() * 4);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    this.world.hemi.intensity = this.hemiBase + this.flash * 3.5;

    this.physics(dt, t);
    this.weapons.eye.copy(this.camera.position);
    this.weapons.update(dt, this.guide(), t, this.playerState());
    const gAgl = this.pos.y - groundHeight(this.pos.x, this.pos.z);
    const onRunway = !this.crashed && gAgl < this.spec.gearHeight + 1 && insideRunway(this.layout, this.pos.x, this.pos.z, 5) === this.layout.active;
    this.traffic.update(dt, t, { pos: this.pos, onGround: gAgl < this.spec.gearHeight + 1, onRunway });
    this.live.update(dt, t, this.pos, this.labelsOn, this.followHex);
    this.trailGeoT -= dt;
    if (this.trailGeoT <= 0) {
      this.trailGeoT = 1.5;
      const [tLat, tLon] = this.frame.toLatLon(this.pos.x, this.pos.z);
      const last = this.trailGeo[this.trailGeo.length - 1];
      if (!last || Math.hypot(last[0] - tLat, last[1] - tLon) > 0.00025) {
        this.trailGeo.push([tLat, tLon]);
        if (this.trailGeo.length > 250) this.trailGeo.shift();
      }
    }

    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const age = Math.min(1.2, (t - r.t) / 1000);
      const pred = new THREE.Vector3(r.st.x + r.st.vx * age, r.st.y + r.st.vy * age, r.st.z + r.st.vz * age);
      const g = r.model.group;
      g.position.lerp(pred, 1 - Math.exp(-8 * dt));
      g.quaternion.slerp(new THREE.Quaternion(r.st.qx, r.st.qy, r.st.qz, r.st.qw), 1 - Math.exp(-8 * dt));
      r.model.gear.visible = r.st.gear;
      if (r.model.prop) r.model.prop.rotation.z += dt * 40;
      for (const st of r.model.strobes) st.visible = t % 1300 < 70;
      r.dmg.center.copy(g.position);
      if (r.st.hp < 50 && Math.random() < 0.3) this.fx.puff(g.position, [0.12, 0.11, 0.1], 0.7, 2, 9, 3);
    }

    this.registry.update(t);
    this.fx.update(dt);
    this.updateCamera(dt, t);
    this.camVel.copy(this.camera.position).sub(this.lastCam).divideScalar(Math.max(dt, 1e-3));
    this.lastCam.copy(this.camera.position);
    this.precip.update(dt, this.camera.position, this.camVel);
    const followPos = this.followHex ? this.live.getFollowView(this.followHex)?.pos ?? this.pos : this.pos;
    this.world.update(dt, t, this.camera, this.cameraMode === "tower" || this.cameraMode === "flyby" ? this.pos : this.camera.position, this.windVec, followPos, this.inCloud, this.inCB);
    this.terrain.update(this.pos.x, this.pos.z, t);
    this.world.updateShadow(this.pos);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 1 / 12;
      this.opts.onSnapshot(this.snapshot(t));
    }
  };

  /** mantém a precipitação coerente com o vento atual */
  private applyWeather0() {
    this.precip.set(this.precip.mode, this.precip.intensity, this.windVec);
  }

  private snapshot(now: number): Snapshot {
    const eu = new THREE.Euler().setFromQuaternion(this.quat, "YXZ");
    const fwd = this.forward();
    let heading = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
    if (heading < 0) heading += 360;
    const gs = this.vel.length();
    const groundY = groundHeight(this.pos.x, this.pos.z);
    const elev = this.opts.airport.elevM;
    const radar: Snapshot["radar"] = [];
    const range = 8000;
    const cosH = Math.cos((-heading * Math.PI) / 180), sinH = Math.sin((-heading * Math.PI) / 180);
    const push = (wx: number, wz: number, kind: "traffic" | "hostile" | "player") => {
      const dx = wx - this.pos.x, dz = wz - this.pos.z;
      const rx = dx * cosH - dz * sinH, ry = dx * sinH + dz * cosH;
      if (Math.abs(rx) < range && Math.abs(ry) < range) radar.push({ x: rx / range, y: -ry / range, kind });
    };
    for (const p of this.traffic.planes) if (p.state === "ok") push(p.pos.x, p.pos.z, "traffic");
    for (const c of this.live.contacts()) push(c.pos.x, c.pos.z, "traffic");
    for (const d of this.registry.items) if (d.alive && d.team === "hostile") push(d.center.x, d.center.z, "hostile");
    for (const r of this.remotes.values()) if (r.alive) push(r.model.group.position.x, r.model.group.position.z, "player");
    const atm = airDensity(this.pos.y + elev, elev, this.wx);
    const tas = this.vel.clone().sub(this.windVec).length();
    const w = this.wx;
    return {
      speedKt: gs * KTS,
      ias: tas * KTS * Math.sqrt(atm.sigma),
      mach: tas / atm.a,
      altFt: (this.pos.y + elev) * FT,
      aglFt: Math.max(0, (this.pos.y - groundY - this.spec.gearHeight) * FT),
      vsFpm: this.vel.y * 196.85,
      headingDeg: heading,
      pitchDeg: (eu.x * 180) / Math.PI,
      rollDeg: (-eu.z * 180) / Math.PI,
      throttle: this.throttle,
      afterburner: this.spec.afterburner && this.eng > 0.9,
      gForce: this.gForce,
      fuelPct: this.fuel * 100,
      gear: this.gearDown(),
      gearPos: this.gearPos,
      flaps: this.flaps,
      brake: this.brake,
      stall: !this.crashed && this.stallFlag,
      overspeed: gs > this.spec.maxSpeed * 0.97,
      onGround: this.onGroundNow,
      crashed: this.crashed,
      score: this.score,
      kills: this.kills,
      weapon: this.weapon,
      ammo: { ...this.ammo },
      cm: { ...this.cm },
      threat: this.weapons.warning,
      lock: this.lockTarget ? { name: this.lockTarget.name, dist: this.lockTarget.center.distanceTo(this.pos) } : null,
      camera: this.cameraMode,
      airspaceWarning: this.airspaceWarning,
      radar,
      time: now,
      hp: Math.max(0, this.hp),
      hpMax: this.hpMax,
      hitFlash: Math.max(0, 1 - (now - this.lastHit) / 700),
      engineFire: this.hp < this.hpMax * 0.3 && !this.crashed,
      repair: this.repairT / 4,
      towerAlive: this.world.towerAlive(),
      runway: this.layout.activeIdent,
      mouse: { on: this.mouseMode, x: this.mouse.x, y: this.mouse.y },
      invert: this.invertPitch,
      rudderCoupled: this.rudderCoupled,
      massKg: Math.round(this.currentMassKg),
      fuelKg: Math.round(this.currentFuelKg),
      weaponsKg: Math.round(this.currentWeaponsKg),
      gearCompression: this.gearCompression,
      inCloud: this.inCloud,
      inCB: this.inCB,
      paused: this.paused,
      muted: this.muted,
      followHex: this.followHex,
      followed: this.followHex ? this.live.getFollowView(this.followHex)?.info ?? null : null,
      spoiler: this.spoilerPos,
      lights: { ...this.lights },
      simMs: this.simMs,
      timeScale: this.timeScale,
      sunEl: this.world.state.elev,
      wx: {
        summary: w.summary, tempC: w.tempC, wind: windText(w), windKt: windKt(w), windDir: w.windDir,
        visKm: w.visM / 1000, cloud: w.cloud, qnh: Math.round(w.pressureHpa), precip: Math.max(w.precip, w.snow), live: w.source === "live",
      },
      adsb: this.live.info(),
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.wxTimer);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    const cvs = this.renderer.domElement;
    cvs.removeEventListener("pointerdown", this.onPointerDown);
    cvs.removeEventListener("dblclick", this.onDblClick);
    cvs.removeEventListener("wheel", this.onWheel);
    cvs.removeEventListener("contextmenu", this.onContext);
    this.audio?.dispose();
    this.live?.dispose();
    this.terrain.dispose();
    setActiveTerrain(null);
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}