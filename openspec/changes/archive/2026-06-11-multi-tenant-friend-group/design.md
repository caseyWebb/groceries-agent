## Context

The system is single-tenant in five places: global `GITHUB_OWNER/REPO/REF` + a static PAT ([env.ts](worker/src/env.ts)); one Kroger `client_credentials` app for reads; one Kroger `authorization_code` app for cart writes; the refresh token at a single KV key `kroger:refresh_token` ([kroger-user.ts:26](worker/src/kroger-user.ts)); and Cloudflare Access gating the Worker by team membership ([index.ts:52](worker/src/index.ts), [access.ts](worker/src/access.ts)). The Worker already builds a fresh MCP server per request closing over `env` ([index.ts:59](worker/src/index.ts)) — the natural seam to make it close over a resolved tenant instead.

**Target operating model:** the technical member of a friend group self-hosts **one** instance for the group. Not a startup, not a hosted free service. The user set is small (≈ a handful), known, and trusted. Two hard constraints: friends do not stand up their own Worker, and friends do not register their own Kroger Developer app.

**Kroger research (load-bearing, sourced):** the public tier splits cleanly — `client_credentials` (search/flyer/prices) is app-level; `authorization_code` + `cart.basic:write` is per consenting user via redirect+PKCE, so one app can hold refresh tokens for many users. Documented rate limits are **per-app, per-endpoint, per-day**: Products 10,000, Locations 1,600/endpoint, **Cart 5,000**, Identity 5,000 ([CupOfOwls/kroger-api](https://github.com/CupOfOwls/kroger-api), corroborated by Kroger's [API Basics](https://developer.kroger.com/documentation/public/getting-started/apis)). At friend-group scale the shared 5,000 cart-calls/day cap is far above need. Two things stay **unverified** because Kroger's docs are JS-rendered and would not load: (a) the public-tier [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use) clause on serving non-owner users, and (b) whether a partner tier lifts the cap. The docs do expose a `-public` vs `-partner` tier split, implying serious/commercial multi-user cart use is the partner track. At this scale and non-commercial intent the residual risk is low and the blast radius is one group.

## Goals / Non-Goals

**Goals:**
- One self-hosted Worker serves many tenants; each friend connects their own Claude.ai.
- No per-friend Worker; no per-friend Kroger Developer app.
- Keep flat-files-in-git as the domain store; no SQL database.
- Turn the recipe corpus collaborative: shared content, per-tenant lenses, attributed notes.
- A self-hosting guide (`docs/SELF_HOSTING.md`) the operator can follow cold.

**Non-Goals:**
- Open public signup or a hosted free instance.
- Cross-tenant privacy controls beyond a per-note `private` flag (the group is trusted).
- Automating each friend's Claude.ai Project instruction paste (a Claude.ai platform limit).
- Tenant-side conflict resolution for concurrent shared-content edits beyond commit retry.
- Supporting non-Claude harnesses (e.g. ChatGPT) in this change. The backend is harness-agnostic and ChatGPT is technically feasible (see Open Questions), but support is deferred and the preference is to steer the group toward Claude.ai rather than carry a second harness.

## Decisions

### D1: The Worker becomes a multi-tenant OAuth 2.1 provider; Cloudflare Access is removed

Claude.ai custom connectors authenticate via OAuth and offer no bearer/no-auth option, so identity must be OAuth-shaped regardless. The Worker hosts the OAuth provider (via Cloudflare's `workers-oauth-provider`, which stores clients/codes/grants in KV — no SQL). The issued access token is the tenant identifier; every MCP request resolves token → tenant before any tool runs. Cloudflare Access (`access.ts`, the edge policy) is removed — it gates by team membership, which is single-tenant by nature.

**Alternatives considered:** *(a) Keep Access, add every friend to the Access team* — Access identity doesn't propagate a usable per-tenant key into tools and conflates "is allowed" with "which tenant"; rejected. *(b) Per-friend Worker* — violates the no-per-friend-infra constraint; rejected.

### D2: Identity step is an operator-issued invite code against a curated allowlist (RESOLVED)

Because the user set is small and trusted, the OAuth provider's identity step is gated by an **operator-curated allowlist**, not open registration. The identity step is an **operator-issued invite code**, not GitHub login. Rationale: under Model B (D4) every repo is operator-owned, so a friend's GitHub identity does no structural work — requiring friends to have GitHub accounts is friction with zero payoff. The durable tenant key is an **opaque, operator-assigned tenant id** (e.g. `"alice"`) that the directory maps to repo coords + installation; the invite code is merely the connect-time secret that binds a friend's Claude.ai to a pre-provisioned tenant. After first connect, the issued OAuth access token is the durable credential and the invite code never runs again. A friend needs only a Claude.ai account and a Kroger account — no GitHub or other third-party account.

**Alternatives considered:** *(a) GitHub login* (the original lean) — elegant only if friends have GitHub accounts; under Model B they don't and shouldn't need them; rejected. *(b) Per-tenant connector credential* (distinct OAuth client per friend) — no code to type but more operator setup per friend; viable but heavier; not chosen. *(c) Open dynamic registration* — wrong model for self-hosting-for-friends; rejected.

### D2a: The deployable code repo is separated from data; self-hosters deploy without forking (RESOLVED)

Today code and data are conjoined in one repo. They are split: the **code** (the Worker backend — `worker/`, `docs/`, `openspec/`, `scripts/`) is **one upstream repo** that self-hosters *deploy* (clone + set secrets + `wrangler deploy`) without forking-and-diverging; **all the data** lives in **one** operator-created private repo (D4). A self-hoster "just creates a data repo" — they never re-create or fork the code. Identification is two independent steps: deploy-time config (`DATA_*` coords + the KV username allowlist) says *which data repo this Worker serves*; the request-time invite-code→tenant binding (D2) says *which member a caller is* (→ their `users/<username>/` subtree). A solo operator simply has one `users/<id>/` subtree; the model is the same at any size.

### D3: Repo writes via a GitHub App installation token, not a PAT

The Worker authenticates repo access with a short-lived **GitHub App installation token** minted on demand from the App's id + private key, scoped to the installation covering the target repo. No global PAT, no stored per-user PAT. This is the linchpin that lets "a friend's repo" be writable without gross secret handling, and it raises the rate ceiling (5,000 req/hr **per installation** vs. one shared PAT bucket).

**Alternatives considered:** *(a) Per-user fine-grained PAT pasted at onboarding* — the Worker would custody long-lived user secrets and onboarding gets ugly; rejected. *(b) One global PAT across all repos* — re-centralizes the secret and shares one rate bucket; rejected.

### D4: One private data repo with `recipes/` + `users/<username>/` (REVISED 2026-06-10 — no org)

A single **private** data repo on the operator's personal account holds everything: shared `recipes/` + reference data at the root, and one `users/<username>/` subtree per member (pantry/preferences/taste/diet_principles/grocery_list/stockup/cooking_log/meal_plan/feeds, `overlay.toml`, `notes/`). A single GitHub App installation on the operator's account, scoped to that one repo, covers all reads and writes. **No GitHub org, and members need no GitHub account** — the Worker writes on their behalf (App token); identity is an invite code (D2). "Which tenant" is a `users/<username>/` path prefix, not a separate repo (worker: `prefixedClient`).

This revises the earlier "Model B" (operator org + shared corpus repo + per-tenant repos), which the operator rejected as too heavy: it required an org and pushed friends toward GitHub accounts. The chosen shape is effectively the formerly-rejected single-repo option, now accepted because the operator explicitly does not want an org or per-friend GitHub identities, and at friend-group scale its costs are tolerable: coupled git history is fine for a trusted handful, and concurrent-write contention on the one ref is already absorbed by the atomic-commit engine's non-fast-forward retry. The repo is **private** because it carries every member's personal state (so recipes are no longer world-public — see Risks).

**Alternatives considered:** *(a) Operator org + one repo per friend (the prior "Model B")* — cleaner data ownership and split git history, but needs an org and nudges friends toward GitHub accounts; rejected by the operator. *(b) Friends own their own repos + per-friend App installs* — maximal sovereignty, but every friend does GitHub setup and needs an account; rejected (contradicts "no accounts"). *(c) Recipes public + personal data private in two repos* — preserves a public cookbook but is two data repos; rejected in favor of one repo (a public recipe export is a possible later follow-up).

### D4a: The public cookbook site publishes from the private data repo (GitHub Pro)

The existing static cookbook site renders only `recipes/` (the generator never reads personal files), so it stays **public** even though the data repo is private. Because each operator's site must build from *their* private `recipes/`, the pipeline lives in the **data repo's** CI: a `build-site.yml` checks out the public code repo (build scripts, pinned — no secret needed) plus the data repo, builds, and deploys Pages. Publishing a public Pages site from a private repo requires **GitHub Pro** (free-tier Pages is public-repo only); the operator accepted that cost. Consequence for the generator: recipe inclusion no longer keys on per-recipe `status` (now per-user overlay) — the public site publishes the whole shared corpus (or a future global `published` flag). Tracked as §5.4; deferred to migration execution.

**Alternative considered:** *build in the data-repo CI but push the built site to a separate public mirror repo (free Pages)* — avoids the Pro cost but adds a mirror repo + push token; not chosen.

### D5: Three-category data model — content / overlay / notes

Recipe data splits along the seam the frontmatter already has. **Content** (objective frontmatter + body) is shared, single-source. **Overlay** (`rating`, `last_cooked`, `status`) is per-tenant, single-value, stored in the tenant repo and joined at read time (absent → effective `status: draft`). **Notes** are shared, multi-author, attributed, append-mostly. Only three frontmatter fields are subjective, so the split falls almost exactly on existing field boundaries. Reads join shared content + caller overlay + caller's personal recipes; the shared index drops the subjective fields (they're merged at read, not baked in).

**Alternatives considered:** *(a) Fully per-user corpora* — duplicates the same recipe across friends, makes cross-pollination a fuzzy-matching problem, and bloats discovery; rejected. *(b) Subjective fields as per-user maps inside shared frontmatter (`ratings: {alice: 5}`)* — forces every user to write the shared repo and abuses frontmatter; rejected in favor of overlay files.

### D6: Notes are the spin-capture mechanism, which is what makes the shared corpus safe

The one real cost of a shared corpus is "people want their own tweaks, but editing shared content hits everyone." Resolution: a tweak is an **attributed note**, not a content edit. The canonical recipe stays canonical; "sub gochujang, cut the sugar" lives as a note. Only a genuine "this is now a different dish" warrants the private-recipe fork (the escape hatch in D5). Notes therefore graduate from "eventually" to **must-build** in this change. A per-note `private` flag keeps personal notes personal; default is shared (collaborative within a trusted group). Notes are authored in the tenant's repo (ownership + structural attribution) and surfaced via read-time aggregation across the group (cheap at this scale; cache in KV if needed).

### D7: Shared SKU cache is location-tagged and revalidated per caller

The SKU cache moves to the shared corpus for a network-effect win (one friend's resolution warms everyone's). Each entry is tagged with the `locationId` it was resolved at. The existing matching pipeline already revalidates every cache hit against the caller's `preferred_location` ([PROJECT.md matching step 2](docs/PROJECT.md)), so a shared cache can never serve an entry unavailable at the caller's store — it just falls through to search. `aliases`/`ingredients` are shared; `substitutions` is shared with an optional per-tenant override layer.

### D8: Per-tenant Kroger tokens; kill the module-level token cache

`REFRESH_KEY` becomes `kroger:refresh:<tenant>`; PKCE `state` binds to the initiating tenant so the callback stores under the right key; the in-isolate access-token cache becomes per-tenant. The current module-level singleton ([kroger-user.ts:66](worker/src/kroger-user.ts)) is a **correctness bug** under multi-tenancy (it could serve one tenant's token to another) and must be reworked, not just re-keyed.

### D9: No SQL database — KV holds only operational mapping

Domain data stays in flat files in repos. KV holds only: the tenant directory (identity → repo coords + installation), per-tenant Kroger refresh tokens, OAuth provider state, and short-lived PKCE verifiers. The "no separate database" property was always about domain data; it is preserved.

## Risks / Trade-offs

- **Kroger Acceptable-Use clause on serving non-owner users is unverified** → the operator should skim the policy once (or email Kroger dev support: "can one public-tier app hold cart tokens for several consenting users?"). Low blast radius at this scale; documented as a known unknown in `SELF_HOSTING.md`.
- **Shared 5,000 cart-calls/day cap** → fine for a handful of friends; would wall an open-signup model. The friend-group framing keeps us under it; `SELF_HOSTING.md` notes the ceiling.
- **Read-path join cost** (shared index + per-tenant overlay + cross-tenant notes) → more work in the hot path and a real implementation tax. Mitigation: overlay is small per-tenant TOML; note aggregation across ~10 repos is cheap and cacheable in KV with short TTL.
- **Concurrent writes to the shared corpus** (two friends importing/editing at once) → the atomic-commit engine's non-fast-forward retry already handles this; idempotent import (dedupe by source URL/slug) prevents duplicate recipes.
- **Global shared-content edits affect everyone** → mitigated by D6 (spins are notes, not edits) + the private-recipe fork for genuine divergence.
- **Tenant isolation is now load-bearing** → a bug that leaks one tenant's repo/token to another is the highest-severity failure. The per-tenant server build (D1) and per-tenant Kroger cache (D8) must be covered by tests that assert no cross-tenant bleed.
- **GitHub App private key is a new high-value secret** → Worker secret only (`wrangler secret put`), never in the repo; documented in `SELF_HOSTING.md`.

## Migration Plan

This is effectively a re-architecture of the deployment, not an in-place tweak of a live multi-user system (there is one user today). Suggested sequencing:

1. **Stand up the shared corpus repo** by extracting today's single repo's content/reference/SKU/indexes into the operator org; the existing repo becomes (or seeds) the operator's own per-tenant repo (overlay extracted from current subjective frontmatter).
2. **Register the GitHub App**, install on the org, wire installation-token minting; swap `github.ts`/`gh-read.ts`/`commit.ts` off the PAT.
3. **Stand up the OAuth provider + allowlist + tenant directory**; replace the Access gate in `index.ts`; delete `access.ts`. The operator is tenant #1 — dogfood end-to-end before inviting anyone.
4. **Re-key Kroger** to per-tenant; rework the token cache; re-run the operator's one-time consent.
5. **Land the data-model split** (overlay join in read tools, category routing in write tools, shared index drops subjective fields, notes tools).
6. **Onboard one friend** as the first real multi-tenant exercise; iterate `SELF_HOSTING.md` from what actually tripped them up.

**Rollback:** until the OAuth provider replaces Access (step 3), the current single-tenant deployment keeps working; steps are additive in the org until cutover. Worst case, repoint the connector at the old Access-gated Worker.

## Open Questions

- **~~Notes vs. cooking-log relationship.~~** PARTIALLY RESOLVED. `cooking-log-and-retrospection` merged (Change 11): `cooking_log.toml` is the per-tenant realized-history spine and `last_cooked` is *derived* from it. Reconciliation with the three-category model (D5): **overlay carries only `rating` and `status`** (the two genuinely-subjective single-values); **`last_cooked` is NOT an overlay field — it is derived per-tenant from that tenant's `cooking_log.toml`** (max cook date for the slug). The shared index still drops all three subjective fields. Notes remain the general spin-capture capability (D6); a cooking-log entry may *produce* a note rather than owning its own annotation store. Overlay is stored as a single per-tenant `overlay.toml` keyed by slug (one read for the list join, per the read-path-join-cost mitigation) rather than `overlay/<slug>.toml`.
- **~~GitHub login vs. invite code for the identity step (D2).~~** RESOLVED → operator-issued invite code (see D2). Friends own no GitHub infra and need no GitHub account; the opaque operator-assigned tenant id is the durable key. The remaining build question is purely UX: how the invite code is collected at the Claude.ai connector's OAuth consent step (a Worker-hosted authorize page form), tracked in §3.2.
- **Where does AGENT_INSTRUCTIONS.md live per tenant?** Shared (one canonical paste) is almost certainly right, but each friend still pastes it into their own Claude.ai Project manually — confirm there's no per-tenant variation needed beyond the connector URL.
- **Note granularity/schema.** v1 keeps notes as free-form attributed markdown with optional tags + `private`; defer any structured "modification note" type until felt.
- **Acceptable-Use verification owner/timing** — operator action before inviting non-owner friends; capture the answer in `SELF_HOSTING.md`.
- **Harness portability (deferred; lean toward Claude-only).** The backend is LLM-agnostic — pure MCP over Streamable HTTP + the OAuth-provider identity layer — so it is not coupled to Claude. ChatGPT is technically feasible *without a second tool surface*: ChatGPT connects to remote MCP servers over HTTPS + OAuth 2.1 and, in **Developer Mode** (beta), exposes all tools including writes (the default connector mode is `search`/`fetch` only and would hide the domain tools). If ever pursued, two gaps must be closed: (a) the OAuth provider would need to accept **CIMD** client registration (ChatGPT's recommended style) alongside Claude.ai's **DCR**; (b) confirm ChatGPT can pin instructions to a *scoped, persistent agent* the way a Claude.ai Project pins `AGENT_INSTRUCTIONS.md` + connector (unconfirmed — Developer Mode connectors may attach at chat/account level). Decision for now: **deferred / non-goal** — encourage friends onto Claude.ai rather than maintain a second harness. Revisit only if the group skews ChatGPT.
