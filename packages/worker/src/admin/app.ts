// The operator admin app on Hono (operator-admin): the Access gate, the typed
// `/admin/api/*` surface (./api.ts — mutations, previews, and the SPA's per-screen
// aggregate reads), and the SPA serving dispatch. `/admin*` is routed worker-first
// (wrangler.jsonc `run_worker_first`), so this app answers EVERY /admin request itself
// (admin-spa D2), in order:
//
//   1. accessGate on * (404 unconfigured · 403 denied · loopback dev bypass — unchanged)
//   2. the typed /admin/api/* routes (registerApiRoutes)
//   3. the kept legacy 302 redirects (bookmarks survive with no JS and no SPA code)
//   4. GET /admin/assets/* (+ /admin/favicon.svg): the hashed bundle via ASSETS.fetch,
//      with the HTML→404 guard (the merged root's single-page-application fallback answers
//      a genuine miss with the MEMBER shell's HTML at 200 — admin assets are only ever
//      js/css/images/maps, so HTML means a real miss and must 404)
//   5. catch-all GET/HEAD: serve the admin shell (assets/admin/index.html) — deep links,
//      refreshes, and client-route URLs all land here — EXCEPT an /admin/api/* path that
//      matched no registered route, which returns a plain 404 (never the shell's HTML, so
//      the client fetch layer's HTML-means-access-expired classification stays sound).
//      Anything else (a non-GET non-API request) is a plain 404.
//
// The member SPA is untouched: its asset-fallback serving never applies under /admin.

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import { ToolError } from "../errors.js";
import { requireAccess } from "../admin.js";
import { registerApiRoutes } from "./api.js";

/** The Cloudflare Access gate as middleware — `requireAccess` reused verbatim (the opt-in /
 *  dev-bypass / email-allowlist posture is the function's, unchanged). */
const accessGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const access = await requireAccess(c.req.raw, c.env);
  if (access.status === "disabled") return c.text("Not found", 404);
  if (access.status === "denied") return c.text("Forbidden", 403);
  await next();
};

/** Map a structured `ToolError`'s code to an HTTP status (mirrors `src/admin.ts` statusFor). */
function statusForToolError(code: string): 400 | 404 | 405 | 500 {
  if (code === "not_found") return 404;
  if (code === "validation_failed") return 400;
  if (code === "unsupported") return 405;
  return 500;
}

const app = new Hono<{ Bindings: Env }>().basePath("/admin");

app.use("*", accessGate);

// Tools/operations throw structured `ToolError`s; surface them as their structured shape +
// status (a structured error is data, never an unhandled 500).
app.onError((err, c) => {
  if (err instanceof ToolError) return c.json(err.toShape(), statusForToolError(err.code));
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "upstream_unavailable", message }, 500);
});

// (2) The typed `/admin/api/*` surface: every mutation/preview route plus the SPA's
// per-screen aggregate reads — chained in ./api.ts so their request/response types
// accumulate into `AdminApp` for the `hc` client (zero codegen).
registerApiRoutes(app);

// (3) The kept legacy redirects, Worker-side so bookmarks resolve without the app.
app.get("/logs/discovery", (c) => c.redirect("/admin/discovery", 302));
app.get("/config/aliases", (c) => c.redirect("/admin/normalize?tab=aliases", 302));

// (4) The admin bundle's static namespace. `ASSETS.fetch` bypasses run_worker_first, so
// this never re-enters and loops; the content-type guard turns the merged root's
// member-shell fallback (an HTML 200 for a genuine miss) into a real 404.
async function serveAdminAsset(c: { env: Env; req: { raw: Request } }): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.headers.get("content-type")?.startsWith("text/html")) return new Response("Not found", { status: 404 });
  return res;
}
app.get("/assets/*", (c) => serveAdminAsset(c));
app.get("/favicon.svg", (c) => serveAdminAsset(c));

// (5) The catch-all: serve the SPA shell for any other GET/HEAD — the panel home ("/admin"
// itself, outside the basePath'd "*" pattern) and every deep-link/client-route URL — except
// an API-shaped path (a typo, or a client newer than the Worker), which stays a plain 404 so
// every /admin/api/* response is JSON-or-404 and HTML on that surface remains an unambiguous
// Access signal (D7).
function serveShell(c: { env: Env; req: { url: string } }): Promise<Response> {
  return c.env.ASSETS.fetch(new Request(new URL("/admin/index.html", c.req.url)));
}
app.get("/", (c) => serveShell(c));
app.get("*", async (c) => {
  if (new URL(c.req.url).pathname.startsWith("/admin/api/")) return c.text("Not found", 404);
  return serveShell(c);
});

// A non-GET non-API request matches nothing above → a plain 404 (never the shell).
app.notFound((c) => c.text("Not found", 404));

/** The app type the client (`hc<AdminApp>()`) infers request/response types from. */
export type { AdminApp } from "./api.js";
export default app;
