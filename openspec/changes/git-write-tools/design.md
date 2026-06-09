## Context

The Worker (Changes 04–05) is read-only: one authenticated GitHub `getFile` read path, stateless `createMcpHandler` over Streamable HTTP, Kroger reads on `client_credentials` only, deployed **authless** because everything it exposes is read-only on a public repo. This change adds the first writes.

The repo is the system's only persistence — conversations are stateless and start fresh, so anything the agent must remember across them is committed. This change builds the **capture half** of the write surface (repo-data writes + atomic commit) and the identity gate that must precede any write. The order/cart/OAuth-to-Kroger half is Change 06b. Full reasoning, including the capture/flush split and the three-file state model, lives in `docs/notes/2026-06-09-order-flow-reframe.md`.

## Goals / Non-Goals

**Goals:**
- A single atomic commit path (GitHub Git Data API) that batches a session's repo changes into one clean commit.
- Repo-data write tools and the new `grocery_list.toml` buy-list with CRUD + prompted promotion.
- Structural pre-commit validation that runs on `workerd`.
- Cloudflare Access in front of the Worker so the now-writable endpoint is not public.

**Non-Goals:**
- Any Kroger/cart write, SKU resolution, or `place_order` (Change 06b).
- Kroger `authorization_code` OAuth, the KV refresh-token slot, or the `/oauth/*` carve-out (06b).
- Server-side staging of changes across tool calls (the Worker is stateless — batching is LLM-orchestrated via `commit_changes`, not a server buffer).
- Cross-reference / index validation (stays with the post-push build Action).

## Decisions

### Atomic commit via the Git Data API, not the Contents API
Build blobs/tree → create commit (parent = read base) → update ref. One tool call → one commit. **Why over Contents API:** the Contents API commits one file per call, which can't produce a single clean session commit and risks half-applied states. The existing read client is extended (same `contents:read+write` PAT from Change 04) rather than introducing a new auth path.

### Optimistic ref-update with retry (the second-writer problem)
The index-build Action (Change 02) also commits to `main` (`[skip ci]`), so a commit built off an old base can be rejected non-fast-forward. On rejection, re-read the current base, replay the same changeset, retry. **Why not lock or force:** there's no lock primitive on a ref, and force-update would clobber the Action's index commit. Mitigated in practice because high-frequency mid-week writes (pantry, grocery_list) touch **non-indexed** files and don't trigger the Action at all; the recipe/index-touching commit is roughly once-per-order.

### LLM-orchestrated batching (stateless Worker has nowhere to stage)
Because the Worker keeps no per-session state, "batched commit" cannot be a server buffer. The LLM accumulates intended changes in its own context and flushes them through one `commit_changes` call. The granular tools (`update_recipe`, etc.) each commit on their own and are for **standalone one-offs**; the calling discipline (route a session's changes through `commit_changes`, not N granular calls) lives in `CLAUDE.md`. Both paths share one internal `buildTreeAndCommit(changeset)` engine — a granular tool is just a single-entry changeset.

### Structural validation reimplemented in TS (workerd)
`scripts/build-indexes.mjs` is Node and can't run in the Worker, so the Worker reimplements the **structural subset** (TOML/YAML parse via the existing `smol-toml` + `js-yaml`; enum/status checks) to guarantee it never commits syntactic garbage. **Why not skip and rely on the Action:** a bad commit would land on `main` and turn the Action red, leaving HEAD broken. Authority line: Worker = structural/never-garbage; Action = cross-reference/index correctness.

### `grocery_list.toml` is SKU-free and vague by design
Items hold ingredient-level intent (`name` + loose `quantity`), never a resolved SKU. Resolution is deferred to order time (06b) so the cart reflects current availability — this immunizes against brand/price drift between capture and order. `kind` distinguishes non-food (skips pantry reconcile at receive); `for_recipes`/`source` carry provenance for order-time dedup/aggregation without portion math. Merge-on-add by normalized `name` keeps the list de-duplicated for the user reading the file.

### Cloudflare Access via Managed OAuth (spike-confirmed)
Claude.ai **web** connectors are OAuth-only — no custom headers, so CF Access **service tokens are ruled out**. Managed OAuth makes Access the OAuth authorization server (emits `WWW-Authenticate`, runs DCR + PKCE + token issuance), so the Worker needs **no MCP-facing OAuth code**; it optionally validates `Cf-Access-Jwt-Assertion`. **Why here, not 06b:** the gate must precede the first *git* write, which is this change — earlier than the cart write. (Spike: `docs/notes/2026-06-09-order-flow-reframe.md`.)

## Risks / Trade-offs

- **Managed OAuth is open beta** → re-verify availability before Change 07; documented fallback is `workers-oauth-provider` (OAuth endpoints implemented in the Worker), which is not beta-dependent and still standard-OAuth (works with Claude.ai web).
- **Ref-retry under a busy second writer could thrash** → bounded retry count with structured `conflict`/`upstream_unavailable` on exhaustion; acceptable because real write concurrency is single-user and index-touching commits are infrequent.
- **Granular tools can fragment the git log if misused mid-session** → not code-enforceable on a stateless Worker; mitigated by `CLAUDE.md` discipline steering sessions through `commit_changes`.
- **Worker structural validation can drift from the Node validator** → keep the Worker subset deliberately narrow (parse + enums only) and let the Action remain the authority for everything cross-cutting; divergence is contained to "stricter at build time," never "garbage committed."
- **Access misconfiguration could lock out the owner or leave a gap** → verify the only-Casey policy and the gated/redirect behavior before exposing write tools; the health endpoint stays a plain unauthenticated `GET /`.

## Open Questions

- Exact bound/backoff for the ref-update retry (pick a small constant; tune only if thrash is observed).
- Whether the Worker validates `Cf-Access-Jwt-Assertion` in v1 or trusts Access fronting it (defense-in-depth vs. simplicity) — lean toward validating, cheap to add.
