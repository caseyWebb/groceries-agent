// The /oauth/* route group (kroger-user-auth + mcp-server capabilities). Two
// routes drive the one-time Kroger consent:
//   - GET /oauth/init     → redirect to Kroger's authorize endpoint (PKCE + state)
//   - GET /oauth/callback → verify `state`, exchange the code, store the refresh token
//
// These paths MUST be reachable without a Cloudflare Access JWT (Kroger's
// redirect carries none) — index.ts routes them before the Access gate, and an
// Access *bypass* policy carves them out at the edge (infra). They are secured
// instead by OAuth `state` (CSRF) + PKCE: the per-flow verifier is held in KV
// keyed by `state` with a short TTL, so a forged/replayed callback whose state
// has no stored verifier is rejected with no token exchange.

import type { Env } from "./env.js";
import {
  createKrogerUserClient,
  type KrogerUserClient,
  type KvStore,
} from "./kroger-user.js";

const PKCE_TTL_SECONDS = 600;
const pkceKey = (state: string): string => `kroger:pkce:${state}`;

/** Base64url (no padding) of raw bytes. */
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A high-entropy PKCE code verifier (RFC 7636: 43–128 chars). */
export function generateVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A high-entropy opaque `state` value for CSRF protection. */
export function generateState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Injectable PKCE primitives so route handling is deterministic under test. */
export interface Pkce {
  generateVerifier(): string;
  generateState(): string;
  challengeFromVerifier(verifier: string): Promise<string>;
}

const defaultPkce: Pkce = { generateVerifier, generateState, challengeFromVerifier };

export interface OAuthDeps {
  kv: KvStore;
  client: KrogerUserClient;
  pkce?: Pkce;
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/**
 * Handle an `/oauth/*` request. Pure with respect to its injected deps (kv,
 * Kroger client, PKCE) so the init→callback handshake and the forged-state
 * rejection are unit-testable without network or KV bindings.
 */
export async function handleOAuthRequest(deps: OAuthDeps, url: URL): Promise<Response> {
  const pkce = deps.pkce ?? defaultPkce;
  const redirectUri = `${url.origin}/oauth/callback`;

  if (url.pathname === "/oauth/init") {
    const verifier = pkce.generateVerifier();
    const state = pkce.generateState();
    const challenge = await pkce.challengeFromVerifier(verifier);
    await deps.kv.put(pkceKey(state), verifier, { expirationTtl: PKCE_TTL_SECONDS });
    const authorizeUrl = deps.client.buildAuthorizeUrl(redirectUri, state, challenge);
    return new Response(null, { status: 302, headers: { location: authorizeUrl } });
  }

  if (url.pathname === "/oauth/callback") {
    const err = url.searchParams.get("error");
    if (err) return text(`Kroger authorization failed: ${err}`, 400);

    const state = url.searchParams.get("state");
    if (!state) return text("Missing state", 400);

    // The verifier is the proof this callback corresponds to a flow WE started.
    // No stored verifier for this state → forged/replayed/expired → reject.
    const verifier = await deps.kv.get(pkceKey(state));
    if (!verifier) return text("Invalid or expired state; restart authorization", 400);
    await deps.kv.delete(pkceKey(state));

    const code = url.searchParams.get("code");
    if (!code) return text("Missing code", 400);

    try {
      await deps.client.exchangeCode(code, verifier, redirectUri);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return text(`Token exchange failed: ${message}`, 502);
    }
    return text("Kroger authorization complete. You can close this tab.", 200);
  }

  return text("Not found", 404);
}

/** Thin wrapper: build real deps from env + the KV binding, then handle. */
export function handleOAuth(env: Env, url: URL): Promise<Response> {
  const kv = env.KROGER_KV as unknown as KvStore;
  const client = createKrogerUserClient(env, kv);
  return handleOAuthRequest({ kv, client }, url);
}
