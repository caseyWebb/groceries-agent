// The typed API client (member-api): `hc` over the Worker's composed app type. The
// import is TYPE-ONLY (erased from the bundle — no workerd code can reach the browser);
// the runtime is just hono/client. Same-origin by construction: the base is "/", and
// under `aubr dev:app` the Vite proxy carries /api to the local Worker.
import { hc } from "hono/client";
import type { MemberApi } from "@grocery-agent/worker/api";

/** The SPA's embedded build id — compared against the `X-App-Build` response header
 *  (the version-skew contract). `"dev"` when unstamped (local dev; the harness). */
export const APP_BUILD: string = import.meta.env.VITE_APP_BUILD ?? "dev";

/**
 * Every state-changing request carries `X-App-Csrf` (the Worker's CSRF guard rejects
 * it otherwise) — set here once, in the shared fetch wrapper, never per call site.
 */
const csrfFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("X-App-Csrf", "1");
  return fetch(input, { ...init, headers });
};

export const api = hc<MemberApi>("/", { fetch: csrfFetch });

/** The structured error body every `/api` failure carries (the SPA branches on `error`). */
export interface ApiError {
  error: string;
  message: string;
}

/** Parse a failed response's structured error, degrading to a generic shape. (Structural
 *  param: hc's ClientResponse and the global Response both satisfy it.) */
export async function apiError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (typeof body?.error === "string") return { error: body.error, message: body.message ?? "" };
  } catch {
    // fall through
  }
  return { error: "internal", message: `Request failed (${res.status})` };
}
