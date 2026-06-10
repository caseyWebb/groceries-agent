// Stage the single private data repo from today's repo (multi-tenant-friend-group
// §5.1–§5.3). NON-DESTRUCTIVE: reads the live root, writes a staging tree under
// `.migration/` (gitignored). It never mutates root files and never touches GitHub —
// the operator reviews the output, then creates the repo and pushes per
// docs/MIGRATION.md.
//
//   node scripts/migrate/build-data-repos.mjs [--tenant <username>]
//
// Output: .migration/data/  → the one data repo
//   recipes/ + aliases/ingredients/substitutions/skus/ready_to_eat/_indexes  (shared, at root)
//   users/<username>/        (this member's personal state + overlay + notes)
//
// The recipe split is the heart of it: each recipe's frontmatter is partitioned into
// objective content (→ recipes/) and the subjective overlay rating/status (→ the
// member's users/<username>/overlay.toml). last_cooked is dropped from content — it
// is derived from that member's cooking_log.toml, which is copied across intact.

import { readFile, readdir, writeFile, mkdir, rm, stat, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { SHARED, TENANT, splitRecipeFrontmatter } from "./manifest.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_ROOT = path.join(REPO_ROOT, ".migration");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy a top-level file or directory from root into a staging dir, if present. */
async function copyInto(name, destDir, warnings) {
  const src = path.join(REPO_ROOT, name);
  if (!(await exists(src))) {
    warnings.push(`skipped (absent): ${name}`);
    return;
  }
  const dest = path.join(destDir, name);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

/**
 * Transform recipes/: write objective-only content to the corpus, accumulate the
 * subjective overlay (rating/status) into `overlayBySlug`. Returns counts + the
 * set of slugs whose last_cooked was non-null (a data-integrity heads-up).
 */
async function splitRecipes(corpusDir, overlayBySlug, warnings) {
  const srcDir = path.join(REPO_ROOT, SHARED.recipesDir);
  const destDir = path.join(corpusDir, SHARED.recipesDir);
  await mkdir(destDir, { recursive: true });

  const entries = await readdir(srcDir, { withFileTypes: true });
  let recipeCount = 0;
  let overlayCount = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const slug = entry.name.replace(/\.md$/, "");
    const raw = await readFile(path.join(srcDir, entry.name), "utf8");
    const parsed = matter(raw);
    const { objective, overlayRow, lastCooked } = splitRecipeFrontmatter(parsed.data);

    if (Object.keys(overlayRow).length > 0) {
      overlayBySlug[slug] = overlayRow;
      overlayCount++;
    }

    if (lastCooked != null) {
      warnings.push(
        `recipe "${slug}" had last_cooked=${JSON.stringify(lastCooked)}; ` +
          `dropped from content (it is derived from cooking_log.toml — verify the log carries it)`,
      );
    }

    const cleaned = matter.stringify(parsed.content, objective);
    await writeFile(path.join(destDir, entry.name), cleaned);
    recipeCount++;
  }

  return { recipeCount, overlayCount };
}

/** Serialize the per-tenant overlay as `[overlay."<slug>"]` tables. */
function serializeOverlay(overlayBySlug) {
  const header =
    "# Per-tenant subjective overlay (multi-tenant-friend-group §6). Keyed by recipe\n" +
    "# slug; merged onto shared recipe content at read time. Holds ONLY rating + status\n" +
    "# (the genuinely-subjective single-values). An absent slug means effective\n" +
    "# status = draft. last_cooked is NOT here — it is derived from cooking_log.toml.\n\n";
  const body = stringifyToml({ overlay: overlayBySlug });
  return header + body + "\n";
}

async function main() {
  const tenantId = arg("tenant", "operator");
  const dataDir = path.join(OUT_ROOT, "data");
  const userDir = path.join(dataDir, "users", tenantId);
  const warnings = [];

  // Fresh staging each run.
  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(userDir, { recursive: true });

  // --- Shared content + reference data (data repo root) ---
  for (const f of SHARED.files) await copyInto(f, dataDir, warnings);
  for (const d of SHARED.dirs) await copyInto(d, dataDir, warnings);
  const overlayBySlug = {};
  const { recipeCount, overlayCount } = await splitRecipes(dataDir, overlayBySlug, warnings);

  // --- This member's personal subtree: users/<username>/ ---
  for (const f of TENANT.files) await copyInto(f, userDir, warnings);
  await writeFile(path.join(userDir, "overlay.toml"), serializeOverlay(overlayBySlug));
  await mkdir(path.join(userDir, "notes"), { recursive: true });
  await writeFile(
    path.join(userDir, "notes", ".gitkeep"),
    "# Recipe notes live here (notes/<slug>.md), authored by this member.\n",
  );

  // Validate the overlay we wrote parses back.
  parseToml(await readFile(path.join(userDir, "overlay.toml"), "utf8"));

  console.log(`\nStaged the single data repo under ${path.relative(REPO_ROOT, OUT_ROOT)}/data/\n`);
  console.log(`  recipes/            ${recipeCount} recipes (subjective fields stripped)`);
  console.log(`  users/${tenantId}/  overlay.toml with ${overlayCount} disposition row(s) + personal state`);
  if (warnings.length) {
    console.log(`\n${warnings.length} note(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(`\nReview the staged tree, then follow docs/MIGRATION.md to create + push the private data repo.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
