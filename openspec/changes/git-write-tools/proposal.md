## Why

The Worker is read-only today, so nothing the agent learns survives a conversation — yet the repo is the system's *only* memory (conversations are stateless and start fresh). Persisting state therefore requires a git-write path. And the instant any write endpoint exists, the currently-authless public Worker must be gated, or anyone with the URL can edit the repo. This change builds the **capture half** of the write surface — repo-data writes + atomic commit — behind a Cloudflare Access identity gate. All Kroger/cart writes are deferred to Change 06b (`place_order`); see `docs/notes/2026-06-09-order-flow-reframe.md` for the capture/flush split.

## What Changes

- **Atomic batched-commit engine** via GitHub's Git Data API (build tree → create commit → update ref), never sequential per-file commits. Optimistic ref-update with retry, because the index-build Action (Change 02) is a second writer.
- **Repo-data write tools:** `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools, and `commit_changes` (the everyday persist path — no cart).
- **New `grocery_list.toml` buy-list** — an ingredient-level, **SKU-free** list that accumulates buy-intent across the week. CRUD tools (`read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, `remove_from_grocery_list`) plus prompted promotion from low/out pantry. Resolution to SKUs and the cart write are deferred to 06b.
- **Structural pre-commit validation** in the Worker (TOML/YAML parses, enums/status well-formed) so it never commits syntactic garbage. The Node validator (`scripts/build-indexes.mjs`) can't run on `workerd`, so this is a TS subset; cross-reference/index validation stays the post-push Action's job.
- **Cloudflare Access in front of the Worker** via Managed OAuth (policy: only Casey's identity). The MCP endpoint is **no longer authless**. Claude.ai web is OAuth-only, so Access acts as the OAuth authorization server; the Worker needs no MCP-facing OAuth code (optionally validates `Cf-Access-Jwt-Assertion`). **BREAKING:** unauthenticated requests to the MCP endpoint are now rejected.
- **`write_cart_and_commit` re-cut** (contract change in `docs/TOOLS.md`): `commit_changes` (this change) + `place_order` (06b). The monolithic tool is never built.
- **Docs:** `grocery_list.toml` added to `docs/SCHEMAS.md`; `docs/TOOLS.md` synced; `CLAUDE.md` gains capture/flush behavior, the three-file state model, and prompting rules.

## Capabilities

### New Capabilities
- `data-write-tools`: the atomic Git Data API commit engine and the repo-data write tools (recipe/pantry/ready-to-eat/curated-config writes, `commit_changes`), with structural pre-commit validation and structured errors per the Change 04 convention.
- `grocery-list`: the `grocery_list.toml` buy-list — schema, item lifecycle state field, CRUD tools, prompted promotion from pantry, and the order-time dedup contract (`list ∪ menu-needs − pantry-has`). SKU resolution and the cart write are out of scope (06b).

### Modified Capabilities
- `mcp-server`: the Worker's MCP endpoint now sits behind Cloudflare Access (Managed OAuth, only-Casey policy) and is no longer authless. The health endpoint and the future `/oauth/*` carve-out (06b) are accounted for.

## Impact

- **Worker (`worker/`):** new modules — GitHub write client (Git Data API), atomic-commit engine, grocery-list tools, structural validation; new write tools registered on the MCP server. No KV here (KV is 06b). No Kroger code.
- **Repo data:** new `grocery_list.toml` at the repo root.
- **Docs:** `docs/SCHEMAS.md` (grocery_list schema), `docs/TOOLS.md` (write-tool contracts, `write_cart_and_commit` re-cut), `CLAUDE.md` (capture/flush behavior, prompting).
- **Infra:** Cloudflare Access configured in front of the Worker via Managed OAuth (**open beta** — re-verify before Change 07; fallback `workers-oauth-provider`). Reuses the existing `contents:read+write` PAT from Change 04 — no new GitHub scope.
- **Dependencies:** Change 04 (Worker skeleton + GitHub client). Not Change 05 — no Kroger — so buildable in parallel with it.
