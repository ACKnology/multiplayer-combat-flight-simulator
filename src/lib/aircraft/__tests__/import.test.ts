// Testes do módulo de importação GLB/GLTF (funções puras + stats sobre cena Three).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  normBase, pickMain, validateSelection, matchCompanion, collectExternalUris,
  computeStats, autoUnitFactor, disposeImported, materialTextureSlots,
  MAX_FILE_MB,
} from "../glbImport";

test("normBase canônica URIs (pastas, query, unicode, caixa)", () => {
  assert.equal(normBase("./textures/Tail Blue.png"), "tail blue.png");
  assert.equal(normBase("assets/cube.bin?v=2#x"), "cube.bin");
  assert.equal(normBase("a\\b\\c.glb"), "c.glb");
  assert.equal(normBase(encodeURIComponent("Aeronave.glb")), "aeronave.glb");
});

test("pickMain prioriza .glb e rejeita formatos errados", () => {
  assert.deepEqual(pickMain(["a.bin", "x.gltf", "y.glb"]), { name: "y.glb", kind: "glb" });
  assert.deepEqual(pickMain(["a.bin", "x.gltf"]), { name: "x.gltf", kind: "gltf" });
  assert.equal(pickMain(["modelo.obj", "tex.png"]), null);
});

test("validateSelection: sem main → erro; acima do limite → erro; .gltf sem .bin → aviso", () => {
  const empty = validateSelection([{ name: "notas.txt", size: 10 }]);
  assert.equal(empty.ok, false);
  assert.ok(empty.errors[0].includes("glb"));
  const big = validateSelection([{ name: "m.glb", size: (MAX_FILE_MB + 1) * 1e6 }]);
  assert.equal(big.ok, false);
  assert.ok(big.errors.join().includes("limite"));
  const gltfOnly = validateSelection([{ name: "plane.gltf", size: 4000 }]);
  assert.equal(gltfOnly.ok, true);
  assert.ok(gltfOnly.warnings.some((w) => w.includes(".bin")));
});

test("matchCompanion resolve pelo basename case-insensitive", () => {
  const set = new Set(["tail blue.png", "cube.bin"]);
  assert.equal(matchCompanion("textures/Tail Blue.PNG", set), "tail blue.png");
  assert.equal(matchCompanion("cube.bin", set), "cube.bin");
  assert.equal(matchCompanion("falta.bin", set), null);
  assert.equal(matchCompanion("data:application/octet-stream;base64,AA", set), null);
});

test("collectExternalUris ignora data URIs", () => {
  const { buffers, images } = collectExternalUris({
    buffers: [{ uri: "data:x" }, { uri: "cube.bin" }],
    images: [{ uri: "a.png" }, { uri: "data:image/png;base64,x" }, {}],
  });
  assert.deepEqual(buffers, ["cube.bin"]);
  assert.deepEqual(images, ["a.png"]);
});

test("computeStats: contagens, bbox e unidade auto (cm→m)", () => {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial({ name: "m1" }));
  const mesh2 = new THREE.Mesh(new THREE.ConeGeometry(1, 5, 8), mesh.material);
  mesh2.position.set(2000, 0, 0);
  g.add(mesh, mesh2);
  const st = computeStats(g);
  assert.equal(st.meshes, 2);
  assert.equal(st.materials, 1);
  assert.equal(st.vertices, mesh.geometry.getAttribute("position").count + mesh2.geometry.getAttribute("position").count);
  assert.ok(st.size[0] > 2000);
  const au = autoUnitFactor(st);
  assert.equal(au.factor, 0.01, "dimensão máxima > 300 ⇒ centímetros");
});

test("autoUnitFactor assume metros para escalas plausíveis", () => {
  const small = computeStats(new THREE.Mesh(new THREE.BoxGeometry(12, 3, 4), new THREE.MeshBasicMaterial()));
  assert.equal(autoUnitFactor(small).factor, 1);
});

test("disposeImported libera geometria/material/textura e remove da cena", () => {
  let disposed = { geo: 0, mat: 0, tex: 0 };
  const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  tex.userData.shared = false;
  const mat = new THREE.MeshStandardMaterial({ map: tex });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo, mat));
  const scene = new THREE.Scene();
  scene.add(root);
  const og = geo.dispose.bind(geo);
  const om = mat.dispose.bind(mat);
  const ot = tex.dispose.bind(tex);
  geo.dispose = () => {
    disposed.geo++;
    og();
  };
  mat.dispose = () => {
    disposed.mat++;
    om();
  };
  tex.dispose = () => {
    disposed.tex++;
    ot();
  };
  disposeImported(root);
  assert.deepEqual(disposed, { geo: 1, mat: 1, tex: 1 });
  assert.equal(scene.children.length, 0);
});

test("materiais marcados como compartilhados NÃO são descartados", () => {
  const tex = new THREE.DataTexture(new Uint8Array([1]), 1, 1);
  tex.userData.shared = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex });
  mat.userData.shared = true;
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
  let texDisposed = 0;
  const orig = tex.dispose.bind(tex);
  tex.dispose = () => {
    texDisposed++;
    orig();
  };
  disposeImported(root);
  assert.equal(texDisposed, 0);
});

test("materialTextureSlots lista canais PBR presentes", () => {
  const m = new THREE.MeshPhysicalMaterial({});
  const t = new THREE.DataTexture(new Uint8Array([1]), 1, 1);
  m.normalMap = t;
  m.emissiveMap = t;
  const slots = materialTextureSlots(m).map((x) => x.slot);
  assert.deepEqual(slots, ["Normal", "Emissive"]);
});
