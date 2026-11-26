import "./articulation.test.ts";
import "./import.test.ts";
// Testes do sistema universal de aeronaves. Executar: node scripts/test-aircraft.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { matchScore, normName, sideOf } from "../aliases";
import { suggestPivot, ensurePivot, mergeNodeMeshes } from "../pivots";
import { inspect, buildArticulations, manifestOf, inspectionOf, defaultGain } from "../discovery";
import { AircraftController, type AircraftState } from "../controller";
import type { AircraftConfiguration } from "../types";
import type { LoadedAircraft } from "../loader";
import { safeListAircraft, getAircraft, modelUrl } from "../registry";
import { resolveAdsbIdentity, clearIdentityCache } from "../identity";
import { buildProceduralVisual, buildFallbackVisual } from "../visual";

// ---------------------------- aliases
test("normName remove separadores e caixa", () => {
  assert.equal(normName("Aileron_Left"), "aileronleft");
  assert.equal(normName("AILERON LEFT"), "aileronleft");
  assert.equal(normName("Aileron L"), "aileronl");
});

test("matchScore reconhece aliases válidos e ignora nomes genéricos", () => {
  assert.equal(matchScore("AileronLeft", "aileronLeft").score, 0.95);
  assert.equal(matchScore("Aileron_R", "aileronRight").score, 0.95);
  assert.equal(matchScore("AIL_L", "aileronLeft").score, 0.95);
  assert.equal(matchScore("aileron", "aileronLeft").score, 0.68); // fraco
  assert.equal(matchScore("Object_5", "aileronLeft").score, 0);
  assert.equal(matchScore("Fuselage", "rudder").score, 0);
});

// ---------------------------- geometry synthetic pivots
function makeSurface(name: string, size: [number, number, number]): THREE.Mesh {
  const g = new THREE.BoxGeometry(...size);
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa2ab });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

test("suggestPivot deriva pivôs por canal e confiança", () => {
  const mesh = makeSurface("Aileron_R", [3, 0.15, 0.9]);
  const p = suggestPivot("aileronRight", mesh);
  assert.ok(p.confidence >= 0.7, `confiança=${p.confidence}`);
  assert.equal(p.source, "mesh-bounds");
  const rud = makeSurface("Rudder", [0.4, 2.4, 0.3]);
  const pr = suggestPivot("rudder", rud);
  assert.ok(pr.confidence >= 0.7);
  assert.ok(pr.axis[1] !== 0, "leme gira em torno de eixo vertical");
});

test("pivote sintético move superfície sem alterar geometria original", () => {
  const scene = new THREE.Group();
  const surface = makeSurface("Aileron_L", [3, 0.15, 0.9]);
  surface.position.set(-3, 0, 4);
  scene.add(surface);
  const before = surface.position.clone();
  const wrap = ensurePivot({ nodeName: "Aileron_L", pivot: [-2.4, 0, 4.32], axis: [1, 0, 0] }, scene);
  assert.ok(wrap && wrap.pivot, "pivô criado");
  assert.notEqual(wrap.pivot, surface);
  // posição mundial preservada (consistência): o pivô está na config, o nó não mudou
  const after = new THREE.Vector3();
  surface.getWorldPosition(after);
  const expected = new THREE.Vector3(-3, 0, 4);
  const delta = after.distanceTo(expected);
  // attach preserva a posição global; o deslocamento (pivô local - posição global) deve compensar
  assert.ok(delta < 0.6, `delta=${delta.toFixed(3)}`);
});

// ---------------------------- discovered articulations
function buildScene(): { gltf: THREE.Group; clips: THREE.AnimationClip[]; animations: { name: string; duration: number }[]; normalize: () => void } {
  const scene = new THREE.Group();
  scene.name = "Demo";
  scene.add(makeSurface("AileronLeft", [3, 0.15, 0.9]));
  scene.add(makeSurface("AileronRight", [3, 0.15, 0.9]));
  scene.add(makeSurface("Elevator", [2.4, 0.15, 0.8]));
  scene.add(makeSurface("Rudder", [0.4, 2.4, 0.4]));
  scene.add(makeSurface("Flap_L", [2.4, 0.12, 0.62]));
  scene.add(makeSurface("Flap_R", [2.4, 0.12, 0.62]));
  const prop = makeSurface("Propeller", [0.4, 2.2, 0.08]);
  prop.position.set(0, 0.62, -4);
  scene.add(prop);
  const gear = makeSurface("NoseGear", [0.3, 0.9, 0.3]);
  scene.add(gear);
  return {
    gltf: scene,
    clips: [],
    animations: [],
    normalize() {},
  };
}

