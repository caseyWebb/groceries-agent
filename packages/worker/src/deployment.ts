// Deployment-level identity for member surfaces (connect-modal): the D9 deployment
// profile and the operator's public-facing config. Both are read by the whoami
// response (src/api/session.ts) so the SPA can template setup copy and gate
// profile-dependent surfaces — never secrets, never per-tenant data.

import type { Env } from "./env.js";

/** The D9 deployment profiles. `self-hosted` hides the friends surface and treats the
 *  deployment as one implicit all-to-all friend graph; `saas` enables the full social
 *  surface. Long-term configuration, not migration scaffolding. */
export type DeploymentProfile = "self-hosted" | "saas";

/**
 * Resolve the deployment profile. This accessor is the ONE site that names the
 * profile's source: the profile flag channel does not exist yet, and every live
 * deployment is self-hosted, so it returns the constant. When the flag channel ships
 * (the households/friends band), re-point this function — its callers (whoami, and any
 * later profile-gated read) stay unchanged.
 */
export function deploymentProfile(_env: Env): DeploymentProfile {
  return "self-hosted";
}

/** The operator identity the connect modal templates into its setup steps. */
export interface OperatorConfig {
  /** Display name for "updates {name} ships" copy. `OPERATOR_NAME`, falling back to
   *  `OWNER_TENANT_ID`; null when neither is set (copy degrades to "your operator"). */
  name: string | null;
  /** The plugin-marketplace repo slug (`<owner>/<data-repo>`). Stamped onto the deploy
   *  by data-deploy.yml from the calling data repo; null when unset (local dev). */
  repo: string | null;
}

/** Read the operator's public-facing config from the deployment vars. Unset values are
 *  explicit nulls — the modal degrades to generic copy, never a fabricated slug. */
export function operatorConfig(env: Env): OperatorConfig {
  const name = env.OPERATOR_NAME?.trim() || env.OWNER_TENANT_ID?.trim() || null;
  const repo = env.MARKETPLACE_REPO?.trim() || null;
  return { name, repo };
}
