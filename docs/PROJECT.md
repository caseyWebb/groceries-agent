# Grocery Agent — Project Proposal

## TL;DR

A personal food assistant: picks recipes conversationally, generates menus, populates a Kroger cart, tracks pantry inventory, and learns over time. Fully event-driven — responds to messages, doesn't impose a schedule. Lives in Claude.ai chat (web + mobile). Built as three components: a GitHub repo holding all the data and the agent's instructions, a Cloudflare Worker hosting a custom MCP server for domain operations, and Claude.ai with account-level MCP connectors handling the conversational surface.

No iMessage bridge, no agent framework, no scheduler, no separate database, no CLI. The data lives in flat files (TOML + markdown) in git. Everything else is glue.

## Goals

- Replace the "pick recipes + write grocery list + add to cart" workflow, which currently takes meaningful time and willpower.
- Support two starting points for menu requests: open-ended ("make me a menu") and recipe-seeded ("I want to make salmon and rice tonight"). Both feed the same grocery flow.
- Trigger grocery runs on demand rather than on a fixed schedule, since Kroger delivery/pickup doesn't impose weekly cadence.
- Recipe selection is conversational: agent proposes, I push back, we converge.
- Account for what I have (freezer, pantry), what's in season, what's on sale, what I haven't cooked recently, and what fits my evolving taste.
- Surface breakfast/snack restocking, where I'm weakest about planning.
- Populate the Kroger cart automatically; I check out manually.
- Iterate the recipe corpus over time via RSS-driven discovery from blogs I trust.
- Iterate ready-to-eat options via Kroger flyer / featured items, the same way recipes iterate.
- Preserve the natural conversational UX: "I ran out of milk" should just work without explicit commands.
- Each meal-planning session is a fresh conversation; system state lives in the repo, not in conversation history.

## Architecture

The system is **multi-tenant**: one self-hosted Worker serves a small friend group, each member connecting their own Claude.ai (see the `multi-tenant-friend-group` change and `docs/SELF_HOSTING.md`). The **code** is a separate upstream repo self-hosters deploy without forking; **all the data** lives in **one operator-owned private repo** with a shared root + one `users/<username>/` subtree per member.

```
┌────────────────────────────────────────────────────────┐
│  Each member: Phone / Web (their own Claude.ai)        │
│    • grocery-agent plugin: skills + grocery-mcp conn.  │
│      installed from the marketplace — nothing pasted   │
│  Connects once via an operator-issued INVITE CODE.     │
└─────────────────────┬──────────────────────────────────┘
                      │ MCP over HTTPS (OAuth 2.1 bearer)
                      ▼
┌────────────────────────────────────────────────────────┐
│  Cloudflare Worker — OAuth 2.1 provider + grocery-mcp  │
│                                                        │
│  - OAuth provider (KV): validates token → grant props  │
│    → tenantId; resolveTenant → per-tenant MCP server   │
│  - Domain tools (coarse, opinionated, deterministic)   │
│  - Kroger client (shared reads; per-tenant cart token) │
│  - GitHub App installation token (no PAT) for repo I/O │
└─────────────────────┬──────────────────────────────────┘
                      │ GitHub App token + Kroger API
                      ▼
┌────────────────────────────────────────────────────────┐
│  ONE private GitHub data repo (operator-owned)         │
│   shared root (read by all):                           │
│    - recipes/*.md      (objective content only)        │
│    - aliases/ingredients/substitutions.toml            │
│    - skus/kroger.toml  (location-tagged, shared cache) │
│    - flyer_terms.toml, _indexes/                       │
│   users/<username>/ (one subtree per member):          │
│    - pantry/preferences/stockup/grocery_list/...       │
│    - overlay.toml (rating+status)  notes/<slug>.toml   │
│    - cooking_log/meal_plan/feeds, personal recipes     │
└────────────────────────────────────────────────────────┘

(The CODE repo — Worker src/, scripts/, docs/, CI — is a
 separate upstream; self-hosters deploy it, never fork it.)
```