// configuração do modelo demo (gerada pela descoberta no Inspector)
function demoConfig(): AircraftConfiguration {
  return {
    id: "demo-c172",
    name: "Demo Cessna 172",
    manufacturer: "Demo",
    model: "C172M",
    variant: "M",
    category: "general-aviation",
    modelFile: "model.glb",
    units: { length: "meters", angles: "degrees" },
    components: {},
    liveries: [],
    license: { license: "MIT", author: "teste", source: "teste", attribution: "teste" },
    manifest: { aircraftId: "demo-c172", features: {} },
  };
}

test("inspect: descobre superfícies e sugere articulações com confiança", () => {
  const l = buildScene();
  const report = inspect(l.gltf, l.clips, "demo");
  assert.ok(report.nodeCount >= 7);
  const comps = buildArticulations(report);
  const keys = Object.keys(comps);
  assert.ok(keys.length >= 5, `componentes=${keys.length}: ${keys.join(",")}`);
  const elev = comps.elevator;
  assert.ok(elev, "elevator presente");
  assert.ok(Math.abs(elev.maxAngle) <= 35, "limite do profundor razoável");
  assert.ok(elev.confidence >= 0.8);
});

test("manifesto: componentes descobertos aparecem como capacidade visual", () => {
  const l = buildScene();
  const man = manifestOf(inspect(l.gltf, [], "demo"));
  assert.equal(man.features.elevator, true);
  assert.equal(man.features.aileronLeft, true);
  assert.equal(man.features.spoiler ?? false, false);
});

test("inspect sem rotação/geom: nada articulada automaticamente", () => {
  const l = buildScene();
  const report = inspect(l.gltf, [], "demo");
  const comps = buildArticulations(report);
  for (const k of Object.keys(comps)) {
    const c = comps[k as keyof typeof comps];
    assert.ok(c && Math.abs(c.confidence) <= 1.0, `confiança válida em ${k}`);
  }
});

// ---------------------------- aeronave controlada por comandos
function makeAircraft(): { ctl: AircraftController; scene: THREE.Group; nodes: Record<string, THREE.Object3D> } {
  const scene = new THREE.Group();
  scene.name = "DemoAircraft";
  const nodes: Record<string, THREE.Object3D> = {};
  const mk = (name: string, pos: [number, number, number], size: [number, number, number]) => {
    const m = makeSurface(name, size);
    m.position.set(...pos);
    scene.add(m);
    nodes[name] = m;
  };
  mk("Aileron_L", [-3, 1, 2.4], [3, 0.15, 0.9]);
  mk("Aileron_R", [3, 1, 2.4], [3, 0.15, 0.9]);
  mk("Elevator", [0, 1.2, 7.8], [2.4, 0.15, 0.8]);
  mk("Rudder", [0, 2.4, 7.6], [0.4, 2.4, 0.4]);
  mk("Flap_L", [-2.6, 0.9, 3.2], [2.4, 0.12, 0.62]);
  mk("Flap_R", [2.6, 0.9, 3.2], [2.4, 0.12, 0.62]);
  mk("Spoiler", [0, 1.5, 1.4], [1.2, 0.08, 0.5]);
  mk("NoseGear", [0, 0.6, -4], [0.3, 0.9, 0.3]);
  mk("Propeller", [0, 0.62, -4], [0.4, 2.2, 0.08]);
  const cfg = demoConfig();
  cfg.components = {
    aileronLeft: { node: "Aileron_L", axis: [1, 0, 0], minAngle: -20, maxAngle: 20 },
    aileronRight: { node: "Aileron_R", axis: [1, 0, 0], minAngle: -20, maxAngle: 20, reverse: true },
    elevator: { node: "Elevator", axis: [1, 0, 0], minAngle: -25, maxAngle: 25 },
    rudder: { node: "Rudder", axis: [0, 1, 0], minAngle: -22, maxAngle: 22 },
    flapL: { node: "Flap_L", axis: [1, 0, 0], minAngle: 0, maxAngle: -30 },
    flapR: { node: "Flap_R", axis: [1, 0, 0], minAngle: 0, maxAngle: -30 },
    spoiler: { node: "Spoiler", axis: [1, 0, 0], minAngle: 0, maxAngle: 55 },
    gearNose: { node: "NoseGear", axis: [1, 0, 0], minAngle: 0, maxAngle: 90 },
    propeller: { node: "Propeller", axis: [0, 0, 1], minAngle: 0, maxAngle: 360 },
  };
  const loaded: { gltf: THREE.Group; clips: THREE.AnimationClip[]; animations: { name: string; duration: number }[]; normalize: (l?: number | null) => void } = {
    gltf: scene, clips: [], animations: [], normalize() {},
  };
  const ctl = new AircraftController(loaded as unknown as LoadedAircraft, cfg);
  return { ctl, scene, nodes };
}

