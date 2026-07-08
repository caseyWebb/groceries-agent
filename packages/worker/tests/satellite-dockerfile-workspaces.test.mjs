// The satellite-Dockerfile ↔ workspace drift gate: the satellite image's frozen
// `aube ci` requires EVERY workspace importer's package.json in the build context —
// `aube-lock.yaml` records all of them, and a missing manifest fails the frozen
// install (the exact break the 0.1.8 release hit when packages/app, packages/ui,
// and packages/admin-app joined the workspace). This test asserts every
// `packages/*/package.json` on disk has a matching COPY line in the satellite
// Dockerfile, so "add the workspace to the Dockerfile in the same change" is a
// gate, not a comment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/** Every workspace package directory that carries a package.json. */
function workspacePackages() {
  return readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(repoRoot, "packages", name, "package.json")));
}

test("the satellite Dockerfile COPYs every workspace package.json for the frozen install", () => {
  const dockerfile = readFileSync(join(repoRoot, "packages/satellite/Dockerfile"), "utf8");
  const packages = workspacePackages();
  assert.ok(packages.length >= 3, "expected at least the contract/satellite/worker workspaces");
  for (const name of packages) {
    const manifest = `packages/${name}/package.json`;
    assert.match(
      dockerfile,
      new RegExp(`^COPY ${manifest.replaceAll("/", "\\/")} ${manifest.replaceAll("/", "\\/")}$`, "m"),
      `packages/satellite/Dockerfile is missing "COPY ${manifest} ${manifest}" — the frozen aube ci in the image will reject the lockfile`,
    );
  }
});
