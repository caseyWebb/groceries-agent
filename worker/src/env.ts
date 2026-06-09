// Worker environment. GITHUB_TOKEN is a secret (wrangler secret put); the rest
// are non-secret vars from wrangler.jsonc. The repo is public, so its
// coordinates are not sensitive.

export interface Env {
  /** Fine-grained PAT scoped to the repo (contents:read+write). Secret. */
  GITHUB_TOKEN: string;
  /** Repo owner, e.g. "caseyWebb". */
  GITHUB_OWNER: string;
  /** Repo name, e.g. "groceries". */
  GITHUB_REPO: string;
  /** Ref to read at, e.g. "main". */
  GITHUB_REF: string;
  /** Kroger Developer (public tier) client_credentials client ID. Secret. */
  KROGER_CLIENT_ID: string;
  /** Kroger Developer (public tier) client_credentials client secret. Secret. */
  KROGER_CLIENT_SECRET: string;
  /**
   * Kroger `authorization_code` app client ID (user-context: cart writes).
   * Secret, OPTIONAL: when unset, the user-auth client falls back to
   * KROGER_CLIENT_ID — i.e. one Kroger app carrying BOTH grants (it must then
   * have a registered redirect URI + the cart scope). Set this only to point the
   * cart flow at a separate app. Used by kroger-user.ts.
   */
  KROGER_OAUTH_CLIENT_ID?: string;
  /** Kroger `authorization_code` app client secret. Secret, OPTIONAL (see above; falls back to KROGER_CLIENT_SECRET). */
  KROGER_OAUTH_CLIENT_SECRET?: string;
  /**
   * KV namespace holding the Worker's only persistent state: the rotating Kroger
   * refresh token (single key) plus short-lived PKCE verifiers keyed by `state`.
   * Bound in wrangler.jsonc. Absent in local dev unless a preview namespace is
   * configured, so the OAuth/cart paths degrade to `reauth_required`.
   */
  KROGER_KV: KVNamespace;
  /**
   * Cloudflare Access team domain, e.g. "casey.cloudflareaccess.com" (no scheme).
   * Non-secret. In-Worker JWT validation is enforced only when this AND
   * ACCESS_AUD are both set; empty disables the in-Worker check (Access still
   * gates at the edge).
   */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application AUD tag. Non-secret. */
  ACCESS_AUD?: string;
}
