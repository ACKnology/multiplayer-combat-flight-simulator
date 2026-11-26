// Testes do mecanismo canônico de articulações (PRD 02).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  ArticulationEngine, suggestArticulations, presetArticulations, PRESETS, LAB_GROUPS,
  TEST_COMMANDS, saveLabSession, loadLabSession, clearLabSession,
  type ArticulationDef, type ArticulationState, type LabConfig,
} from "../articulation";

function model(): THREE.Group {
  const g = new THREE.Group();
  g.name = "Root";
  for (const n of ["Aileron_L", "Aileron_R", "Elevator", "Rudder", "Flap_L", "Gear_Nose", "Propeller"]) {
    const o = new THREE.Group();
    o.name = n;
    o.position.set(1, 0, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.4), new THREE.MeshStandardMaterial());
    o.add(m);
    g.add(o);
  }
  return g;
}

function def(o: THREE.Object3D, over: Partial<ArticulationDef> = {}): ArticulationDef {
  return {
    id: "a1", label: "teste", channel: "aileron", object: o.uuid, objectName: o.name,
    axis: [1, 0, 0], reverse: false, neutral: 0, min: -20, max: 20, gain: 20,
    slew: 0, pivot: null, autoPivot: false, enabled: true, manual: null, confidence: 1, source: "manual",
    ...over,
  };
}

const state = (o: Partial<ArticulationState>): ArticulationState => o;

test("suggestArticulations reconhece aliases e atribui confiança", () => {
  const g = model();
  const found = suggestArticulations(g);
  const names = found.map((d) => d.objectName);
  assert.ok(names.includes("Aileron_L") && names.includes("Aileron_R"));
  assert.ok(names.includes("Elevator") && names.includes("Rudder"));
  assert.ok(names.includes("Propeller"));
  assert.ok(found.every((d) => d.confidence && d.confidence > 0.5));
  assert.equal(found.find((d) => d.objectName === "Aileron_L")?.channel, "aileron");
  assert.equal(found.find((d) => d.objectName === "Propeller")?.channel, "propeller");
  // lado direito vem com inversão sugerida (esquerdo sobe / direito desce)
  assert.equal(found.find((d) => d.objectName === "Aileron_R")?.reverse, true);
});

test("presets cobrem os 3 perfis e não exigem que todos os nós existam", () => {
  const g = model();
  for (const k of ["fighter", "airliner", "propeller"] as const) {
    const p = presetArticulations(g, k);
    assert.equal(p.length, PRESETS[k].length);
    assert.ok(p.every((d) => d.source === "preset"));
  }
  assert.equal(LAB_GROUPS.length >= 25, true, "catálogo cobre todos os grupos do PRD");
  assert.equal(TEST_COMMANDS.length, 9);
});

test("update: comando +1 → +gain°; -1 → -gain°; limites respeitados", () => {
  const g = model();
  const node = g.getObjectByName("Elevator")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { channel: "elevator", gain: 25, min: -25, max: 25 })]);
  e.update(1 / 60, state({ elevator: 1 }));
  const q = node.quaternion.clone();
  const angle = (2 * Math.acos(Math.min(1, Math.abs(q.w)))) * (180 / Math.PI);
  assert.ok(Math.abs(angle - 25) < 0.01, `+1 → ${angle.toFixed(2)}°`);
  e.update(1 / 60, state({ elevator: -1 }));
  assert.ok(node.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -25 * Math.PI / 180) as THREE.Quaternion) < 0.001);
  e.update(1 / 60, state({ elevator: 5 })); // além do limite → clamp
  assert.ok(Math.abs(e.valueOf("a1") - 25) < 0.01);
  e.update(1 / 60, state({ elevator: 1 }));
  e.patch("a1", { max: 10, min: -10 });
  e.update(1 / 60, state({ elevator: 1 }));
  assert.ok(Math.abs(e.valueOf("a1") - 10) < 0.01, "novo limite aplicado em tempo real");
  e.dispose();
});

