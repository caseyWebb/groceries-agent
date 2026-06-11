## Context

"Which tenant" is a `users/<username>/` path prefix derived from the OAuth grant's `tenantId` prop, re-checked each request against a KV allowlist (`tenant:<id>`). The original code passed that id verbatim into both the directory lookup and the path/key builders, with no case folding. A member onboarded as `Casey` therefore resolved to `users/Casey/` while their data lived at `users/casey/`: prefixed reads returned empty and writes created a phantom subtree, with no error surfaced. The `kroger:refresh:<id>` token key and the `/oauth/init?tenant=` flow shared the same latent split.

The `multi-tenancy` spec (`openspec/specs/multi-tenancy/spec.md`) defines username→prefix resolution, the allowlist, and the Kroger token key, but never pins the canonical *form* of a username — so casing was undefined behavior. This change records the missing invariant. The implementation already landed in commit `90af93f`; the artifacts here document and lock it.

## Goals / Non-Goals

**Goals:**
- One canonical username form (lowercase) applied consistently across the directory key, invite target, grant prop, `users/<id>/` prefix, and `kroger:refresh:<id>` key, so a casing mismatch can never split one member's state.
- Make resolution case-insensitive at a single defensive choke point, so even a non-normalizing caller or directory still resolves correctly.
- Mint provisioning entries already-canonical, so the KV key and the data subtree agree at the source.

**Non-Goals:**
- Changing shared-root behavior (recipes, feeds, discovery files) — those never use the username.
- Supporting case-*preserving* display of usernames (the id is an opaque slug, not a display name).
- Automatic migration of existing mixed-case KV entries — that's a one-time operator action (see Migration).
- Unicode case-folding / internationalized usernames beyond ASCII `toLowerCase()` + trim.

## Decisions

**Lowercase as the canonical form, applied at every key/path boundary.** A single `normalizeTenantId(id) = id.trim().toLowerCase()` helper in `src/tenant.ts` is the one definition. `userPrefix` and `tenantFromRecord` build from the normalized id; `kvTenantStore.get` looks up the normalized `tenant:<id>` key and canonicalizes the returned record `id`. *Why lowercase over case-preserving-but-case-insensitive-compare:* path prefixes and KV keys are exact strings with no case-insensitive lookup primitive — picking one stored form is the only way the directory key and the `users/<id>/` path can be guaranteed to agree. Lowercase matches the existing `users/casey/` data already on disk.

**Normalize before the directory lookup — the single defensive point.** `resolveTenant` lowercases the incoming grant `tenantId` before `directory.get(...)` and before any prefix is built. *Why here:* it's the one path every MCP request funnels through, so it holds even if an injected directory or a future caller forgets to normalize. The injected (test) store doesn't normalize, which is exactly why the choke point lives in `resolveTenant`, not only in the KV store.

**Mint canonical, and normalize at the OAuth sources too (defense in depth).** `data-onboard.yml` lowercases the username (`${U,,}`) when writing `tenant:<id>`, the record `id`, and `invite:<code>`. `authorize.ts` normalizes the resolved username before baking it into the grant prop, and `/oauth/init` normalizes its `?tenant=` query param so the Kroger refresh token lands under the same key the agent reads with. *Why redundant with resolveTenant:* each is an independent entry point that writes a durable key; normalizing at the source prevents a bad key from ever being persisted, while resolveTenant protects the read path.

## Risks / Trade-offs

- **Existing mixed-case members flip from silently-empty to `unauthorized`.** → Intended: a loud, correct failure beats silent data loss. Resolved by the one-time re-mint in the Migration plan. Surfaced to the operator rather than papered over with a case-insensitive KV scan.
- **A pre-existing Kroger token under `kroger:refresh:Casey` is orphaned.** → The member re-runs `/oauth/init` once (now normalized); the token re-consent is cheap and one-time.
- **`toLowerCase()` is ASCII-oriented.** → Acceptable: usernames are operator-assigned slugs for a known friend group, not free-form internationalized input. Revisit only if a non-ASCII username is ever minted.
- **Two allowlist entries differing only by case would now collapse to one tenant.** → The directory is operator-curated; the spec forbids colliding entries. No automated guard added (out of scope for a curated allowlist).

## Migration Plan

1. Deploy the Worker (the normalization is backward-compatible for any already-lowercase member).
2. For each member onboarded with non-lowercase casing, re-mint the canonical KV entries and delete the stale ones:
   - Re-run the onboard workflow with the lowercase username (writes `tenant:<id>` + `invite:<code>` lowercase).
   - Delete the stale mixed-case directory key, e.g. `wrangler kv key delete --namespace-id=<TENANT_KV_ID> --remote "tenant:Casey"`.
   - The member re-authorizes (grant prop refreshes to lowercase) and re-runs `/oauth/init` if they had Kroger consent.
3. **Rollback:** revert the Worker; the lowercase KV entries minted in step 2 remain valid for the old code (it read them verbatim), so no data rollback is needed.

## Open Questions

None — the implementation is landed and the invariant is settled.