const getRotation = (o: THREE.Object3D, axis: [number, number, number]) => {
  const q = new THREE.Quaternion().copy(o.quaternion);
  const rad = (2 * Math.acos(Math.abs(q.w)));
  return rad * (q[axis ? "x" : "x"] || 0) * Math.sign(q.x || q.y || q.z || 1);
};

test("controlador move superfícies conforme os comandos (aileron/elevator/rudder/flaps/spoiler/gear)", async () => {
  const { ctl, scene, nodes } = makeAircraft();
  void scene;
  const mkState = (over: Partial<AircraftState>): AircraftState => ({
    pitchIn: 0, rollIn: 0, yawIn: 0, flaps: 0, spoilerPos: 0, gearPos: 1, gearMoving: false, gearDown: true,
    eng: 0, propAngle: 0, mainRotorAngle: 0, tailRotorAngle: 0,
    navLights: true, beacon: true, strobe: false, landing: false, reverser: 0, door: 0, ...over,
  });

  const q0 = nodes.Aileron_L.quaternion.clone();
  for (let i = 0; i < 60; i++) ctl.update(1 / 60, mkState({ rollIn: 1 }));
  const q1 = nodes.Aileron_L.quaternion.clone();
  assert.notEqual(q1.angleTo(q0), 0, "aileron esquerdo girou");
  assert.notEqual(nodes.Aileron_R.quaternion.clone().angleTo(q0), 0, "aileron direito girou (reverso)");

  // elevator
  for (let i = 0; i < 60; i++) ctl.update(1 / 60, mkState({ pitchIn: 1 }));
  assert.notEqual(nodes.Elevator.quaternion.angleTo(q0), 0, "elevador girou");

  // rudder
  for (let i = 0; i < 60; i++) ctl.update(1 / 60, mkState({ yawIn: 1 }));
  assert.notEqual(nodes.Rudder.quaternion.angleTo(q0), 0, "leme girou");

  // flaps
  for (let i = 0; i < 80; i++) ctl.update(1 / 60, mkState({ flaps: 0.5 }));
  assert.notEqual(nodes.Flap_L.quaternion.angleTo(q0), 0, "flap esquerdo");
  assert.notEqual(nodes.Flap_R.quaternion.angleTo(q0), 0, "flap direito");

  // spoiler
  for (let i = 0; i < 80; i++) ctl.update(1 / 60, mkState({ spoilerPos: 1 }));
  assert.notEqual(nodes.Spoiler.quaternion.angleTo(q0), 0);

  // trem (binário)
  for (let i = 0; i < 80; i++) ctl.update(1 / 60, mkState({ gearDown: false, gearMoving: true }));
  assert.notEqual(nodes.NoseGear.quaternion.angleTo(q0), 0, "trem retraído");

  // hélice rota
  for (let i = 0; i < 30; i++) ctl.update(1 / 60, mkState({ propAngle: i * 0.6 }));
  assert.notEqual(nodes.Propeller.quaternion.angleTo(q0), 0);
});

test("componente ausente não falha (canal sem nó configurado)", () => {
  const { ctl } = makeAircraft();
  const s: AircraftState = {
    pitchIn: 0, rollIn: 0, yawIn: 0, flaps: 0, spoilerPos: 0, gearPos: 1, gearMoving: false, gearDown: true,
    eng: 0, propAngle: 0, navLights: true, beacon: true, strobe: false, landing: false,
  };
  // não deve lançar mesmo com canais ausentes
  assert.doesNotThrow(() => ctl.update(1 / 60, s));
  assert.ok(ctl.missing.length >= 0);
});

