// Structural pre-commit validation (data-write-tools capability). Runs on
// workerd — the Node index-build validator (scripts/build-indexes.mjs) can't run
// in the Worker, so this reimplements only the STRUCTURAL subset: every staged
// file parses, and enumerated fields hold legal values. Cross-reference / index
// validation stays the post-push build Action's job. Any problem throws
// ToolError("validation_failed") so the commit engine makes no commit.

import { load as loadYaml } from "js-yaml";
import { parse as parseTomlRaw } from "smol-toml";
import { ToolError } from "./errors.js";

const RECIPE_STATUSES = ["active", "draft", "rejected", "archived"];
const PANTRY_CATEGORIES = ["pantry", "fridge", "freezer", "spices"];
const READY_TO_EAT_STATUSES = ["active", "draft", "rejected"];
const GROCERY_STATUSES = ["active", "in_cart", "ordered"];
const GROCERY_KINDS = ["grocery", "household", "other"];

function fail(path: string, message: string): never {
  throw new ToolError("validation_failed", `${path}: ${message}`, { path });
}

function parseTomlOrFail(path: string, content: string): Record<string, unknown> {
  try {
    return parseTomlRaw(content) as Record<string, unknown>;
  } catch (e) {
    fail(path, `does not parse as TOML — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseFrontmatterOrFail(path: string, content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) fail(path, "missing leading --- frontmatter fence");
  try {
    const parsed = loadYaml(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    fail(path, `frontmatter is not valid YAML — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function items(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

function checkEnum(
  path: string,
  field: string,
  value: unknown,
  legal: string[],
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) fail(path, `item is missing required field \`${field}\``);
    return;
  }
  if (typeof value !== "string" || !legal.includes(value)) {
    fail(path, `\`${field}\` = ${JSON.stringify(value)} is not one of ${legal.join(" | ")}`);
  }
}

/**
 * Validate one staged file's full new content by path. Throws
 * ToolError("validation_failed") on any structural problem; returns on success.
 */
export function validateFile(path: string, content: string): void {
  if (path.startsWith("recipes/") && path.endsWith(".md")) {
    const fm = parseFrontmatterOrFail(path, content);
    if ("status" in fm) checkEnum(path, "status", fm.status, RECIPE_STATUSES, false);
    return;
  }

  if (path === "pantry.toml") {
    const parsed = parseTomlOrFail(path, content);
    for (const it of items(parsed)) checkEnum(path, "category", it.category, PANTRY_CATEGORIES, false);
    return;
  }

  if (path === "grocery_list.toml") {
    const parsed = parseTomlOrFail(path, content);
    for (const it of items(parsed)) {
      if (typeof it.name !== "string" || it.name.length === 0) {
        fail(path, "item is missing required field `name`");
      }
      checkEnum(path, "status", it.status, GROCERY_STATUSES, true);
      checkEnum(path, "kind", it.kind, GROCERY_KINDS, false);
    }
    return;
  }

  if (path.startsWith("ready_to_eat/") && path.endsWith(".toml")) {
    const parsed = parseTomlOrFail(path, content);
    for (const it of items(parsed)) checkEnum(path, "status", it.status, READY_TO_EAT_STATUSES, false);
    return;
  }

  // Other TOML (preferences, substitutions, aliases, stockup, flyer_terms, …):
  // parse-only — confirm it isn't syntactic garbage before committing.
  if (path.endsWith(".toml")) {
    parseTomlOrFail(path, content);
    return;
  }

  // Freeform markdown (taste.md, diet_principles.md) and anything else: no
  // structural contract to enforce.
}