The split: Claude.ai handles messaging and reasoning. The Worker provides the domain interface — coarse, opinionated tools that internally enforce deterministic pipelines — and is the multi-tenant gate (OAuth provider; each request resolves token → tenant before any tool runs, so no tool can reach another member's data). GitHub is the data substrate; git history is the audit log. Everything human-edited stays inspectable as flat files.

**Why this split:** the Worker's tools encode the deterministic pipelines we want enforced (Kroger product matching, pantry verification, substitution rule application, etc.). The LLM does only the genuinely-fuzzy work: classifying the user's request, reasoning over assembled context to propose menus, handling freeform constraints like "comfort food one night." The deterministic-where-appropriate philosophy is preserved at the MCP tool boundary.

**Multi-tenant identity (D1–D4).** Claude.ai connectors authenticate via OAuth, so the Worker hosts an OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`, KV-backed — no SQL). Identity is an **operator-issued invite code** against a curated allowlist (members need no GitHub account); the issued access token's grant carries the member's `tenantId`. "Which tenant" is a `users/<username>/` path prefix in the single data repo, addressed by wrapping the GitHub client (`prefixedClient`). Repo access uses a short-lived **GitHub App installation token**, never a PAT. Kroger `client_credentials` reads are shared app-level; cart writes use a **per-tenant** `authorization_code` refresh token (`kroger:refresh:<tenant>`).

**Three-category recipe data (D5/D6).** A recipe's *content* (objective frontmatter + body) is shared and single-source; its *overlay* (`rating` + `status`) is per-tenant in `overlay.toml`; its *notes* are per-tenant, attributed, append-mostly. `last_cooked` is derived per-tenant from `cooking_log.toml`. Reads merge shared content + the caller's overlay + cooking-log `last_cooked`. **Notes are the spin-capture mechanism** that makes a shared corpus safe: a tweak ("sub gochujang") is an attributed note, never an edit to shared content; only a genuine "different dish" warrants a personal-recipe fork. Group notes/ratings aggregate across members at read time (`read_recipe_notes`).

## Repository structure

**Two repos** (the code/data split, D2a). The **code** repo is the deployable upstream (this repo); **all the data** lives in one operator-owned **private data repo**. A self-hoster deploys the code (clone + secrets + `wrangler deploy`) and creates a data repo from a template — they never fork the code.

### Code repo (this repo — deployable upstream)

```
grocery-agent/                   ← repo root IS the Cloudflare Worker
├── README.md
├── AGENT_INSTRUCTIONS.md        ← grocery-agent instructions (canonical; built into the plugin)
├── CLAUDE.md                    ← Claude Code repo-development guide
├── src/                         ← Worker source (MCP server, OAuth provider, tools)
├── test/                        ← Worker unit tests (vitest)
├── wrangler.jsonc               ← Worker config TEMPLATE (operators copy + customize in their data repo)
├── scripts/                     ← build-indexes.mjs, build-site.mjs, site-assets/
├── docs/                        ← PROJECT / SCHEMAS / TOOLS / SELF_HOSTING / MIGRATION
│   └── data-template/           ← submodule: full data-repo template (caller workflows + layout) for reference
├── openspec/                    ← change/spec workflow
└── .github/workflows/
    ├── ci.yml                   ← push/PR: typecheck + both test suites. NO secrets, NO deploy.
    ├── data-deploy.yml          ← REUSABLE (workflow_call): a data repo's caller deploys the Worker
    ├── data-onboard.yml         ← REUSABLE: mint a member's invite code + allowlist entry (KV)
    ├── data-revoke.yml          ← REUSABLE: remove a member's allowlist entry + invite code
    ├── data-build-indexes.yml   ← REUSABLE: a data repo's caller builds its indexes
    └── data-build-site.yml      ← REUSABLE: a data repo's caller builds its public site
```

Operator workflows (deploy/onboard/revoke/build) run from each operator's **private data repo** as thin callers of these reusable workflows — so the public code repo holds **no Actions secrets** and isn't forked. See `docs/SELF_HOSTING.md`.

### Data repo (operator-owned, private — created from the template)

```
groceries-agent-data/            ← one private repo for the whole group
├── recipes/                     ← SHARED objective content (no per-tenant fields)
│   ├── lemon-garlic-chicken.md
│   └── ...
├── aliases.toml                 ← SHARED ingredient variants → canonical
├── substitutions.toml           ← SHARED default rules (per-tenant override layer below)
├── skus/kroger.toml             ← SHARED, location-tagged SKU cache
├── flyer_terms.toml             ← SHARED broad scan terms
├── storage_guidance/            ← SHARED curated put-away advice (class-keyed prose; read-only)
├── feeds.toml                   ← SHARED RSS discovery feeds (group-wide pool)
├── discoveries_inbox.toml       ← SHARED forwarded-newsletter candidates (email() writes; read_discovery_inbox reads)
├── discovery_sources.toml       ← SHARED inbound-email allowlist (members + senders)
├── _indexes/                    ← generated by the data repo's CI (objective fields only)
│   └── recipes.json
└── users/                       ← one subtree per member (the tenant prefix)
    └── <username>/
        ├── pantry.toml  preferences.toml  stockup.toml
        ├── ready_to_eat.toml     ← per-tenant heat-and-eat catalog (slug-keyed, meal-tagged)
        ├── grocery_list.toml  meal_plan.toml  cooking_log.toml
        ├── taste.md  diet_principles.md
        ├── overlay.toml          ← per-tenant rating + status, keyed by slug
        ├── substitutions.toml    ← OPTIONAL per-tenant override layer
        ├── notes/<slug>.toml     ← attributed notes (the spin-capture store)
        └── recipes/              ← OPTIONAL personal (unshared) recipes
```

A **solo operator** is simply the degenerate case: one `users/<id>/` subtree.

**On file formats:** structured/config-style files use TOML for consistency, human-readability, and to escape YAML's quirks. Prose-heavy files (recipes, taste, diet_principles, AGENT_INSTRUCTIONS.md, CLAUDE.md) stay markdown — they're read during cooking and reflection and narrative matters. Recipe frontmatter stays YAML since Obsidian renders it natively as Properties.

**On the `skus/` directory:** scoped to one file (`kroger.toml`) for v1. The directory leaves room for future per-grocer files if other retailers add first-class agent support.

### Recipe frontmatter schema (draft)

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken
cuisine: mediterranean
style: sheet-pan
time_total: 50
time_active: 15
servings: 4
difficulty: easy
dietary: [gluten-free, dairy-free]
season: [spring, summer]
veg_forward: false
# last_cooked / rating / status are NOT shared content (D5) — see the note below:
#   rating + status → per-tenant users/<id>/overlay.toml
#   last_cooked     → derived from each member's cooking_log.toml
discovered_at: 2025-01-12       # only set for items discovered via RSS
discovery_source: serious-eats  # only set for items discovered via RSS
ingredients_key: [chicken thighs, lemon, garlic, oregano, potatoes]
meal_preppable: true            # good freezer / batch-cook candidate
source: https://www.seriouseats.com/...
---

[recipe body in markdown]
```

**On `status`/`rating`/`last_cooked` (per-tenant, D5):** these three are subjective and are NOT stored in shared recipe content. `rating` + `status` live in each member's `users/<id>/overlay.toml` (keyed by slug); `last_cooked` is derived from each member's `cooking_log.toml`. The shared `_indexes/recipes.json` carries objective fields only; read tools merge the caller's overlay + cooking-log `last_cooked` at read time, defaulting effective `status` to `draft` when a member has no overlay row. `status` lifecycle is unchanged but now **per-tenant**: `active` (candidate set), `draft` (surfaced, not dispositioned), `rejected` (explicit no, kept for de-dup), `archived` (old) — one member's disposition never changes another's.

**On `meal_preppable`:** a single boolean for v1. Refinable later into richer fields (`fridge_days`, `freezer_friendly`, `scales_well`) if needed.

## Menu request flow

Triggered by any message that resolves to a menu / grocery-run intent. Two starting points:

- **Open-ended:** "I'm running low, make me a menu" / "let's do groceries"
- **Recipe-seeded:** "I want to make salmon and rice tonight" / "let's do corn risotto this week"

Both follow the same shape: pantry verification first, then menu generation/elaboration, then cart build. No scheduled trigger.

1. **Inbound trigger:** I message Claude. Project instructions guide Claude to invoke the right tool sequence.

2. **Pantry confirmation pass:** Claude calls a tool like `verify_pantry_for_recipe(slug)` or `verify_pantry_for_candidates()`. The Worker parses the recipe ingredients and walks them against the pantry, returning **facts, not freshness verdicts**: `in_pantry` (exact matches, each with age metadata — `added_at`, `last_verified_at`, `days_since_verified`, `category`, `prepared_from`), `possible_matches` (fuzzy candidates for Claude to confirm), `not_in_pantry` (to-buy), `optional` (non-blocking), and `inventory_substitutes_available`.
   - For staples (rice, salt, common spices), the tool lists them in `in_pantry` explicitly — drift catcher in case I forgot to mention I ran out. (This relies on the pantry file staying complete on staples; there is no assumed-present staple list.)
   - There is **no `have_stale` bucket.** The tool surfaces age metadata; Claude decides which items warrant a "still good?" prompt (freshness depends on storage, not age alone, and isn't in the repo). Freshness stays LLM-judged — there is no shelf-life table backing it: the once-reserved `ingredients.toml` was cut in favor of the curated `storage_guidance/` tree, which informs put-away advice rather than gating staleness.
   - For items where `substitutions.toml` allows an inventory swap, included in `inventory_substitutes_available` (empty until rules are seeded).
   - Sale-based substitutions are NOT surfaced here — they wait until Kroger flyer is fetched.

3. **Pantry check-in (conversational):** If anything was flagged — a freshness prompt, a `possible_matches` candidate to confirm, or a missing `optional` ingredient to ask about — Claude raises it in chat. On my response, Claude calls `mark_pantry_verified(items)` to reset timestamps.

4. **Main pre-pass:** Claude calls several tools in parallel:
   - `kroger_flyer()` — this week's sales
   - `kroger_prices(ingredients)` — prices for the to-buy list
   - `ready_to_eat_available()` — current Kroger availability for my catalogs
   - `fetch_rss_discoveries()` — new recipe candidates from feeds (ready-to-eat candidates ride the `kroger_flyer` scan)
   - `read_preferences()` — defaults like cooking nights, lunch strategy
   - `read_taste()` — my taste profile narrative

5. **Menu generation (Claude reasons):** With assembled context plus my message (which may include freeform constraints — "comfort food one night," "I'm feeling lazy," "something Italian"), Claude proposes a plan:
   - Dinner plan sized to my cooking frequency (defaults from `preferences.toml` unless I specified), mix of recipes + ready-to-eat dinners + acknowledgment of eating-out nights, honoring freeform constraints.
   - Recipe combinations preferred to share perishables (soft preference).
   - Meal-prep callouts on `meal_preppable: true` recipes.
   - Sale-based substitution callouts (now that flyer is available).
   - Ready-to-eat opportunity buys (draft state).
   - Restocking list for staples.
   - Stockup alerts for bulk-buy candidates on sale.
   - 1–2 recipe discoveries (draft state).
   - 1–2 ready-to-eat discoveries (draft state).

6. **Proposal:** Claude sends the proposal in chat. Substitution callouts and opportunity buys are presented as choices alongside the menu.

7. **Conversation:** I reply with revisions. Claude iterates — re-running affected tool calls.

8. **Capture (commit intent):** Once agreed, Claude calls `commit_changes` — one git commit via GitHub's Git Data API that persists the *intent* of the session, never the cart:
   - Append agreed recipes to `meal_plan.toml` (committed cook intent)
   - Append the to-buy list to `grocery_list.toml` (committed buy intent, SKU-free)
   - Mark pantry items verified
   - Import draft recipes from RSS hits; add draft ready-to-eat items
   - Single commit summarizing the session

9. **Flush, when I'm ready — two forms, picked by fulfillment mode.** Capture is store-agnostic (the list is SKU-free); the flush is not. `preferences.toml [stores].primary` selects it (and naming a store for one trip overrides it):
   - **Kroger online** (`primary: kroger`) — `place_order` resolves the whole `grocery_list.toml` against current Kroger availability, surfaces ambiguous/unavailable items as one batch, writes the Kroger cart, and appends learned `skus/kroger.toml` mappings. The repo is the mutable store (capture continuously); the cart is append-only (flush once). Final message: "Review the cart in the Kroger app before checking out — items can't be removed via the API."
   - **In-store walk** (`primary` is a store slug) — the `store-walk` skill reads the same list and orders it by a store's aisles (the shared `stores/` registry), filtered to the store's `domain`, walked hands-free one aisle at a time. It needs **no** cart and degrades gracefully: with no layout it still yields a department-grouped list from world knowledge; an aisle map upgrades it to aisle-by-aisle; sparse `item_locations` pinpoint the tricky items. On completion it advances picked `grocery`-kind items straight `active → received` — the **same** restock-the-pantry + storage-tips behavior as a Kroger pickup, no `in_cart`/`ordered` stage.

   **The `stores/` shared region** (in-store-fulfillment): one `stores/<slug>.toml` per store *location* (shared like recipes — mapping a store once helps the whole group), holding an objective aisle layout plus two sparse, lazily-grown facets (`item_locations`, `doesnt_carry`); attributed per-tenant store notes live at `users/<id>/store_notes/<slug>.toml` (the recipe-notes pattern). Each grocery-list item carries a `domain` facet (default `grocery`) so a non-grocery run (Lowe's, Target) generalizes for free later — the schema is built now, the non-grocery skill surface is not.

**Empty-list behavior:** If a request resolves to "you don't really need much" — pantry covers the named recipes, or an open-ended request finds the pantry adequate — Claude says so explicitly and captures nothing to buy. Other commits (pantry verifications, the meal plan) still happen.

## Implementation philosophy

### LLM seams

Three places where the LLM earns its keep:

1. **Message understanding and tool orchestration.** Claude reads my message, decides which tools to call in what order, asks follow-up questions when needed, interprets freeform constraints. This is Claude's native strength; no custom routing logic.

2. **Menu generation reasoning.** Given assembled context (pantry, flyer, candidates, ready-to-eat, preferences, freeform constraints), Claude proposes a plan honoring multiple soft and hard rules. This is the genuinely-fuzzy step that needs LLM judgment.

3. **Fuzzy matching fallback** inside the Worker's Kroger product matching pipeline, only when deterministic narrowing leaves ambiguity. Also used for taste-profile scoring on new RSS discoveries.

Everything else — file I/O, frontmatter parsing, recipe filtering, scoring, Kroger API calls, RSS reading, JSON-LD parsing, cart writes, git commits — is plain deterministic code inside the Worker. No LLM in the loop.

### MCP tool design

**The Worker's tools are the locus of determinism control.** Coarse, opinionated tools encode the deterministic pipelines we want enforced. Raw building blocks would let Claude bypass these — they're explicitly NOT exposed.

```
GOOD tools (deterministic pipelines enforced internally):
  match_ingredient_to_kroger_sku(ingredient, recipe_context)
    → runs full 7-step matching pipeline
  verify_pantry_for_recipe(slug)
    → full pantry confirmation walk, structured JSON output
  propose_substitutions(ingredient, mode: "inventory" | "sale")
    → applies substitutions.toml rules deterministically
  commit_changes(payload)
    → atomic batched git commit (repo memory; never the cart)
  place_order(payload)
    → resolve grocery_list against current availability + Kroger cart write

NOT exposed (would let Claude bypass determinism):
  kroger_raw_search(query)        ← would skip cache + filtering
  github_raw_write(path, content) ← would skip validation
  cart_add_by_name(name)          ← would let Claude guess SKUs
```

The GitHub MCP connector (Anthropic-supported) sits alongside as a fallback for ad-hoc operations not covered by the curated grocery-mcp tools — searching recipes by content, inspecting individual files, one-off reads.

### Kroger product matching (ingredient → SKU)

The hardest deterministic problem in the system: turning recipe ingredient strings ("extra virgin olive oil, 1 tbsp") into specific Kroger SKUs. Implemented inside the `match_ingredient_to_kroger_sku` tool. Pattern: **progressive deterministic narrowing, with LLM fallback only when ambiguity remains.**

```
Input: "extra virgin olive oil, 1 tbsp"

1. Normalize (deterministic)
   strip quantity/units, lowercase, apply aliases.toml.
   Alias-driven — NOT an aggressive qualifier-stripper. aliases.toml is the
   curated source of truth for which variants collapse to which canonical term.

2. Cache lookup → revalidate (deterministic)
   if normalized term → SKU exists in skus/kroger.toml, take that SKU and
   revalidate it with ONE targeted lookup (current price + curbside/delivery
   availability at the preferred location).
   - available → use it, with FRESH price/promo
   - unavailable → treat as a miss, fall through to search (self-healing)
   The cache short-circuits the EXPENSIVE search/narrowing, not the price check.
   No TTL needed — every hit is revalidated. The LLM may pass `bypass_cache` to
   force re-resolution when a hit doesn't fit the recipe context (cached generic,
   recipe wants organic).

3. Kroger search (deterministic API call)
   filter.term + filter.locationId (+ curbside/delivery fulfillment)
   → candidate products with price {regular, promo}, size, brand

4. Score candidates (deterministic, rule-driven — SCORING, not hard filters)
   - brand preference from preferences.toml [brands] (tri-state — see below)
   - dietary: best-effort soft score (e.g. "organic" in the name); never a gate
   TWO near-hard constraints govern WHICH PRODUCT (vs. the soft brand/dietary
   PREFERENCES, which govern which brand/size among matches):
   - availability: must be fulfillable via curbside or delivery at the location
   - identity relevance: # of query tokens in the product description/categories.
     A CONFIDENT pick may only come from the top relevance tier — so "anaheim
     peppers" resolves to the Fresh Anaheim Peppers PLU, never to a cheaper
     unrelated fulfillable item (refried beans) that happens to be in the search
     results. If nothing in the pool shares any query token (max relevance 0),
     the matcher returns ambiguous rather than confidently guessing.
   Scoring (not filtering) means a missing preferred brand can't empty the set —
   it just leaves nothing scoring on the brand axis. (That softness is for
   PREFERENCES; identity relevance is near-hard, like availability.)
   This step does NOT substitute. If nothing is available, return
   { resolved: false, reason: "unavailable" }. Substitution is a SEPARATE,
   confirmed step via propose_substitutions — the sole owner of substitutions.toml.

5. Deterministic tiebreaker (within the top-scoring set)
   - prefer on-sale (promo > 0) over regular
   - prefer best price-per-unit (via the unit-price calculator — deterministic
     arithmetic; the LLM normalizes messy size strings, never does the math)
   - "don't care" commodities ([] brand pref): smallest package covering the
     quantity hint, then cheapest absolute

6. Confidence gate (deterministic) → LLM only when ambiguous
   CONFIDENT (auto-pick): a cache hit, OR a defined brand preference resolves it
     — including [] meaning "don't care, cheapest acceptable".
   AMBIGUOUS: no cache hit AND no defined brand preference → return narrowed
     candidates + "ambiguous, please choose". Claude presents the options, picks
     from context OR asks me (and may record a standing "don't care" as []).
   Either way the resolution is recorded, so next time is a confident cache hit.

7. Cache result (persisted at order time)
   Append the resolved mapping to skus/kroger.toml. The matcher itself only
   RESOLVES and returns; the cache write rides place_order's cart flush.
```

Expected behavior: after 4–6 weeks of normal use, most common ingredients are cached and never hit the LLM. The cache is committed to git, reviewable as a list.

**Confidence is legible and self-extinguishing.** It comes entirely from `preferences.toml` `[brands]`, which is **tri-state**: key absent → ask; `[]` → "don't care," pick cheapest acceptable; `["A","B"]` → ranked preference (list order is rank). So "when will it ask me?" is predictable from the config, and every answered question caches — it asks less over time. See docs/SCHEMAS.md.

**Quantity translation is intentionally coarse.** "3 cloves garlic" → buy a bulb. "1.5 lb chicken thighs" → round up to whatever package Kroger sells. Grocery shopping operates at coarser granularity than recipes; pantry tracking absorbs the slack.

### Discovery and disposition

Every menu request surfaces a small number of new items I haven't expressed a position on:

- **New recipes** (1–2 per menu request, from RSS feeds + taste-profile scoring)
- **New ready-to-eat options** (1–2 per menu request, from Kroger flyer features or trending items in categories I accept)

These get persisted in `draft` state immediately, not gated on me expressing interest during the conversation. The reasoning: I often won't have an opinion at proposal time, but might later say "actually, I want to make that Serious Eats one" or "that charcuterie board was good, add it to my regulars."

**Draft-state mechanics:**

- New recipes imported into `recipes/` with `status: draft`, `discovered_at`, and `discovery_source`. They appear in the corpus but don't compete for menu placement unless I explicitly ask.
- New ready-to-eat options added to relevant `ready_to_eat/*.toml` with `status: draft`. Not recommended unprompted again until dispositioned.

**Disposition via conversation:**

- *"Rate the Serious Eats one 4 stars"* / *"I liked that charcuterie board"* → `status: active`, rating recorded.
- *"Remove that recipe"* / *"No on the charcuterie"* → `status: rejected`.
- Silence → stays in draft.

**Auto-archive:** items in draft state past ~6 months get moved to `archived`. Avoids corpus bloat from items I never engaged with. (Open Question: exact threshold, automatic vs. prompted.)

### Indexes and validation

A GitHub Action regenerates derived data on every push to `recipes/**`:

- `_indexes/recipes.json` — all recipe frontmatter aggregated as one JSON document, slug-keyed.

Ready-to-eat is **per-tenant** (`users/<username>/ready_to_eat.toml`) — a facet of the personal profile, not shared corpus — so it has **no** aggregate index; the Worker reads each member's catalog directly. The build still structurally validates any `ready_to_eat.toml` it finds (meal/status enums, required name+slug, slug uniqueness, integer rating).

The Worker reads `_indexes/recipes.json` once per filtering operation (one API call) instead of fetching every recipe file. For ~200 recipes, this drops filtering from ~200 sequential reads to one read of maybe 200KB of JSON. Cloudflare KV can cache it for short TTL if needed; usually not.

The same Action also runs **validation**:

- Every TOML file parses cleanly.
- Every recipe frontmatter is well-formed.
- `pairs_with` references resolve to existing recipes.
- `status` values are one of the allowed enum.
- `substitutions.toml` rules are well-formed.

Validation failures fail the Action (red CI), which alerts me but doesn't block reads — the Worker keeps reading whatever's at HEAD. The point is fast feedback, not gating.

**Local pre-commit hook** runs the same validations on `git commit`, catching issues before they reach GitHub.

**A useful side effect:** the indexes are public-ish artifacts that any other tool can consume. If I later want a static GitHub Pages site for recipe search, it reads `_indexes/recipes.json` and does client-side filtering with Fuse.js or similar. No backend needed.

## Behavior rules

**Cart writes outside menu generation are rare and explicitly confirmed.** "I'm out of bread" → suggest noting it for the next menu request rather than firing a cart write immediately, unless I explicitly say to add now.

**Kroger API write-only limitation:** the Kroger Cart API can add but cannot remove or check out. When reconciliation happens after the cart is already written (farmers market scenario, last-minute substitutions), the agent reports what *would have been* removed and explicitly tells me to remove those items manually in the Kroger app. Never silently pretends items are gone.

**User-curated configuration files** (`taste.md`, `diet_principles.md`, `preferences.toml`, `substitutions.toml`, `aliases.toml`): the agent has tool capability to edit these, but only does so when I explicitly direct it ("add a note to my taste profile that I don't like cilantro"). It does NOT proactively edit them based on inferred patterns.

**Recency-weighted pantry items:** items recently added (within ~5 days) get higher priority in menu generation than long-stored ones. Fresh market purchases get used soon. Complements the staleness checks — recency is the carrot, staleness is the stick.

**Inventory drift / pantry verification:** the system can't see my fridge — pantry data only stays accurate if the agent asks. Every menu request begins with a comprehensive pantry confirmation pass that lists relevant items including staples and spices — drift catcher in case I forgot to text that I ran out.

Two categories surface as questions:
- **Spoilage candidates:** short-perishables past their typical fresh-life since `last_verified_at`. Framed as verification: "Basil added 9 days ago — still good?"
- **Freezer aging nudges:** long-shelf-life items past a "should use soon" threshold (raw meat older than 3 months, prepared food past its window). Framed as use-it-up, not a delete prompt.

If nothing's flagged, the check-in is skipped. Thresholds use rough LLM judgment — freshness stays a conversational, LLM-judged concern (the once-planned `ingredients.toml` shelf-life table was cut; see the storage-guidance work below).

**On portion-level tracking:** the agent does NOT track precise portion counts of prepared/leftover food. That's a whiteboard problem — too high-friction to maintain. The `prepared_from` field on a pantry item tells the agent "you have some cooked rice from Monday's salmon recipe," not "you have 1.5 cups." If I want to use it, I just say so.

**Freeform query constraints:** menu request messages can include any natural-language constraints — "comfort food one night," "I'm feeling lazy," "something Italian," "date night Thursday." These flow into Claude's reasoning directly. No new architecture, just acknowledgment that these patterns work.

**Discovery and disposition timing:** every menu request surfaces 1–2 new recipes and 1–2 new ready-to-eat options. These persist in draft state immediately, not gated on me expressing interest. I disposition them later. Drafts are de-prioritized in subsequent menu generations but remain available if I explicitly surface them.

**Substitution timing split:** inventory-based substitutions surface during the pantry pass (data available). Sale-based substitutions surface alongside the menu proposal (Kroger flyer in hand). Never auto-substitute without my confirmation.

**Cross-recipe perishable optimization** is a soft preference in menu generation, not a hard rule. The agent suggests waste-minimizing combinations but doesn't force them.

## Instruction files and harness roles

The agent's behavior rules and orchestration guidance live in `AGENT_INSTRUCTIONS.md` at the repo root — the canonical source for how the *agent* behaves. A separate `CLAUDE.md` at the root holds Claude Code development guidance for working *on* the repo. They are deliberately split (the agent runs in Claude.ai, not Claude Code), so the agent persona is not auto-loaded into a development session and vice versa.

**Two surfaces, two files:**

1. **Claude.ai (the agent).** `AGENT_INSTRUCTIONS.md` is the canonical source from which the **grocery-agent plugin** is generated (`scripts/build-plugin.mjs`). The persona ships as small **library skills** (`grocery-core`, plus `grocery-cart`/`grocery-corpus` depth); each `### ` flow becomes a workflow skill prefixed with a prerequisite line that loads `grocery-core` (and the depth it `needs`) **once per session** — so a sequential chain (`meal-plan → cook → cooked → add-recipe-feedback`) doesn't re-load the shared rules on every link, and a light flow like `grocery-sale-check` carries only core. The `grocery-mcp` connector is bundled, its URL baked into `.mcp.json` at build time (`--mcp-url`; claude.ai doesn't honor a `userConfig` variable). The version is auto-incrementing `0.1.<commit-count>` (git-derived in `build-plugin.mjs`) — claude.ai only pulls a strictly-greater semver, so a versionless bundle sits stale. Members install from the marketplace — nothing pasted; updates propagate via `/plugin marketplace update`. Edit `AGENT_INSTRUCTIONS.md`, rebuild, push. Self-hosters get their own baked bundle without forking via the reusable `data-build-plugin` workflow (build → download → upload to claude.ai), or fork for an auto-updating marketplace; see [SELF_HOSTING](SELF_HOSTING.md) step 8.

2. **Claude Code (development).** Run `claude` in the repo directory. Claude Code reads `CLAUDE.md` natively as repo-development context; it does **not** auto-load `AGENT_INSTRUCTIONS.md` (intentional — that's the plugin build source, not dev context). `CLAUDE.md` points to `AGENT_INSTRUCTIONS.md` for anyone who needs the agent persona.

The Worker, data files, and indexes are the same regardless of surface. What differs is which instruction file each surface consumes: the agent persona on Claude.ai, the dev guide in Claude Code.

## Tech stack

- **Claude.ai** (web + mobile) — conversational surface, subscription auth, fresh-context conversations
- **Claude.ai Project "Grocery Agent"** — holds project instructions (synced from AGENT_INSTRUCTIONS.md)
- **Account-level MCP connectors:**
  - GitHub MCP (Anthropic-supported, general repo access)
  - grocery-mcp (custom, domain-specific)
- **Cloudflare Workers** — TypeScript runtime hosting the custom MCP server. Free tier handles personal-scale load.
- **TypeScript** for the Worker and the index-build script — natural fit for the MCP SDK, JSON throughout, GitHub Actions, etc.
- **GitHub** — code, data, indexes, CI/CD via Actions
- **Wrangler** — Cloudflare's CLI for Worker deployment
- **Kroger Developer API** — product search, cart writes (write-only — can't remove or check out)
- **Recipe import parsing** — JSON-LD via `HTMLRewriter` (workerd) with a pure normalizer; RSS/Atom via `fast-xml-parser`. No `recipe-scraper`/`cheerio` (they assume Node internals unavailable on `workerd`).
- **TOML and YAML parsers** (npm `smol-toml`, `js-yaml` — both pure-JS, run on `workerd`) — for data files
- **Obsidian** (or similar) — mobile recipe viewing during cooking, pointed at a local clone of the repo

## Risks and maintenance

- **Cloudflare Workers free tier limits.** Probably never hit at personal scale. If hit, $5/mo paid tier is generous.
- **Kroger API changes / rate limits.** Personal-use volume is low; risk is low. Watch for breaking changes in cart-write semantics.
- **Recipe importer fragility for sites that change markup.** Mitigation: track per-site failure rates; fall back to manual import when needed.
- **GitHub API rate limits.** 5000/hr authenticated. Personal use stays comfortably under, even with chatty flows.
- **My own engagement.** Most personal automation fails because the author loses interest before it's useful. Phasing helps: each phase ends with something concretely valuable on its own.
- **AGENT_INSTRUCTIONS.md drift between repo and Claude.ai project instructions.** Manual sync risk. Could automate with a script that pushes via the Claude API in the future, but not v1.
- **MCP-protocol churn.** MCP is young; the spec is evolving. Watch for breaking changes. The Worker is small enough that adapting is cheap.

## Security posture

- **The repo is public** (decided during Change 04 exploration). The data is low-sensitivity personal info (recipes, pantry, taste, preferences), and a public repo collapses the auth story: an authless read-only Worker leaks nothing that isn't already public, so the security boundary moves cleanly to the *write* + Kroger path. Accepted cost: eating habits, grocery cadence, and `preferences.toml`'s `preferred_location` (≈ rough geography) are public.
- **Secrets never touch the repo.** Because it's public, this discipline is load-bearing: the GitHub token and Kroger OAuth tokens live as Worker secrets only (encrypted at rest, never logged, covered by `.gitignore`).
- Single user; no auth surface to maintain on the Worker beyond the MCP connection.
- **Worker auth is staged:** authless through Change 04 (tested via MCP Inspector); OAuth added at Change 07, where it becomes mandatory because Claude.ai's custom-connector UI requires it (no "no auth" / bearer-token option). Post-public-repo, that OAuth protects the *write/cart* surface, not read data.
- The Worker reads the repo via an authenticated GitHub client (5,000 req/hr) — a token is needed for writes regardless of visibility, so reads reuse it.
- Cart writes are write-only via Kroger API. The agent literally cannot read my cart or check out for me — useful safety property.
- No home network exposure. The Mac Mini is unused for this; passive consumer of the data via Obsidian if I want it.

## What this is — and what it isn't

This is a personal automation experiment targeting a real friction point in my life — the time and willpower spent on grocery planning — with a system tuned to my tastes, my freezer, and my preferred grocer. Not a product. Not a startup. Not optimized for anyone else's workflow.

The architecture is intentionally minimal. Anthropic provides messaging and reasoning (Claude.ai). The Worker provides a domain interface (curated MCP tools). GitHub provides storage and audit history. The AGENT_INSTRUCTIONS.md file is the canonical agent guidance, pasted into the Claude.ai project. The data files are inspectable by humans, version-controlled, and outlive the agent if I ever stop using it.

It will fail in some ways and succeed in others. Realistic odds of either becoming load-bearing or getting abandoned in three months. Both outcomes are fine.
