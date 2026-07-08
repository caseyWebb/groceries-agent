import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import { redeemAuthNonce } from "../src/oauth.js";
import type { KvStore } from "../src/kroger-user.js";
import { fakeD1 } from "./fake-d1.js";
import { fakeR2 } from "./fake-r2.js";

/** In-memory KV (single-page list) — satisfies the bindings the member ops touch. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** The SHELL html the fake assets binding serves for /admin/index.html, and the member
 *  shell it serves for any other path (mirroring the merged root's single-page-application
 *  fallback answering a miss with the MEMBER shell at 200) — so the dispatch tests can tell
 *  exactly which document (if any) a route was answered with. */
const ADMIN_SHELL = "<!doctype html><html><head><title>grocery-agent admin</title></head><body>admin shell</body></html>";
const MEMBER_SHELL = "<!doctype html><html><body>member shell</body></html>";

function fakeAssets(asked: string[] = []): Env["ASSETS"] {
  return {
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname;
      asked.push(path);
      if (path === "/admin/index.html") return new Response(ADMIN_SHELL, { headers: { "content-type": "text/html" } });
      if (path.endsWith(".js")) return new Response("not found", { status: 404 });
      // The merged root's SPA fallback: any other miss gets the MEMBER shell at 200.
      return new Response(MEMBER_SHELL, { status: 200, headers: { "content-type": "text/html" } });
    },
  } as unknown as Env["ASSETS"];
}

/** A minimal Env for the Hono app. `ADMIN_DEV_BYPASS=1` admits on a loopback request host
 *  (a bare `app.request("/admin/...")` is `http://localhost`), exercising the panel offline. */
function makeEnv(over: Partial<Env> = {}, members: string[] = []): Env {
  const kvInit: Record<string, string> = {};
  for (const id of members) kvInit[`tenant:${id}`] = JSON.stringify({ id });
  return {
    ADMIN_DEV_BYPASS: "1",
    TENANT_KV: memKv(kvInit),
    KROGER_KV: memKv(),
    OAUTH_KV: memKv(),
    DB: fakeD1().env.DB,
    CORPUS: fakeR2().bucket,
    ASSETS: fakeAssets(),
    ...over,
  } as unknown as Env;
}

describe("admin Hono app — the Access gate (posture unchanged through the new dispatch)", () => {
  it("404s when Access is unconfigured and the host is not loopback", async () => {
    const res = await app.request("https://example.com/admin/members", {}, makeEnv({ ADMIN_DEV_BYPASS: undefined }));
    expect(res.status).toBe(404);
  });

  it("404s the API surface the same way (the gate runs before every route)", async () => {
    const res = await app.request("https://example.com/admin/api/status", {}, makeEnv({ ADMIN_DEV_BYPASS: undefined }));
    expect(res.status).toBe(404);
  });

  it("admits on a loopback host under the dev bypass", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv());
    expect(res.status).toBe(200);
  });
});

describe("admin Hono app — SPA serving dispatch (admin-spa D2)", () => {
  it("serves the admin shell for the panel home", async () => {
    const res = await app.request("/admin", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ADMIN_SHELL);
  });

  it("serves the admin shell for a deep-link GET (client-route URL, query included)", async () => {
    const asked: string[] = [];
    const res = await app.request("/admin/normalize?tab=audits", {}, makeEnv({ ASSETS: fakeAssets(asked) }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ADMIN_SHELL);
    // The Worker asked the binding for the ADMIN shell explicitly — never a fallback path.
    expect(asked).toEqual(["/admin/index.html"]);
  });

  it("an /admin/api route matches BEFORE the catch-all (JSON, never the shell)", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()) as { tenants: unknown[] }).toHaveProperty("tenants");
  });

  it("an UNKNOWN /admin/api path is a plain 404 — never the shell's HTML", async () => {
    const res = await app.request("/admin/api/does-not-exist", {}, makeEnv());
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("a GET on a POST-only API path is likewise a plain 404, not the shell", async () => {
    const res = await app.request("/admin/api/discovery/analyze", {}, makeEnv());
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("keeps the two legacy redirects Worker-side", async () => {
    const env = makeEnv();
    const logs = await app.request("/admin/logs/discovery", {}, env);
    expect(logs.status).toBe(302);
    expect(logs.headers.get("location")).toBe("/admin/discovery");
    const aliases = await app.request("/admin/config/aliases", {}, env);
    expect(aliases.status).toBe(302);
    expect(aliases.headers.get("location")).toBe("/admin/normalize?tab=aliases");
  });

  it("a missing admin static asset 404s — the member-shell fallback never passes through", async () => {
    const res = await app.request("/admin/assets/renamed-chunk.js", {}, makeEnv());
    expect(res.status).toBe(404);
  });

  it("an asset-namespace miss that falls back to HTML is turned into a real 404", async () => {
    // fakeAssets serves the MEMBER shell (text/html, 200) for a non-.js miss — the guard
    // must convert that into a 404 rather than serving any shell as an "asset".
    const res = await app.request("/admin/assets/gone.css", {}, makeEnv());
    expect(res.status).toBe(404);
  });

  it("a non-GET, non-API request is a plain 404 (never the shell)", async () => {
    const res = await app.request("/admin/normalize", { method: "POST" }, makeEnv());
    expect(res.status).toBe(404);
  });
});

describe("admin Hono app — the typed member-lifecycle routes (unchanged)", () => {
  it("lists tenants via the typed GET route, as structured roster rows", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: { id: string }[] };
    expect(body.tenants.map((t) => t.id)).toEqual(["casey"]);
    expect(body.tenants[0]).toMatchObject({ owner: false, status: "pending", kroger: "unlinked", cooked: 0, favorites: 0 });
  });

  it("onboards a member, returning the once-shown invite + connector url", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Casey" }) },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; invite_code: string; connector_url: string };
    expect(body.username).toBe("casey"); // canonicalized lowercase
    expect(body.invite_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.connector_url).toBe("http://localhost/mcp");
  });

  it("surfaces a structured validation error as 400 (data, not a 500)", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
  });

  it("revokes a member via the typed DELETE route", async () => {
    const res = await app.request("/admin/api/tenants/casey", { method: "DELETE" }, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "casey", revoked: true });
  });

  it("mints a redeemable Kroger consent link for an allowlisted member", async () => {
    const env = makeEnv({}, ["casey"]);
    const res = await app.request("/admin/api/tenants/casey/kroger-login", { method: "POST" }, env);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(env.KROGER_KV as unknown as KvStore, nonce)).toBe("casey");
  });

  it("404s a Kroger consent link for a non-allowlisted member", async () => {
    const res = await app.request("/admin/api/tenants/ghost/kroger-login", { method: "POST" }, makeEnv());
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });
});
