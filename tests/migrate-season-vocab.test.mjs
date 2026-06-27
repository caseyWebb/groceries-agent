// Tests for scripts/migrate-season-vocab.mjs — canonicalizing legacy `season` data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canonicalizeSeason,
  replaceSeasonInFrontmatter,
  migrateRecipeText,
  run,
} from '../scripts/migrate-season-vocab.mjs';

const recipe = (frontmatter) =>
  `---\n${frontmatter}\n---\n\n## Ingredients\n- a\n\n## Instructions\n1. b\n`;

test('canonicalizeSeason folds case + autumn, de-dupes, and flags off-vocab', () => {
  assert.deepEqual(canonicalizeSeason(['Summer', 'spring']), { canonical: ['summer', 'spring'], unmappable: [] });
  assert.deepEqual(canonicalizeSeason(['Autumn']), { canonical: ['fall'], unmappable: [] });
  assert.deepEqual(canonicalizeSeason(['spring', 'Spring']), { canonical: ['spring'], unmappable: [] });
  assert.deepEqual(canonicalizeSeason(['monsoon']), { canonical: ['monsoon'], unmappable: ['monsoon'] });
});

test('replaceSeasonInFrontmatter handles inline and block forms', () => {
  assert.equal(
    replaceSeasonInFrontmatter('title: T\nseason: [Spring, Autumn]\ntags: [x]', ['spring', 'fall']),
    'title: T\nseason: [spring, fall]\ntags: [x]',
  );
  assert.equal(
    replaceSeasonInFrontmatter('title: T\nseason:\n  - Spring\n  - summer\ntags: [x]', ['spring', 'summer']),
    'title: T\nseason: [spring, summer]\ntags: [x]',
  );
  assert.equal(replaceSeasonInFrontmatter('title: T\nno season here', ['spring']), null);
});

test('migrateRecipeText rewrites an inline season, preserving other lines', () => {
  const r = migrateRecipeText(recipe('title: Test\nseason: [Spring, Autumn]\ntags: [x]'));
  assert.equal(r.status, 'changed');
  assert.match(r.text, /season: \[spring, fall\]/);
  assert.match(r.text, /title: Test/);
  assert.match(r.text, /tags: \[x\]/);
});

test('migrateRecipeText leaves already-canonical and empty season untouched', () => {
  assert.equal(migrateRecipeText(recipe('title: T\nseason: [summer]')).status, 'unchanged');
  assert.equal(migrateRecipeText(recipe('title: T\nseason: []')).status, 'unchanged');
});

test('migrateRecipeText skips a recipe with no season array', () => {
  assert.equal(migrateRecipeText(recipe('title: T\ntags: [x]')).status, 'skipped');
});

test('migrateRecipeText canonicalizes a block-form season', () => {
  const r = migrateRecipeText(recipe('title: T\nseason:\n  - Spring\n  - summer\ntags: [x]'));
  assert.equal(r.status, 'changed');
  assert.match(r.text, /season: \[spring, summer\]/);
  assert.doesNotMatch(r.text, /- Spring/);
});

test('migrateRecipeText flags off-vocab tokens while canonicalizing the rest', () => {
  const r = migrateRecipeText(recipe('title: T\nseason: [Summer, Monsoon]\ntags: [x]'));
  assert.equal(r.status, 'changed');
  assert.match(r.text, /season: \[summer, Monsoon\]/); // mappable fixed, unknown preserved
  assert.deepEqual(r.unmappable, ['Monsoon']);
});

test('run rewrites files on disk and is idempotent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'season-mig-'));
  try {
    const recipesDir = path.join(root, 'recipes');
    await mkdir(recipesDir, { recursive: true });
    const file = path.join(recipesDir, 'stew.md');
    await writeFile(file, recipe('title: Stew\nseason: [Fall, autumn]\ntags: [x]'));

    const first = await run({ recipesDir, write: true });
    assert.equal(first.changed.length, 1);
    assert.match(await readFile(file, 'utf8'), /season: \[fall\]/); // Fall + autumn de-duped to fall

    const second = await run({ recipesDir, write: true });
    assert.equal(second.changed.length, 0); // idempotent
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