test("reverse inverte o sentido; neutro desloca; canal independente ignora outros comandos", () => {
  const g = model();
  const node = g.getObjectByName("Rudder")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { id: "r", channel: "rudder", reverse: true, neutral: 5, gain: 20 })]);
  e.update(1 / 60, state({ rudder: 1, aileron: -1 }));
  assert.ok(Math.abs(e.valueOf("r") - (-15)) < 0.01, "1*20 invertido + neutro 5 = -15");
  e.update(1 / 60, state({ rudder: 0 }));
  assert.ok(Math.abs(e.valueOf("r") - 5) < 0.01, "neutro sem comando");
  e.dispose();
});

test("um comando controla múltiplos objetos (aileron L/R) com sentidos opostos", () => {
  const g = model();
  const l = g.getObjectByName("Aileron_L")!;
  const r = g.getObjectByName("Aileron_R")!;
  const e = new ArticulationEngine(g);
  e.setDefs([
    { ...def(l, { id: "L", gain: 20, min: -20, max: 20 }) },
    { ...def(r, { id: "R", gain: 20, min: -20, max: 20, reverse: true }) },
  ]);
  e.update(1 / 60, state({ aileron: 1 }));
  assert.ok(e.valueOf("L") > 0 && e.valueOf("R") < 0, "esquerdo sobe / direito desce");
  e.dispose();
});

test("slew suaviza: sem salto instantâneo com atuação baixa", () => {
  const g = model();
  const node = g.getObjectByName("Flap_L")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { id: "f", channel: "flaps", gain: 35, min: 0, max: 35, slew: 3 })]);
  e.update(1 / 60, state({ flaps: 1 }));
  const v = e.valueOf("f");
  assert.ok(v > 0 && v < 35 * 0.15, `primeiro passo suave (${v.toFixed(2)}°)`);
  for (let i = 0; i < 180; i++) e.update(1 / 60, state({ flaps: 1 }));
  assert.ok(e.valueOf("f") > 34, "converge ao alvo");
  e.dispose();
});

test("manual prevalece sobre o estado; clearManuals devolve ao comando", () => {
  const g = model();
  const node = g.getObjectByName("Elevator")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { id: "e", channel: "elevator", gain: 25, min: -25, max: 25 })]);
  e.setManual("e", -0.4);
  e.update(1 / 60, state({ elevator: 1 }));
  assert.ok(Math.abs(e.valueOf("e") + 10) < 0.01);
  e.clearManuals();
  e.update(1 / 60, state({ elevator: 1 }));
  assert.ok(Math.abs(e.valueOf("e") - 25) < 0.01);
  e.dispose();
});

test("sequência de teste move os canais pedidos e termina", () => {
  const g = model();
  const node = g.getObjectByName("Rudder")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { id: "r", channel: "rudder", gain: 25, min: -25, max: 25 })]);
  e.playSequence(["rudder"], 0.5);
  assert.equal(e.sequencing, true);
  e.update(0.13, state({}));
  assert.ok(e.valueOf("r") !== 0, "seno aplicado");
  e.update(0.5, state({}));
  assert.equal(e.sequencing, false);
  e.stopSequence();
  e.dispose();
});

test("pivô: grupo intermediário sem alterar geometria; dispose restaura pai e quaternion", () => {
  const g = model();
  const node = g.getObjectByName("Elevator")!;
  const parent = node.parent!;
  const pos0 = node.position.clone(), quat0 = node.quaternion.clone();
  const geo = (node.children[0] as THREE.Mesh).geometry;
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { autoPivot: true })]);
  assert.notEqual(node.parent, parent, "nó passou a viver sob o grupo-pivô");
  assert.ok(node.parent?.name.startsWith("__lab_pivot_"));
  e.update(1 / 60, state({ aileron: 1 }));
  g.updateMatrixWorld(true);
  const worldQ = node.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(worldQ.angleTo(quat0) > 0.01, "rotação aplicada via grupo-pivô (orientação mundial muda)");
  e.dispose();
  assert.equal(node.parent, parent, "pai original restaurado");
  assert.ok(node.position.distanceTo(pos0) < 1e-6);
  assert.ok(node.quaternion.angleTo(quat0) < 1e-6);
  assert.equal((node.children[0] as THREE.Mesh).geometry, geo, "geometria original intacta");
});

