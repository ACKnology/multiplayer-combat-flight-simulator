// Runner dos testes unitários do Live ATC sem dependências novas:
// usa o esbuild já presente no projeto para compilar os testes TS e roda com node:test.
//   node scripts/test-atc.mjs
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(mkdtempSync(join(tmpdir(), "atc-tests-")), "atc.test.mjs");

await build({
  entryPoints: [join(root, "src/lib/atc/__tests__/atc.test.ts")],
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