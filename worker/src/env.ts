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
   * Cloudflare Access team domain, e.g. "casey.cloudflareaccess.com" (no scheme).
   * Non-secret. In-Worker JWT validation is enforced only when this AND
   * ACCESS_AUD are both set; empty disables the in-Worker check (Access still
   * gates at the edge).
   */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application AUD tag. Non-secret. */
  ACCESS_AUD?: string;
}
