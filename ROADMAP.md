# ROADMAP.md — OpenSpec Change Proposals

A sequence of independently-buildable OpenSpec changes. Each change is sized to fit within OpenSpec's recommended 200-300 line spec cap and produces something concrete and testable. Dependencies are listed explicitly. You can build them in the suggested order, or fan out where dependencies allow parallel work.

The basic workflow per change:

1. Open Claude Code in the repo.
2. Use the OpenSpec proposal skill: "I want to implement change <N>: <title>. Here's the scope: ..."
3. Claude Code drafts `openspec/changes/<change-id>/proposal.md` + `specs/` deltas + `design.md` + `tasks.md`.
4. Review, refine, then `/openspec-apply` to implement.
5. `/openspec-archive` when done.

Each entry below contains enough description for the OpenSpec proposal skill to generate a real proposal artifact. Treat them as starting points, not final specs.

---

## Change 01: Repo skeleton

**Scope:** Initialize the repository structure exactly as specified in `docs/PROJECT.md`. Create all directories, empty TOML files with header comments, README, gitignore, and commit CLAUDE.md + docs/SCHEMAS.md + docs/TOOLS.md at the root or under `docs/`.

**Dependencies:** None.

**Deliverables:**
- All directories from docs/PROJECT.md's repo structure
- Stub TOML files with header comments and example commented-out entries per docs/SCHEMAS.md
- `README.md` explaining the project and how to use the repo
- `.gitignore` (Node, OS, editor files, Worker secrets)
- CLAUDE.md, docs/SCHEMAS.md, docs/TOOLS.md, docs/PROJECT.md committed at the root or under `docs/`
- Initial commit; push to GitHub private repo

**Done when:** `git clone` produces the structure that everything else builds on. Obsidian (or similar) can open `recipes/` and show... nothing yet, but the structure is there.

---

## Change 02: Index generation + validation Action

**Scope:** Implement `scripts/build-indexes.mjs` (TypeScript or modern JS) that walks `recipes/` and other relevant directories, generates `_indexes/recipes.json`, `_indexes/components.json`, `_indexes/ready_to_eat.json`, and runs validation (TOML parses, frontmatter well-formed, references resolve, status enums correct). Wire into a GitHub Action triggered on push to data directories. Add a local pre-commit hook running the same validation.

**Dependencies:** Change 01.

**Deliverables:**
- `scripts/build-indexes.mjs`
- `.github/workflows/build-indexes.yml`
- Pre-commit hook (in `scripts/pre-commit.sh` or via `husky`)
- Validation failure modes documented in CLAUDE.md or README
- Action commits regenerated indexes with `[skip ci]` to prevent loops

**Done when:** Pushing a recipe (or even an empty repo) triggers the Action; indexes regenerate; validation runs; the local pre-commit hook catches issues before push.

**Notes:** Can be built with empty/dummy recipes. The Action is content-agnostic.

---

## Change 03: Recipe corpus migration

**Scope:** Import an initial 30-50 recipes from existing sources (ReciMe, personal notes, bookmarked URLs) into `recipes/*.md` with proper frontmatter per docs/SCHEMAS.md. This is partly manual data work; the implementation aspect is small.

**Dependencies:** Changes 01 and 02 (validation needs to pass).

**Deliverables:**
- 30-50 well-formed recipe markdown files
- All recipes with status: active (these are your starting corpus)
- Indexes regenerate cleanly via the Action
- Pre-commit hook validation passes

**Done when:** Browsing `recipes/` in Obsidian on phone shows your real recipes with rendered frontmatter. The corpus is searchable client-side via Obsidian.

**Notes:** Don't aim for perfect frontmatter — `last_cooked` can be null for everything initially, `rating` can be null, `meal_preppable` can default to false. Refine as you cook them and the agent learns.

---

## Change 04: Worker skeleton + repo-data read tools

**Scope:** Bootstrap a Cloudflare Worker in `worker/` with TypeScript, the MCP SDK, and the basic plumbing. Implement the **repo-data-backed read tools** from docs/TOOLS.md: `list_recipes`, `read_recipe`, `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`. These read only from the GitHub repo (indexes + flat files) — no external services. Set up GitHub API client. Deploy via Wrangler. Test via MCP Inspector.

