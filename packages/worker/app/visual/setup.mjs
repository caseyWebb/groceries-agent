#!/usr/bin/env node
// webServer entrypoint for the MEMBER APP Playwright harness (app-ui-testing), the
// sibling and mirror of admin/visual/setup.mjs. Builds the admin bundle (assets/admin/)
// AND the member SPA (index.html + hashed chunks into the same merged assets/ root),
// applies the D1 migrations to the LOCAL SQLite, applies the SHARED deterministic seed
// (admin/visual/seed.mjs — one fixture set for both suites, extended with the app's
// invite mapping), then runs `wrangler dev --local` on PW_APP_PORT (default 8788, so
// the two suites can coexist). Long-running: the final `wrangler dev` is the server
// Playwright waits on. Everything is local + offline (miniflare D1/KV) — the app suite
// needs no Access bypass (nothing here touches /admin pages).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, d1Statements, kvEntries } from "../../admin/visual/seed.mjs";

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

const now = Date.now();

sh("node", ["scripts/build-admin.mjs"]);
// The SPA build (packages/app → ../app from this package's cwd). Unstamped: the harness
// runs the version-skew contract's local posture (both sides read "dev").
sh("npx", ["vite", "build"], { cwd: "../app" });
sh("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
sh("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", d1Statements(now).join(" ")]);
for (const [binding, key, value] of kvEntries()) {
  sh("npx", ["wrangler", "kv", "key", "put", key, value, "--binding", binding, "--local"]);
}
// The recipe BODY lives in the R2 corpus (readRecipeDetail reads recipes/<slug>.md) —
// put the seeded recipe's markdown into the local bucket so the detail page renders.
// App-suite-only: the admin suite keeps its empty-corpus posture (D1-only "orphaned").
const recipeMd = `---
title: ${SEED.recipe.title}
source: ${SEED.recipe.source}
protein: fish
cuisine: japanese
time_total: 35
dietary: []
requires_equipment: []
pairs_with: []
---

## Ingredients

- 4 salmon fillets
- 3 tbsp white miso
- 2 cups jasmine rice

## Instructions

1. Whisk the miso glaze.
2. Broil the salmon until lacquered.
3. Serve over rice.
`;
const tmp = mkdtempSync(join(tmpdir(), "app-seed-"));
const mdPath = join(tmp, "recipe.md");
writeFileSync(mdPath, recipeMd);
sh("npx", ["wrangler", "r2", "object", "put", `grocery-corpus/recipes/${SEED.recipe.slug}.md`, "--file", mdPath, "--local"]);

sh("npx", ["wrangler", "dev", "--local", "--port", process.env.PW_APP_PORT || "8788"]);
