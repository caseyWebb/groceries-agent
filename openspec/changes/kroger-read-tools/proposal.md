## Why

Change 04 gave the Worker its repo-data reads; the agent still can't see a single Kroger price, sale, or product. This change adds the **external-services read half** of the tool surface — the Kroger-facing tools and the headline ingredient→SKU matching pipeline — so menu generation (Changes 08–09) has real prices, availability, and SKU resolution to reason over. It stays deliberately **read-only**: no cart write, no repo write, so the Worker remains authless and stateless exactly as Change 04 left it, and the first write (plus the Cloudflare Access gate that protects it) lands together in Change 06.

## What Changes

- **Kroger API client** authenticating with the `client_credentials` grant (client ID/secret as Worker secrets), with in-memory access-token caching (re-mint on expiry) and `429`/`Retry-After`/backoff handling, since Kroger publishes no firm numeric rate limits. Structured errors per the Change 04 convention; no new persistent storage.
- **Location resolution** — resolve `preferences.toml`'s `preferred_location` label to a Kroger `locationId` (cached). A hard prerequisite: the Products API returns pricing only when given a `locationId`.
- **`kroger_search`** (internal helper) — the shared term + `locationId` (+ curbside/delivery fulfillment) product search every other Kroger tool calls.
- **`kroger_prices(ingredients)`** — current `{ regular, promo }` price and curbside/delivery availability per ingredient.
- **`kroger_flyer(filter)`** — a **synthesized** sale scan (there is no flyer/circular endpoint): scans *precise* derived terms (stockup/menu/sub candidates) plus *broad* curated terms from a new **`flyer_terms.toml`**, keeps `promo > 0`, deduped by `productId`. Explicitly non-exhaustive (no "sort by discount").
- **`ready_to_eat_available()`** — cross-reference `ready_to_eat/*.toml` against Kroger availability, where "available" means `fulfillment.curbside || fulfillment.delivery` at the location (no live in-store stock exists in the API).
- **`match_ingredient_to_kroger_sku(ingredient, context)`** — the 7-step deterministic pipeline, **resolve-only**: returns a confident match, narrowed candidates, or `unavailable`. Confidence = cache hit OR a defined `preferences.toml [brands]` entry (tri-state: absent → ask; `[]` → cheapest acceptable; ranked list → list-order rank). Scoring not hard-filtering; dietary is a best-effort soft score; the matcher **never substitutes** (returns `unavailable` so `propose_substitutions` can handle it under confirmation). Cache hits are revalidated for live price + availability (no TTL); `bypass_cache` forces re-resolution.
- **`compare_unit_price(items)`** (new tool) — deterministic price-per-unit, dimension-bucketed (`$/fl oz` never compared to `$/lb`); the LLM normalizes only unparseable size strings, never does the arithmetic. One core, shared by the matcher's tiebreaker and the conversational ambiguous-flow.
- **`flyer_terms.toml`** — new user-curated config (edit-only-when-directed) with a `docs/SCHEMAS.md` entry.
- **Tests** for the matching pipeline against mocked Kroger responses (normalization, cache lookup + revalidation, scoring, tiebreaker/unit-price, confidence gate, `unavailable`).

Explicitly **deferred to Change 06** (not in scope): SKU-cache writes to `skus/kroger.toml`, `authorization_code` OAuth + callback + KV refresh-token storage, the cart write, and the Cloudflare Access gate.

## Capabilities

### New Capabilities
- `kroger-integration`: the Kroger `client_credentials` API client (token caching, `429`/backoff), location resolution, and the read tools `kroger_search` (internal), `kroger_prices`, `kroger_flyer` (precise + broad `flyer_terms.toml` scan), and `ready_to_eat_available` (curbside/delivery availability). Encodes the public-tier ceiling and the no-flyer-endpoint synthesis.
- `ingredient-matching`: the `match_ingredient_to_kroger_sku` resolve-only pipeline (tri-state `[brands]` confidence, scoring-not-filtering, best-effort dietary, no-substitution `unavailable` signal, cache revalidation with no TTL, `bypass_cache`) and the `compare_unit_price` deterministic unit-price tool.

### Modified Capabilities
<!-- None. mcp-server is unchanged: Change 05 stays authless/stateless, the Kroger client is a new external path, and the existing structured-error convention already covers upstream Kroger failures (upstream_unavailable). -->

## Impact

- **Code:** new Worker source under `worker/src/` — a Kroger API client (parallel to the existing GitHub client), location resolution, the four Kroger read tools, `match_ingredient_to_kroger_sku`, and `compare_unit_price`, all registered on the existing `McpServer`.
- **Config / secrets:** Kroger `client_credentials` (client ID/secret) via `wrangler secret put`; documented in `worker/README.md`. New repo file `flyer_terms.toml`.
- **Docs:** already reconciled — `docs/TOOLS.md`, `docs/PROJECT.md`, `docs/SCHEMAS.md`, `CLAUDE.md`, `ROADMAP.md`.
- **External dependency:** Kroger Developer account (public tier); behavior bounded by the public Products/Locations APIs (no circular endpoint, location-scoped pricing, undocumented limits).
- **Out of scope / downstream:** all writes and the auth gate (Change 06); conversational menu flows that consume these tools (Changes 08–09).
