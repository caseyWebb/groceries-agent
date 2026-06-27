#!/usr/bin/env node
// migrate-season-vocab.mjs — canonicalize legacy `season` frontmatter to SEASON_VOCAB.
//
// `season` became a CONTROLLED vocabulary (spring | summer | fall | winter), enforced
// strictly at write AND build time (src/recipe-contract.js). Recipes authored before
// that — with capitalized values (`Summer`), the `autumn` synonym, or duplicates —
// would now hard-fail the build. This one-time, re-runnable migration rewrites each
// recipe's `season` to the canonical lowercase tokens (folding `autumn` → `fall`,
// de-duplicating), touching ONLY the `season` line so the rest of the frontmatter is
// left byte-identical. Tokens that don't map to the vocabulary even after
// normalization (e.g. `monsoon`) are reported for manual fixing, never guessed.
//
// Runs against a DATA checkout, not this repo:
//   node scripts/migrate-season-vocab.mjs --root /path/to/data-repo          # rewrite
//   node scripts/migrate-season-vocab.mjs --root /path/to/data-repo --check  # report only

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';
import { SEASON_VOCAB, normalizeSeason } from '../src/vocab.js';

// --- pure helpers --------------------------------------------------------

/**
 * Canonicalize a season array: normalize each token (case-fold + `autumn`→`fall`),
 * keep it only if it lands in SEASON_VOCAB (else leave the ORIGINAL token and flag it),
 * then de-duplicate preserving first-seen order. Returns { canonical, unmappable }.
 */
export function canonicalizeSeason(arr) {
  const canonical = [];
  const unmappable = [];
  for (const raw of arr) {
    const norm = normalizeSeason(raw);
    const token = SEASON_VOCAB.includes(norm) ? norm : raw;
    if (!SEASON_VOCAB.includes(norm) && !unmappable.includes(raw)) unmappable.push(raw);
    if (!canonical.includes(token)) canonical.push(token);
  }
  return { canonical, unmappable };
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Surgically replace the `season:` entry inside a frontmatter block with the canonical
 * inline form, handling both flow (`season: [a, b]`) and block (`season:\n  - a`) styles.
 * Returns the new frontmatter text, or null when the entry can't be located (caller
 * reports it for manual editing rather than reformatting the whole file).
 */
export function replaceSeasonInFrontmatter(fm, tokens) {
  const rendered = `[${tokens.join(', ')}]`;
  const inline = /^([ \t]*season:[ \t]*)\[[^\]\n]*\][ \t]*$/m;
  if (inline.test(fm)) return fm.replace(inline, `$1${rendered}`);
  const block = /^([ \t]*)season:[ \t]*\r?\n(?:[ \t]+-[ \t]*.*(?:\r?\n|$))+/m;
  if (block.test(fm)) return fm.replace(block, (_m, indent) => `${indent}season: ${rendered}\n`);
  return null;
}

/**
 * Migrate one recipe file's raw text. Returns one of:
 *   { status: 'skipped' }                          — no season array to act on
 *   { status: 'unchanged', unmappable }            — already canonical
 *   { status: 'changed', text, unmappable }        — rewritten season line
 *   { status: 'manual', unmappable }               — season needs a change but couldn't
 *                                                     be located surgically (hand-edit)
 */
export function migrateRecipeText(raw) {
  let data;
  try {
    ({ data } = matter(raw));
  } catch {
    return { status: 'skipped' };
  }
  if (!Array.isArray(data.season)) return { status: 'skipped' };

  const { canonical, unmappable } = canonicalizeSeason(data.season);
  if (arraysEqual(canonical, data.season)) return { status: 'unchanged', unmappable };

  const fmMatch = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  const newFm = fmMatch && replaceSeasonInFrontmatter(fmMatch[2], canonical);
  if (!fmMatch || newFm === null) return { status: 'manual', unmappable };

  const text = raw.slice(0, fmMatch.index) + fmMatch[1] + newFm + fmMatch[3] + raw.slice(fmMatch.index + fmMatch[0].length);
  return { status: 'changed', text, unmappable };
}

async function listRecipeFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listRecipeFiles(full, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

// --- orchestration -------------------------------------------------------

export async function run({ recipesDir, write }) {
  const files = await listRecipeFiles(recipesDir);
  const changed = [];
  const manual = [];
  const unmappable = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const result = migrateRecipeText(raw);
    if (result.unmappable?.length) unmappable.push({ file, tokens: result.unmappable });
    if (result.status === 'changed') {
      changed.push(file);
      if (write) await writeFile(file, result.text);
    } else if (result.status === 'manual') {
      manual.push(file);
    }
  }
  return { scanned: files.length, changed, manual, unmappable };
}

async function main() {
  const argv = process.argv;
  const checkOnly = argv.includes('--check');
  const rootArg = argv.indexOf('--root');
  if (rootArg === -1 || !argv[rootArg + 1]) {
    console.error('usage: node scripts/migrate-season-vocab.mjs --root <data-repo> [--check]');
    process.exit(2);
  }
  const recipesDir = path.join(path.resolve(argv[rootArg + 1]), 'recipes');
  const { scanned, changed, manual, unmappable } = await run({ recipesDir, write: !checkOnly });

  const verb = checkOnly ? 'would canonicalize' : 'canonicalized';
  for (const f of changed) console.log(`${verb} season in ${path.relative(process.cwd(), f)}`);
  for (const { file, tokens } of unmappable)
    console.warn(`WARN ${path.relative(process.cwd(), file)}: season ${JSON.stringify(tokens)} not in vocabulary — fix by hand`);
  for (const f of manual)
    console.warn(`WARN ${path.relative(process.cwd(), f)}: season needs canonicalizing but isn't a recognized inline/block form — edit by hand`);

  console.log(
    `\n${scanned} recipe(s) scanned · ${changed.length} ${checkOnly ? 'to change' : 'changed'} · ${manual.length} need manual edit · ${unmappable.length} with off-vocab tokens`,
  );
  // --check is a gate: non-zero when anything still needs doing.
  if (checkOnly && (changed.length || manual.length || unmappable.length)) process.exit(1);
  if (manual.length || unmappable.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