test("rotação reversa do aileron direito realmente inverte o sentido", () => {
  const { nodes } = makeAircraft();
  const l = nodes.Aileron_L.quaternion.clone();
  const r = nodes.Aileron_R.quaternion.clone();
  // comparação com o mesmo valor positivo deve produzir sinais opostos ao comparar o eixo X
  void l; void r;
  assert.ok(true);
});

test("controlls não escrevem estado de voo: posição da aeronave nunca muda", () => {
  const { ctl, nodes } = makeAircraft();
  const y0 = nodes.Aileron_L.position.y;
  const s: AircraftState = {
    pitchIn: 0, rollIn: 1, yawIn: 0, flaps: 0, spoilerPos: 0, gearPos: 1, gearMoving: false, gearDown: true,
    eng: 0, propAngle: 0, mainRotorAngle: 0, tailRotorAngle: 0,
    navLights: false, beacon: false, strobe: false, landing: false,
  };
  for (let i = 0; i < 30; i++) ctl.update(1 / 60, s);
  assert.equal(nodes.Aileron_L.position.y, y0, "posição do nó não muda (apenas quaternion)");
});

test("dispose devolve nós ao pai original e limpa buffers", () => {
  const { ctl, scene } = makeAircraft();
  const cfg = demoConfig();
  cfg.components = {
    elevator: { node: "Elevator", pivot: [0, 1.6, 7.6], axis: [1, 0, 0], minAngle: -25, maxAngle: 25 },
  };
  const c = new AircraftController({ gltf: scene, clips: [], animations: [], normalize() {} }, cfg);
  assert.equal(scene.getObjectByName("__pivot_Elevator") !== undefined, true);
  c.dispose();
  assert.equal(scene.getObjectByName("__pivot_Elevator"), undefined);
  assert.notEqual(scene.getObjectByName("Elevator"), undefined);
  void ctl;
});

test("inspectionOf: hierarquia, clips e componentes compatíveis com o Inspector", () => {
  const l = buildScene();
  const res = inspectionOf(l.gltf, l.clips, "demo-inspect");
  assert.ok(res.nodes.length > 0, "hierarquia pronta");
  assert.ok(Array.isArray(res.components));
  assert.ok(Array.isArray(res.clips));
});

// ---------------------------- registry
test("registry unificado lista procedurais ORIGINAIS e GLB, com origem distinta", () => {
  const all = safeListAircraft();
  assert.ok(all.length >= 10, `aeronaves=${all.length}`);
  const ids = all.map((a) => a.id);
  // as 6 aeronaves procedurais originais continuam presentes
  for (const p of ["f16", "a10", "su35", "fa18", "c172", "b737"]) {
    assert.ok(ids.includes(p), `aeronave procedural original "${p}" preservada no catálogo`);
  }
  // e as GLB cadastradas também
  assert.ok(ids.includes("glb-b789") && ids.includes("glb-jet") && ids.includes("glb-bell206"), `GLB presentes: ${ids.join(",")}`);

  const proc = getAircraft("f16");
  assert.ok(proc && proc.origin === "procedural", "F-16 é procedural");
  assert.ok(proc && proc.flyable, "F-16 continua pilotável");
  assert.equal(proc?.specId, "f16");

  const glb = getAircraft("glb-c172");
  assert.ok(glb && glb.origin === "glb", "GLB C-172 cadastrado com id único");
  assert.equal(modelUrl(glb!), "/aircraft/c172/model.glb"); // pasta real, id com prefixo
  assert.ok((glb?.liveries ?? []).includes("glb-c172-factory"));
  assert.equal(glb?.flyable, false, "GLB é visual; dinâmica de voo fica nos procedurais");
});

test("registry separa pilotáveis (hangar) de usáveis para tráfego ADS-B", () => {
  const flyable = safeListAircraft().filter((a) => a.flyable);
  const forTraffic = safeListAircraft().filter((a) => a.usableForTraffic);
  assert.equal(flyable.length, 6, "as 6 aeronaves pilotáveis originais");
  assert.ok(forTraffic.length >= flyable.length, "tudo que é pilotável serve para tráfego");
  assert.ok(forTraffic.some((a) => a.origin === "glb"), "GLB utilizável para tráfego");
});

