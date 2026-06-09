// Worker entry. Serves the MCP server over Streamable HTTP via createMcpHandler
// (stateless — no Durable Objects). A fresh server is built per request, closing
// over env so tool handlers can reach the GitHub token and repo coordinates.
// A plain GET / returns a health line; everything else goes to the MCP handler
// (default route /mcp), behind in-Worker Cloudflare Access JWT validation when
// configured (defense-in-depth — Access also gates at the edge).

import { createMcpHandler } from "agents/mcp";
import type { Env } from "./env.js";
import { buildServer } from "./tools.js";
import { createAccessVerifier, type AccessVerifier } from "./access.js";
import { handleOAuth } from "./oauth.js";

// Module-level singleton so the JWKS fetched by the verifier is cached across
// requests served by the same isolate. Rebuilt only if the config changes.
let verifier: AccessVerifier | null = null;
let verifierKey = "";

function getVerifier(env: Env): AccessVerifier | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const key = `${env.ACCESS_TEAM_DOMAIN}|${env.ACCESS_AUD}`;
  if (!verifier || verifierKey !== key) {
    verifier = createAccessVerifier(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    verifierKey = key;
  }
  return verifier;
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", message }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("grocery-mcp ok — MCP endpoint at POST /mcp\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    // The Kroger OAuth callback carries no Access JWT, so /oauth/* is handled
    // BEFORE the in-Worker gate (and bypassed at the edge by an Access policy).
    // It is secured by OAuth state + PKCE instead. Everything else stays gated.
    if (url.pathname.startsWith("/oauth/")) {
      return handleOAuth(env, url);
    }

    const v = getVerifier(env);
    if (v) {
      const token = request.headers.get("Cf-Access-Jwt-Assertion");
      if (!token) return unauthorized("Missing Cloudflare Access JWT");
      if (!(await v.verify(token))) return unauthorized("Invalid Cloudflare Access JWT");
    }

    const server = buildServer(env);
    return createMcpHandler(server)(request, env, ctx);
  },
};
