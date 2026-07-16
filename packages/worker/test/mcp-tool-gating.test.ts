// Registration-time tool gating (mcp-tool-gating): the per-request RegistrationContext
// decides, per plane, which tools register at all — a gated tool appears in NO tools/list
// response and a call to it is the generic unknown-tool rejection, indistinguishable from a
// tool that never existed. Covers the registration matrix (member vs operator × Kroger on/off
// × Instacart on/off), the app-plane visibility metadata (commit_shop and its siblings never
// model-advertised), and `resolveRegistrationContext`'s own env/D1 detection.

import { describe, it, expect } from "vitest";
import {
  buildServer,
  resolveRegistrationContext,
  type RegistrationContext,
} from "../src/tools.js";
import { listRegisteredTools, withServer, invokeTool } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";

const CALLER: Tenant = { id: "casey", member: "casey" };

const KROGER_TOOLS = [
  "kroger_login_url",
  "kroger_prices",
  "kroger_flyer",
  "ready_to_eat_available",
  "compare_unit_price",
  "match_ingredient_to_kroger_sku",
  "place_order",
  "display_order_review",
  "read_order_review",
  "search_order_broader",
  "search_order_catalog",
  "save_order_brand_preference",
];
const INSTACART_TOOLS = ["create_instacart_handoff"];
const OPERATOR_TOOLS = ["list_proposals", "confirm_proposal", "reconcile_read_signals", "reconcile_enqueue_proposal"];
// Always-registered tools spanning several groups (reads, ungated Kroger-adjacent reads,
// writes, app-plane): present in every cell of the matrix regardless of gating.
const ALWAYS_PRESENT = ["read_user_profile", "search_recipes", "read_pantry", "store_flyer", "update_recipe", "commit_shop"];

function ctxOf(operator: boolean, kroger: boolean, instacart: boolean): RegistrationContext {
  return { profile: "self-hosted", operator, kroger, instacart };
}

async function namesFor(env: Env, ctx: RegistrationContext): Promise<Set<string>> {
  const server = buildServer(env, CALLER, "https://yamp.example.com", ctx);
  const tools = await listRegisteredTools(server);
  return new Set(tools.map((t) => t.name));
}