**Tool/Kroger split (decided):** This change is the **repo-data** half of the tool surface. Anything that touches Kroger lives in the external-services bucket (Change 05). `ready_to_eat_available` — whose defining behavior is the Kroger availability cross-reference — therefore moves to **Change 05**, not here. The catalogs are empty until Change 05/10 populate them anyway, so nothing is lost by deferring. Result: Change 04 is exactly six pure repo-data reads.

**Transport (decided):** Use `createMcpHandler()` (stateless, **no Durable Objects**) over **Streamable HTTP** (SSE is deprecated). The six read tools are pure functions of repo state — no per-session memory — so the heavier `McpAgent` + Durable Objects path isn't needed.

**Auth posture (decided).** Three separate auth legs — keep them distinct:
- *Leg 1 — Worker → GitHub:* a fine-grained **PAT** scoped to this repo, set via `wrangler secret put GITHUB_TOKEN`. Server-side secret; Claude.ai never sees it. Scope it `contents:read+write` once so Change 06 reuses it.
- *Leg 2 — Claude.ai → Worker:* deploy **authless for Change 04** (read-only on public data leaks nothing; test via MCP Inspector). Securing this leg lands via **Cloudflare Access** in front of the Worker (policy: only Casey's identity), and **must be in place by Change 06** — the moment write/cart tools exist, an authless public URL lets anyone write the repo and add to the cart. Change 07 then just points Claude.ai at the already-secured Worker; it is *not* the first place auth appears.
- *Leg 3 — Worker → Kroger:* Change 05, separate OAuth, Worker secrets.

**GitHub access (decided — Option B):** Build the authenticated GitHub client wrapper **now** (not tokenless), reused by Changes 05/06. Authenticated reads get 5,000 req/hr vs. 60/hr unauthenticated; writes (Change 06) need the token regardless of repo visibility, so reads piggyback on it. `list_recipes` reads `_indexes/recipes.json` (one call, filter in-worker); the rest read flat files at `main` HEAD. No KV cache in v1 — add only if latency is felt.

**CI/CD (decided — CD from day 1):** Ship `.github/workflows/deploy-worker.yml` that deploys on push to `worker/**`. First deploy is manual (`wrangler deploy`, to create the Worker and run `wrangler secret put` for the PAT); CD owns every deploy after. The **Cloudflare API token** lives in GitHub Actions secrets; the **Worker's own secrets** (PAT, later Kroger tokens) are set via `wrangler secret put` straight to Cloudflare and persist across deploys — they are NOT in the repo or in Actions.

**`list_recipes` semantics (decided):**
- Array filters (`tags`, `dietary`, `season`) match **ALL** listed values (AND / narrowing). Trivial to widen later if it annoys.
- `exclude_recently_cooked` is a **tool param** — `exclude_cooked_within_days` (number) — not a hardcoded window or a preferences lookup. Caller decides.
- Requesting every status is **explicit**: `status: "all"`. Default remains `active`.
- `not_cooked_since` **passes** recipes with `last_cooked: null` (never cooked ⊃ not-cooked-since-X, i.e. infinity).

**Errors (decided):** Tools return **structured** errors the agent can reason over, never raw throws/500s. Enumerate explicit cases with helpful messages: unknown recipe slug, missing/malformed `_indexes/recipes.json`, GitHub unreachable or rate-limited, malformed TOML/frontmatter. Shape e.g. `{ error: "not_found", slug, message }`. This convention is set here and inherited by every later tool.

**`read_recipe` shape (decided):** Drop `last_modified` from the return — it would cost an extra Commits-API call per read and nothing currently consumes it. Return `{ slug, frontmatter, body }` (blob `sha` available cheaply if a need appears). Revisit if a consumer materializes.

**Parsing on `workerd` (decided — minimal deps):** Do **not** use `gray-matter` in the Worker (Node `Buffer` assumptions). Split frontmatter on `---` by hand and parse the YAML with `js-yaml` (pure JS, runs on `workerd`); TOML via `smol-toml` (already a dep). Rewriting the small amount of parsing glue is acceptable to keep the dependency surface thin.

**`read_pantry` filter (decided):** Ship `category` and `prepared_only` (both deterministic from pantry data). `stale_only` depends on shelf-life thresholds from `ingredients.toml` (Change 12) and can't be computed deterministically yet — until then it returns a structured `{ error: "unsupported" }` rather than guessing. Same deferral shape as `ready_to_eat_available`.

**Local dev + secrets hygiene (decided):** `wrangler dev` locally, MCP Inspector pointed at the local URL; the PAT lives in `.dev.vars` for local runs. Anything gitignored-but-needed-to-run gets documented in `worker/README.md` as it's added (the repo is public — no secret silently required). Confirm `.gitignore` covers `.dev.vars` and `.wrangler/`.

**TOOLS.md is the contract — keep it in sync.** When a tool's params/returns change during a proposal or build, update `docs/TOOLS.md` in the same pass. No drift. (Already reconciled for the `list_recipes` filter rename, the `read_recipe` `last_modified` drop, and the `read_pantry` `stale_only` deferral.)

**Dependencies:** Change 01 (structure), Change 03 (some recipes to read). Change 02 not strictly required but helpful (`_indexes/recipes.json` enables `list_recipes`).

**Deliverables:**
- `worker/` directory with full TypeScript Worker source (own `package.json`/`tsconfig`, separate dep tree from the root index-build tooling)
- `worker/wrangler.toml` (or `wrangler.jsonc`) and deployment config
- Authenticated GitHub client wrapper (PAT via Worker secret; handles rate limiting, basic retries, structured errors)
- The six repo-data read tools per docs/TOOLS.md, returning structured JSON
- `list_recipes` filter logic over the index per the semantics above (AND on arrays, `status: "all"` opt-out, `exclude_cooked_within_days` param, null-`last_cooked` passes `not_cooked_since`)
- `js-yaml` + manual frontmatter split for recipe parsing; `smol-toml` for TOML — no `gray-matter` in the Worker
- Explicit structured error cases with helpful messages (unknown slug, missing/bad index, GitHub down/rate-limited, malformed data)
- `.github/workflows/deploy-worker.yml` — CD on push to `worker/**` (Cloudflare API token in Actions secrets)
- First manual `wrangler deploy` + `wrangler secret put GITHUB_TOKEN`; Worker live at `grocery-mcp.<your-subdomain>.workers.dev`
- README in `worker/` explaining local dev, the one-time manual deploy/secret setup, and how CD takes over

**Done when:** You can invoke `list_recipes({ status: "active" })` from MCP Inspector and see your migrated recipes returned as JSON, and a push to `worker/**` redeploys via CD.

---

## Change 05: Kroger API integration + matching pipeline

**Scope:** Implement the Kroger-facing (external-service) **read** tools inside the Worker: `kroger_flyer`, `kroger_prices`, `kroger_search` (internal helper), `ready_to_eat_available` (catalog read **+** Kroger availability cross-reference — moved here from Change 04 because its defining behavior needs Kroger), and the headline `match_ingredient_to_kroger_sku` with its full 7-step deterministic pipeline (**resolve-only** — see below). Sign up for the Kroger Developer account; authenticate with the `client_credentials` grant; store the Kroger client ID/secret as Worker secrets.

**This is the "external services" half of the tool surface** — the counterpart to Change 04's repo-data reads.

**Read-only scope (decided).** Change 05 is **entirely read-only** and stays **authless + stateless**, inheriting Change 04's posture unchanged. Every Kroger tool here uses the `client_credentials` grant (products, prices, flyer, availability) — none needs the user-context `authorization_code` flow, because none writes a cart. Two writes that earlier drafts placed here move to **Change 06** so the first write and the Cloudflare Access gate that protects it ship together:
- **SKU cache writes** → Change 06, folded into `write_cart_and_commit`'s atomic batched commit. The matching pipeline here *resolves and returns* a mapping; it does **not** persist it.
- **`authorization_code` OAuth + callback route + KV refresh-token storage** → Change 06, paired with the cart-write tool that consumes them. (Kroger refresh tokens are **single-use/rotating**, so they need a writable KV slot — that lands in Change 06, not here.) Change 05 needs no persistent storage: client-credentials access tokens live in isolate memory, re-minted on expiry.

**Kroger API reality (decided — researched 2026-06):**
- **Public tier only.** The richer **Catalog API / Catalog API V2** are *partner*-gated (negotiated Kroger Digital contract, bespoke catalog) — out of reach for a personal app. The **public Products API** (term search + per-item price, location-scoped) is the ceiling. The *partner* Cart API can read/remove items; the **public Cart API is add-only** — so the write-only cart limitation is a tier artifact, not a choice.
- **No flyer/circular endpoint.** There is no "list all sales" primitive. Product price is `{ regular, promo }` where `promo: 0` means not on sale; the only way to find a sale is to search a term and inspect `promo`. So `kroger_flyer` is a **synthesized scan**, not a feed (see below).
- **`filter.locationId` is required for pricing.** Resolving `preferences.toml`'s `preferred_location` label → a Kroger `locationId` via the Locations API (cached) is a **hard prerequisite** for every priced call.
- **Availability = curbside/delivery fulfillment.** Per user decision, availability means `fulfillment.curbside || fulfillment.delivery` at the location — *not* live in-store inventory (the API exposes no stock level). `ready_to_eat_available` and the pipeline's "in stock" filter use this fulfillment signal.
- **Rate limits are undocumented.** Kroger publishes no firm numeric limits (community-cited figures exist but aren't canonical). Design the Kroger client for `429` + `Retry-After` / exponential backoff rather than a hardcoded budget.

**`kroger_flyer` mechanics (decided).** Two term sources, deduped by `productId`, each scanned and filtered to `promo > 0`:
- **Precise terms** — *derived* (stockup-flagged pantry items, current menu ingredients, substitution candidates). High precision.
- **Broad terms** — *curated* in a new `flyer_terms.toml` (e.g. `"fruit"`, `"frozen meals"`, `"cheese"`). Serendipity. **Explicitly non-exhaustive**: each term returns a bounded, *relevance*-ranked page (the API has no "sort by discount"), so this samples the head of each category, not the whole category. Paginate a few pages deep per term for coverage; cost is trivial. `flyer_terms.toml` is **user-curated config** (edit-only-when-directed bucket) — needs a `docs/SCHEMAS.md` entry and a line in `CLAUDE.md`'s curated-config list.

**Matching pipeline (decided).** `match_ingredient_to_kroger_sku` is **resolve-only** and runs the deterministic narrowing per docs/PROJECT.md, with these specifics:
- **Confidence = cache hit OR a defined `preferences.toml [brands]` entry.** The `[brands]` table is **tri-state**: key absent → ambiguous (ask); `[]` → "don't care," cheapest acceptable; non-empty list → ranked preference (list order = rank). Otherwise return narrowed candidates for the LLM to resolve; every resolution caches, so it asks less over time.
- **Scoring, not hard filters** — a missing preferred brand can't empty the candidate set. Dietary is a **best-effort soft score** ("organic" in the name), never a gate (the API exposes no dietary attributes).
- **No substitution.** If nothing is fulfillable via curbside/delivery, return `{ resolved: false, reason: "unavailable" }`; substitution stays with `propose_substitutions` (sole owner of `substitutions.toml`, always confirmed). **PROJECT.md step 4 reconciled accordingly.**
- **Cache revalidation, no TTL.** A cache hit short-circuits search/narrowing but is revalidated with one targeted lookup (current price + curbside/delivery availability) before use; unavailable → re-resolve. The LLM may pass `bypass_cache` when a hit doesn't fit the recipe context.
- **`compare_unit_price` (new tool):** deterministic price-per-unit, dimension-bucketed (never compares `$/fl oz` to `$/lb`); the LLM normalizes only unparseable size strings, never does the math. One core — used internally for the tiebreaker and exposed for the conversational ambiguous-flow.

**Build-time confirmations (not blockers):** the `filter.fulfillment` codes (curbside/delivery) and whether `filter.productId` accepts multiple IDs (would let cache revalidation batch into 1–2 calls).

**Dependencies:** Change 04.

**Deliverables:**
- Kroger Developer `client_credentials` (client ID/secret) configured as Worker secrets
- Kroger API client wrapper: `client_credentials` token caching (in-memory, re-mint on expiry) + `429`/backoff handling, structured errors per the Change 04 convention
- Location resolution: `preferred_location` label → `locationId`, cached
- `kroger_search` internal helper; `kroger_prices`, `kroger_flyer`, `ready_to_eat_available` per docs/TOOLS.md
- `flyer_terms.toml` curated config + `docs/SCHEMAS.md` / `CLAUDE.md` sync
- `match_ingredient_to_kroger_sku`: the 7-step deterministic pipeline per docs/PROJECT.md, **resolve-only** (confident match / narrowed candidates / `unavailable`; tri-state brand confidence; scoring not filtering; `bypass_cache` param; cache revalidation; cache *write* deferred to Change 06)
- `compare_unit_price` tool + its deterministic unit-conversion core (shared by the matcher's tiebreaker and the exposed tool); `flyer_terms.toml` consumed by `kroger_flyer`
- Tests for the matching pipeline (canonicalization, cache lookup + revalidation, scoring, tiebreaker/unit-price, confidence gate, `unavailable` signal) with mocked Kroger responses
- `docs/TOOLS.md` kept in sync (fulfillment-based availability semantics; flyer term-source behavior)

**Done when:** `match_ingredient_to_kroger_sku("extra virgin olive oil")` returns a confident SKU with reasoning, or `ambiguous: true` with candidates — invoked from MCP Inspector against the live public Products API. `kroger_flyer` returns real on-sale items synthesized from the precise + broad term scan.

---

## Change 06: Write tools + atomic commit

**Scope:** Implement the **write** tools from docs/TOOLS.md: `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools, and the headline `write_cart_and_commit` + `commit_changes`. Implement atomic batched commits via GitHub's Git Data API (build a tree, create commit, update ref) instead of sequential file commits.

**This change also lands the write-side Kroger + security bundle (decided — moved here from Change 05's earlier draft so the first write and its gate ship together):**
- **`authorization_code` OAuth (PKCE)** for cart writes: a small auth-callback route in the Worker for the one-time token exchange, plus automatic refresh. Kroger refresh tokens are **single-use/rotating**, so the refresh token lives in a **KV namespace** (one key) — the minimal writable slot, *not* a Durable Object (no coordination / strong-consistency need for a single-user token). This is the one piece of state in an otherwise stateless Worker.
- **SKU cache writes** folded into `write_cart_and_commit`'s atomic batched commit (Change 05's matching pipeline only *resolves* mappings; here they get persisted to `skus/kroger.toml`).
- **Cloudflare Access in front of the Worker** (policy: only Casey's identity) — the gate for leg 2 (Claude.ai → Worker), required the moment write/cart tools exist. **Carve-out:** the OAuth callback path (`/oauth/*`) must bypass Access so Kroger's redirect isn't blocked; protect it with OAuth `state` / PKCE instead. Change 07 then points Claude.ai at the already-secured Worker.

**Dependencies:** Changes 04 and 05.

**Deliverables:**
- Write tools per docs/TOOLS.md
- Atomic batched commit implementation (including the SKU cache append from the matching pipeline)
- Kroger `authorization_code` OAuth + PKCE: one-time callback route, automatic refresh, single-use refresh-token rotation handled correctly
- KV namespace holding the rotating Kroger refresh token (read on cold start; rewritten on each refresh)
- Cloudflare Access in front of the Worker + `/oauth/*` carve-out
- Cart-write integration with Kroger (`PUT /v1/cart/add` subroutine inside `write_cart_and_commit`)
- Validation that updates pass schema checks before commit
- Tests for the atomic-commit path

**Done when:** A single tool call can write a Kroger cart, update multiple recipes, verify pantry items, and create one clean git commit summarizing all of it — with Cloudflare Access protecting the Worker, the OAuth callback reachable for token exchange, and cart writes using a correctly-rotated refresh token.

---

## Change 07: Claude.ai connection + first conversational flow

**Scope:** Connect the deployed Worker to Claude.ai as a custom connector. Add the GitHub MCP connector. Create the "Grocery Agent" project and paste CLAUDE.md into project instructions. Validate basic conversational flows end-to-end: "what's in my pantry?", "show me chicken recipes", "I ran out of olive oil", "rate the salmon thing 4 stars".

**Dependencies:** Changes 04, 05, 06.

**Deliverables:**
- Custom MCP connector configured in Claude.ai account settings
- "Grocery Agent" project created with CLAUDE.md as instructions
- GitHub MCP enabled in the project
- Manual test transcript of basic flows working end-to-end
- Any necessary fixes to CLAUDE.md or tool descriptions discovered through testing

**Done when:** From your phone, you can open Claude.ai, start a fresh conversation in the "Grocery Agent" project, and have a useful conversation about your pantry or recipes without things going off the rails.

**Notes:** This is a milestone change — it proves the architecture works end-to-end. Expect to iterate on CLAUDE.md as you see what Claude does with it.

---

## Change 08: Menu request flow — pantry verification + sequencing

**Scope:** Implement the deterministic menu-request foundation: `verify_pantry_for_recipe`, `verify_pantry_for_candidates`, `suggest_sequencing`, `propose_substitutions` (inventory and sale modes). Update CLAUDE.md to specify the comprehensive pantry confirmation pass and the sequencing/substitution timing rules. Test conversationally: "I want to make salmon and rice tonight" should walk the pantry, surface any questions, and suggest sequencing if relevant.

**Dependencies:** Change 07.

**Deliverables:**
- Tools per docs/TOOLS.md
- Updated CLAUDE.md with menu-request orchestration
- Pantry confirmation pass surfacing have_fresh, have_stale, inventory_substitutes, not_in_pantry
- Sequencing pass via `uses_components` / `produces_components` references
- Inventory-mode substitutions surfaced during pantry pass; sale-mode held until later

**Done when:** A recipe-seeded menu request walks the pantry comprehensively, surfaces drift, suggests sequencing, and produces a clean to-buy list — all without you having to invoke specific commands.

---

## Change 09: Menu generation — full flow with Kroger context + LLM proposal

**Scope:** Wire the full menu-request flow: pre-pass gathering of `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste`. Update CLAUDE.md so Claude assembles all context and reasons about menus including freeform constraints ("comfort food one night"), meal-prep callouts, sale-based substitutions, ready-to-eat opportunity buys.

**Dependencies:** Change 08.

**Deliverables:**
- Updated CLAUDE.md with full menu-generation orchestration
- Conversational test of open-ended ("make me a menu") and recipe-seeded flows
- Cart write at the end of an agreed menu via `write_cart_and_commit`

**Done when:** An end-to-end menu request from a fresh conversation produces a useful menu proposal, you iterate with revisions, you agree, and the Kroger cart populates. The first real cycle works.

---

## Change 10: Discovery + disposition

**Scope:** Implement `fetch_rss_discoveries`, `fetch_flyer_featured`, `import_recipe` (with JSON-LD parsing via `recipe-scraper` or similar), and the draft-state import behavior. Update CLAUDE.md so discovery surfaces 1-2 recipes and 1-2 ready-to-eat items per menu request, always imported in draft state.

**Dependencies:** Change 09.

**Deliverables:**
- `feeds.toml` populated with 5-8 RSS feeds
- Discovery tools per docs/TOOLS.md
- JSON-LD recipe import pipeline
- Draft-state behavior in CLAUDE.md
- Conversational test of disposition: "rate the Serious Eats one 4 stars", "remove that one"

**Done when:** Menu proposals include opportunistic discoveries; you can disposition them in subsequent conversations; the corpus grows over weeks without manual import work.

---

## Change 11: Variety + retrospection

**Scope:** Implement the `retrospective` tool. Add `diet_principles.md` with your variety rules. Update CLAUDE.md so menu generation honors principles softly, explaining tradeoffs when it can't satisfy all of them. Add a conversational pattern for retrospectives.

**Dependencies:** Change 09. (Change 10 helps but isn't strictly required.)

**Deliverables:**
- `retrospective` tool returning structured cooking-history aggregates
- Populated `diet_principles.md`
- Updated CLAUDE.md with variety reasoning patterns
- Conversational test of "how have I been eating this month?" and variety-aware menu requests

**Done when:** Menu proposals show awareness of variety principles without being naggy. Retrospectives surface useful patterns.

---

## Change 12 (Phase 7): Perishability refinement

**Scope:** Populate `ingredients.toml` with shelf-life data. Refine pantry verification thresholds to use explicit data instead of LLM judgment. Add waste-tracking observation in menu generation ("this menu leaves 3/4 of a cilantro bunch unused — want a third recipe that uses it?").

**Dependencies:** Change 09. Change 11 helpful for context.

**Deliverables:**
- Populated `ingredients.toml`
- Updated `verify_pantry_*` tools using `ingredients.toml` thresholds
- Cross-recipe waste callouts in menu generation
- Updated CLAUDE.md

**Done when:** Less produce going bad in the fridge; occasional useful "consider swapping recipe X for Y, less waste" suggestions.

---

## Change 13: Component vocabulary registry

**Scope:** Introduce a canonical component vocabulary so `uses_components` / `produces_components` slugs stay consistent across recipes and over time. `suggest_sequencing` (Change 08) matches these by exact slug, so drift (`fresh-pasta` in one recipe, `pasta-dough` in another) silently breaks sequencing links. Add a source-of-truth registry file, document it in `docs/SCHEMAS.md`, extend validation to flag component references not in the registry, and update CLAUDE.md so the agent consults the registry when wiring components (and may extend it when a genuinely new component appears). **This modifies the `data-validation` capability** (new soft/hard rule for unknown component references).

**Dependencies:** A recipe corpus that actually declares components (the ReciMe import / `import-recime-corpus` change). Best **seeded by** that import's reconciliation pass rather than designed in the abstract — let the corpus reveal which components recur (realistically a small set, e.g. `fresh-pasta` feeding `lasagna-bolognese` / `uovo-in-raviolo`) before codifying the vocabulary. Consumed by Change 08 (`suggest_sequencing`).

**Deliverables:**
- A registry file (e.g. `components.toml`) listing canonical component slugs with descriptions
- `docs/SCHEMAS.md` entry for the registry
- Validation rule in `scripts/build-indexes.mjs`: warn (or fail) when a recipe references a component absent from the registry
- CLAUDE.md guidance: consult the registry when setting `uses_components` / `produces_components`; extend it deliberately, don't coin variants
- Existing corpus reconciled to the canonical vocabulary

**Done when:** Two recipes that should sequence together reliably share the same component slug, and a typo'd or off-vocabulary component reference is caught at build time instead of silently failing to link.

**Notes:** Low urgency — only earns its keep once recipes are actually sharing components. Worth capturing now because the `import-recime-corpus` reconcile pass is the natural place to harvest the initial vocabulary.

---

## Suggested ordering and parallelization

```
01 Repo skeleton
    ↓
02 Index generation + validation Action ──┐
    ↓                                     │
03 Recipe corpus migration                │
    ↓                                     │
04 Worker skeleton + read tools ←─────────┘
    ↓
05 Kroger API + matching pipeline
    ↓
06 Write tools + atomic commit
    ↓
07 Claude.ai connection + smoke test  ← milestone: agent live
    ↓
08 Pantry verification + sequencing
    ↓
09 Full menu generation flow  ← milestone: real cycles working
    ↓
10 Discovery + disposition
    ↓
11 Variety + retrospection
    ↓
12 Perishability refinement
```

**Parallelization options:**
- 02 and 03 can run in parallel after 01.
- 10 and 11 can run in parallel after 09.

**Natural pause points** (where you'd want to actually use the system for a few weeks before continuing):
- After 07: confirm the architecture works end-to-end with simple flows
- After 09: confirm the full menu-request flow actually saves you time
- After 10: confirm discovery surfaces useful things at the rate you want

These pauses are important. Each phase produces something you can use; iterate based on real experience before committing to the next layer.

---

## What's NOT in this sequence

- A separate "release branch" for processed data (decided against)
- A CLI tool (decided against)
- iMessage, OpenClaw, Lobster, Dispatch, Cowork integrations (decided against)
- Background or scheduled triggers (event-driven only)
- Photo-based pantry check-ins (deferred as optional; could become Change 13+)
- Pages site for recipe search (deferred; the indexes already enable it when you want to add)
- Recipe scaling for solo cooking (lunch_strategy: leftovers handles it for v1)
- Multiple grocers beyond Kroger (the `skus/` directory leaves room but only Kroger has API access)

Add to the sequence later as the system actually proves useful and reveals what's missing.
