// Cloudflare Access JWT verification (mcp-server capability — defense-in-depth).
// Access already gates the Worker at the edge via Managed OAuth; this revalidates
// the injected `Cf-Access-Jwt-Assertion` header in-Worker so a request that
// somehow reaches the Worker WITHOUT passing Access (e.g. the un-gated
// workers.dev URL) is still rejected. Verification uses `jose` against the team's
// public keys — the canonical approach for Access JWTs.
//
// Enforcement is config-gated: only active when both ACCESS_TEAM_DOMAIN and
// ACCESS_AUD are set, so local dev (`wrangler dev` / MCP Inspector, no header)
// is unaffected.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessVerifier {
  /** True iff `token` is a valid Access JWT for this team + audience. Never throws. */
  verify(token: string): Promise<boolean>;
}

/**
 * Build a verifier for a team domain (e.g. "casey.cloudflareaccess.com") and the
 * application's AUD tag. `jwks` is injectable for tests; in production it fetches
 * and caches the team's signing keys from the Access certs endpoint.
 */
export function createAccessVerifier(
  teamDomain: string,
  aud: string,
  jwks: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  ),
): AccessVerifier {
  const issuer = `https://${teamDomain}`;
  return {
    async verify(token: string): Promise<boolean> {
      try {
        await jwtVerify(token, jwks, { issuer, audience: aud });
        return true;
      } catch {
        return false;
      }
    },
  };
}