describe("registration matrix — member vs operator × Kroger on/off × Instacart on/off", () => {
  it("gates each plane's tool set exactly on its ctx flag, independent of the others", async () => {
    const { env } = sqliteEnv(["casey"]);
    for (const operator of [false, true]) {
      for (const kroger of [false, true]) {
        for (const instacart of [false, true]) {
          const names = await namesFor(env, ctxOf(operator, kroger, instacart));
          for (const name of ALWAYS_PRESENT) {
            expect(names.has(name), `expected always-present ${name} in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(true);
          }
          for (const name of KROGER_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(kroger);
          }
          for (const name of INSTACART_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(instacart);
          }
          for (const name of OPERATOR_TOOLS) {
            expect(names.has(name), `${name} gating mismatch in cell (operator:${operator}, kroger:${kroger}, instacart:${instacart})`).toBe(operator);
          }
        }
      }
    }
  });

  it("a member connector advertises only the member surface on a fully-configured deployment", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await namesFor(env, ctxOf(false, true, true));
    for (const name of [...KROGER_TOOLS, ...INSTACART_TOOLS]) expect(names.has(name)).toBe(true);
    for (const name of OPERATOR_TOOLS) expect(names.has(name)).toBe(false);
  });

  it("the operator session additionally carries the reconcile/proposal plane", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await namesFor(env, ctxOf(true, true, true));
    for (const name of OPERATOR_TOOLS) expect(names.has(name)).toBe(true);
  });

  it("a walk-only (no Kroger, no Instacart) deployment advertises none of those tools", async () => {
    const { env } = sqliteEnv(["casey"]);
    const names = await namesFor(env, ctxOf(false, false, false));
    for (const name of [...KROGER_TOOLS, ...INSTACART_TOOLS, ...OPERATOR_TOOLS]) {
      expect(names.has(name)).toBe(false);
    }
    // The base surface is unaffected by any gate.
    for (const name of ALWAYS_PRESENT) expect(names.has(name)).toBe(true);
  });

  it("an unregistered tool call gets the generic unknown-tool rejection, not insufficient_permission", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, false, false));
    const out = await withServer(server, (c) => invokeTool(c, "reconcile_read_signals", {}));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "not_found" });
    expect(JSON.stringify(out.result)).not.toMatch(/insufficient_permission/);
  });
});

describe("app-plane visibility — widget-callable ops never model-advertised", () => {
  const APP_ONLY_TOOLS = [
    "commit_shop",
    "read_grocery_snapshot",
    "grocery_add",
    "grocery_remove",
    "set_grocery_checked",
    "set_grocery_buy_anyway",
    "verify_grocery_pantry",
    "set_grocery_substitution",
    "relist_grocery_send_line",
    "mark_grocery_send_placed",
    "read_order_review",
    "search_order_broader",
    "search_order_catalog",
    "save_order_brand_preference",
  ];
  const MODEL_VISIBLE_WIDGETS = ["display_grocery_list", "display_order_review", "display_recipe", "display_meal_plan"];

  it("every app-plane op carries _meta.ui.visibility: [\"app\"]; commit_shop no longer leaks", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    const tools = await listRegisteredTools(server);
    const byName = new Map(tools.map((t) => [t.name, t.meta]));
    for (const name of APP_ONLY_TOOLS) {
      const meta = byName.get(name);
      expect(meta, `${name} should be registered`).toBeDefined();
      expect((meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility, `${name} should be app-only`).toEqual(["app"]);
    }
  });

  it("the display_* widget tools stay model-visible (no restrictive visibility)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const server = buildServer(env, CALLER, "https://yamp.example.com", ctxOf(false, true, true));
    const tools = await listRegisteredTools(server);
    const byName = new Map(tools.map((t) => [t.name, t.meta]));
    for (const name of MODEL_VISIBLE_WIDGETS) {
      const meta = byName.get(name) as { ui?: { visibility?: string[] } } | undefined;
      expect(meta?.ui?.visibility, `${name} should not be visibility-restricted`).toBeUndefined();
    }
  });

  it("commit_shop is registered (widget-callable) even when its plane's own gates are off", async () => {
    // commit_shop rides no ctx gate at all (it is a grocery-widget op, not Kroger/Instacart/
    // operator-scoped) — it is always registered, just never model-visible.
    const { env } = sqliteEnv(["casey"]);
    const names = await namesFor(env, ctxOf(false, false, false));
    expect(names.has("commit_shop")).toBe(true);
  });
});

describe("resolveRegistrationContext — the env/D1 detection the gates key on", () => {
  function envWithKroger(id?: string, secret?: string): Env {
    const { env } = sqliteEnv(["casey"]);
    return { ...env, KROGER_CLIENT_ID: id, KROGER_CLIENT_SECRET: secret } as unknown as Env;
  }

  it("kroger is true only when BOTH client id and secret are non-empty", async () => {
    expect((await resolveRegistrationContext(envWithKroger(undefined, undefined), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", undefined), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", ""), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("  ", "secret"), CALLER)).kroger).toBe(false);
    expect((await resolveRegistrationContext(envWithKroger("id", "secret"), CALLER)).kroger).toBe(true);
  });

  it("instacart is true only when getInstacartConfig resolves (key + a known environment)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const none = { ...env } as unknown as Env;
    const badEnv = { ...env, INSTACART_API_KEY: "k", INSTACART_API_ENV: "staging" } as unknown as Env;
    const ok = { ...env, INSTACART_API_KEY: "k", INSTACART_API_ENV: "development" } as unknown as Env;
    expect((await resolveRegistrationContext(none, CALLER)).instacart).toBe(false);
    expect((await resolveRegistrationContext(badEnv, CALLER)).instacart).toBe(false);
    expect((await resolveRegistrationContext(ok, CALLER)).instacart).toBe(true);
  });

  it("operator is true only for the tenant matching OWNER_TENANT_ID (case-insensitive)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const noOwner = { ...env } as unknown as Env;
    const otherOwner = { ...env, OWNER_TENANT_ID: "pat" } as unknown as Env;
    const sameOwner = { ...env, OWNER_TENANT_ID: "Casey" } as unknown as Env;
    expect((await resolveRegistrationContext(noOwner, CALLER)).operator).toBe(false);
    expect((await resolveRegistrationContext(otherOwner, CALLER)).operator).toBe(false);
    expect((await resolveRegistrationContext(sameOwner, CALLER)).operator).toBe(true);
  });

  it("profile defaults to self-hosted with no operator_config row and follows the D1 singleton", async () => {
    const h = sqliteEnv(["casey"]);
    expect((await resolveRegistrationContext(h.env, CALLER)).profile).toBe("self-hosted");
    h.raw.exec("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')");
    expect((await resolveRegistrationContext(h.env, CALLER)).profile).toBe("saas");
  });
});