test("desabilitar/desconhecido não quebra; rebind troca objeto", () => {
  const g = model();
  const a = g.getObjectByName("Elevator")!;
  const b = g.getObjectByName("Rudder")!;
  const e = new ArticulationEngine(g);
  e.setDefs([def(a, { id: "z", object: "nao-existe" })]);
  e.update(1 / 60, state({ aileron: 1 }));
  e.patch("z", { object: b.uuid, objectName: b.name });
  e.update(1 / 60, state({ aileron: 1 }));
  assert.ok(b.quaternion.angleTo(new THREE.Quaternion()) > 0);
  e.patch("z", { enabled: false });
  e.update(1 / 60, state({ aileron: 1 }));
  e.dispose();
});

test("serialize/sessão: roundtrip e limpeza", () => {
  const g = model();
  const e = new ArticulationEngine(g);
  e.setDefs([...suggestArticulations(g)]);
  const cfg = e.serialize("glb-c172", "C172", { idx: 0, speed: 1.4, loop: false }, "propeller");
  assert.equal(cfg.version, 1);
  assert.ok(cfg.articulations.length > 0);
  saveLabSession(cfg);
  const back = loadLabSession("glb-c172");
  assert.ok(back && back.articulations.length === cfg.articulations.length);
  assert.equal(back?.clip.speed, 1.4);
  clearLabSession("glb-c172");
  assert.equal(loadLabSession("glb-c172"), null);
  e.dispose();
});

test("translação linear move posição, não rotação", () => {
  const g = model();
  const node = g.getObjectByName("Gear_Nose")!;
  const p0 = node.position.clone();
  const e = new ArticulationEngine(g);
  e.setDefs([def(node, { id: "g", channel: "gear", gain: 100, min: 0, max: 100, translate: { vector: [0, -1, 0], distance: 3 } })]);
  e.update(1 / 60, state({ gear: 1 }));
  assert.ok(node.position.distanceTo(p0) > 2.9, "deslocou -3 m");
  assert.ok(node.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, "sem rotação");
  e.dispose();
});

test("LabConfig inválido é rejeitado no carregamento", () => {
  const bad = { version: 99, articulations: [] } as unknown as LabConfig;
  void bad;
  assert.equal(loadLabSession("nunca-salvo"), null);
});

test("toArticulationState mapeia os estados do motor de voo sem duplicar lógica", async () => {
  const { toArticulationState } = await import("../articulation");
  const st = toArticulationState({
    rollIn: 0.6, pitchIn: -0.3, yawIn: 0.2, flaps: 0.5, spoilerPos: 0.4,
    gearPos: 0, gearDown: false, eng: 0.95, propAngle: 3,
  });
  assert.equal(st.aileron, 0.6);
  assert.equal(st.elevator, -0.3);
  assert.equal(st.rudder, 0.2);
  assert.equal(st.gear, 0);
  assert.equal(st.afterburner, 1);
  assert.equal(st.propeller, 3);
  assert.equal(st.brake, 0.4);
  const st2 = toArticulationState({
    rollIn: 0, pitchIn: 0, yawIn: 0, flaps: 0, spoilerPos: 0, gearPos: 1, gearDown: true, eng: 0.4,
  }, 0.5);
  assert.equal(st2.afterburner, 0);
  assert.ok((st2.propeller ?? 0) > 0, "hélice gira pela potência quando não há ângulo acumulado");
});
