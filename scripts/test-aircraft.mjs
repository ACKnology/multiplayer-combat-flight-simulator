// Runner dos testes do sistema de aeronaves (GLB). Executar: node scripts/test-aircraft.mjs
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(mkdtempSync(join(tmpdir(), "aircraft-tests-")), "aircraft.test.mjs");

await build({
  entryPoints: [join(root, "src/lib/aircraft/__tests__/aircraft.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: out,
  external: ["node:test", "node:assert", "node:assert/strict"],
  alias: { "@": join(root, "src") },
  logLevel: "warning",
});

const r = spawnSync(process.execPath, ["--test", out], { stdio: "inherit" });
process.exit(r.status ?? 1);
