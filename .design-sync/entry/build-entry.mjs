// Build the design-export entry: compile the repo's hono/jsx kit (untouched)
// into a React-renderable ESM module the design-sync converter bundles as
// --entry. react/react-dom stay external so the converter's reactShim wires
// them to window.React. Run: node .design-sync/entry/build-entry.mjs
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const KIT = path.join(REPO, "src", "admin", "ui", "kit.tsx"); // never edited
const SHIM = path.join(here, "ds-jsx-runtime.js");
const OUT = path.join(REPO, ".design-sync", ".cache", "entry", "index.mjs");

mkdirSync(path.dirname(OUT), { recursive: true });

await esbuild.build({
  entryPoints: [KIT],
  outfile: OUT,
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  jsxDev: false,
  jsxImportSource: "ds-shim",
  alias: { "ds-shim/jsx-runtime": SHIM },
  external: ["react", "react-dom", "react/jsx-runtime"],
  // Don't inherit the repo tsconfig's jsxImportSource: "hono/jsx".
  tsconfig: path.join(here, "tsconfig.empty.json"),
});

console.log("built design-export entry ->", path.relative(REPO, OUT));