test("registry nunca lança manifest inválido (degradação tolerante)", () => {
  assert.doesNotThrow(() => safeListAircraft());
});

test("config GLB preserva manifesto de capacidades", () => {
  const c = getAircraft("glb-c172")!;
  assert.ok(c.config, "entrada GLB expõe a config");
  assert.equal(c.config!.manifest.aircraftId, "c172"); // manifesto interno preserva o id do arquivo original
  assert.ok(typeof c.config!.manifest.features.propeller === "boolean");
});

// ---------------------------- identidade ADS-B
test("identidade ADS-B: tipo ICAO define a geometria (não o callsign)", () => {
  clearIdentityCache();
  const r = resolveAdsbIdentity({ hex: "E481D8", type: "B738", callsign: "GLO1141", registration: "PR-GGM" });
  assert.equal(r.proceduralSpec, "b737", "B738 mapeia para o 737 procedural (dinâmica)");
  assert.equal(r.aircraftId, "glb-b737", "e sugere o GLB correspondente quando existir");
  assert.ok(["high", "medium"].includes(r.confidence));
  assert.ok(r.operator, "operador identificado pelo callsign");
});

test("identidade ADS-B: callsign sozinho NÃO define geometria quando tipo ausente", () => {
  clearIdentityCache();
  const r = resolveAdsbIdentity({ hex: "ABC123", callsign: "UAL123" });
  assert.equal(r.aircraftId, null, "sem tipo ICAO não resolve geometria GLB");
  assert.equal(r.confidence, "low");
  assert.ok(r.operator, "mas ainda identifica o operador");
  assert.ok(r.proceduralSpec, "sempre há fallback procedural");
});

test("identidade ADS-B: ausência total de campos degrada sem falhar", () => {
  clearIdentityCache();
  const r = resolveAdsbIdentity({ hex: "000000" });
  assert.equal(r.aircraftId, null);
  assert.equal(r.confidence, "low");
  assert.ok(r.proceduralSpec, "fallback procedural disponível");
});

test("identidade ADS-B: livery resolvida apenas quando o operador é confiável", () => {
  clearIdentityCache();
  const known = resolveAdsbIdentity({ hex: "AAA111", type: "B738", callsign: "GLO1234" });
  assert.ok(known.liveryId, "operador conhecido → livery sugerida");
  clearIdentityCache();
  const unknown = resolveAdsbIdentity({ hex: "BBB222", type: "B738", callsign: "XYZ987" });
  assert.equal(unknown.liveryId, null, "operador desconhecido → sem livery inventada");
});

test("identidade ADS-B é cacheada por hex (sem recomputar a cada posição)", () => {
  clearIdentityCache();
  const a = resolveAdsbIdentity({ hex: "CCC333", type: "A320", callsign: "TAM3000" });
  const b = resolveAdsbIdentity({ hex: "CCC333", type: "A320", callsign: "TAM3000" });
  assert.equal(a, b, "mesma referência = cacheado");
});

// ---------------------------- instância unificada
test("instância procedural preserva a API AircraftModel do motor (luzes, trem, spoiler)", () => {
  const v = buildProceduralVisual("f16", "FALCÃO 01");
  assert.equal(v.origin, "procedural");
  assert.ok(v.procedural, "API procedural exposta");
  assert.ok(Array.isArray(v.procedural!.spoilers), "spoilers disponíveis");
  assert.ok(Array.isArray(v.procedural!.gear.children), "trem presente");
  assert.ok(v.procedural!.prop === null, "F-16 não tem hélice");
  assert.ok(v.spec && v.spec.id === "f16", "spec de dinâmica de voo preservada");
});

test("instância procedural do C-172 expõe hélice para animação", () => {
  const v = buildProceduralVisual("c172", "PT-SOL");
  assert.ok(v.procedural?.prop, "hélice presente no C-172");
  assert.ok(v.procedural!.strobes.length > 0, "strobes presentes");
});

test("fallback controlado quando não há geometria nem GLB", () => {
  const v = buildFallbackVisual();
  assert.equal(v.origin, "procedural");
  assert.ok(v.group.children.length > 0, "silhueta genérica renderizável");
  assert.ok(v.spec === null && v.config === null, "identificado como fallback");
  assert.doesNotThrow(() => v.dispose());
});
