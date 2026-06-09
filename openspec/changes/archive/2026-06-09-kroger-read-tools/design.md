## Context

Change 04 shipped the Worker's repo-data reads (authless, stateless, `createMcpHandler`, a single authenticated GitHub client, structured errors). This change adds the Kroger-facing reads and the ingredient→SKU matching pipeline. The Kroger surface was researched against the live developer portal (2026-06); findings constrain the design hard, so the decisions below are mostly about living within what the **public** Kroger API actually exposes. Motivation is in `proposal.md`; the full reasoning trail is captured in `docs/PROJECT.md`, `docs/TOOLS.md`, and `docs/SCHEMAS.md`, which were reconciled ahead of this proposal.

## Goals / Non-Goals

**Goals:**
- Implement the Kroger read tools (`kroger_search` internal, `kroger_prices`, `kroger_flyer`, `ready_to_eat_available`) and `match_ingredient_to_kroger_sku` (resolve-only) + `compare_unit_price`.
- Keep the Worker authless and stateless — no new persistent storage, no write surface — so it inherits Change 04's security posture unchanged.
- Make matching confidence legible and self-extinguishing, and keep all genuinely-fuzzy decisions behind the LLM/`ambiguous` boundary.

**Non-Goals:**
- Any write: SKU-cache writes, `authorization_code` OAuth, KV token storage, cart writes, and the Cloudflare Access gate are **Change 06**.
- Partner-tier Kroger features (Catalog API V2, cart read/remove) — out of reach for a personal app.
- Conversational menu orchestration that consumes these tools (Changes 08–09).
- Exhaustive sale discovery (the API can't support it — see Decisions).

## Decisions

### D1 — Read-only scope; writes + auth-code + gate all move to Change 06
Every tool here uses the `client_credentials` grant, which needs no user context and no refresh token. So the Worker stays authless/stateless and introduces **zero** write surface.
- *Alternative considered:* build the `authorization_code` OAuth scaffolding (callback route, KV refresh-token storage) here so Change 06 is "just" the cart tool. **Rejected:** it adds a public callback surface and mutable state with nothing in 05 consuming them, and it would let a write capability exist before the Access gate. Shipping the first write and its gate together in Change 06 makes the "gated before any write" invariant *structural* rather than a thing to remember.

### D2 — `kroger_flyer` is a synthesized scan, not a feed
There is no flyer/circular/"list all sales" endpoint. Product price is `{ regular, promo }` with `promo: 0` meaning not-on-sale; the only way to find a sale is to search a term and inspect `promo`. So `kroger_flyer` scans two term sources, dedupes by `productId`, and keeps `promo > 0`:
- **Precise** terms — derived (stockup-flagged pantry, current menu ingredients, substitution candidates).
- **Broad** terms — curated in `flyer_terms.toml` (e.g. `"fruit"`, `"frozen meals"`), paginated a few pages deep.
- *Trade-off:* each term returns a bounded **relevance**-ranked page and there is no "sort by discount", so this samples the head of each category — it will miss deep sales on low-relevance items. Accepted: it still widens the net well past the known-items list, and cost is trivial. This limitation is documented, not hidden.

### D3 — Availability = curbside/delivery fulfillment
The user shops curbside/delivery only, and the API exposes no live in-store stock. "Available" therefore means `fulfillment.curbside || fulfillment.delivery` at the resolved location — a real signal the API gives — used by both `ready_to_eat_available` and the matcher's step-4 availability check. Honest naming: this is "fulfillable", not "in stock right now".

### D4 — Location resolution is a hard prerequisite
The Products API returns pricing only with a `filter.locationId`. Resolve `preferences.toml`'s `preferred_location` label → `locationId` via the Locations API, cache it in isolate memory. Without it, no priced call works.

### D5 — Matching confidence is tri-state on `preferences.toml [brands]`
Confident (auto-pick, no prompt) when **a cache hit** OR **a defined `[brands]` entry** resolves it; otherwise `ambiguous`, returning narrowed candidates for the LLM to present/ask. `[brands]` is tri-state: key absent → ask; `[]` → "don't care, cheapest acceptable"; non-empty list → ranked preference (list order = rank).
- *Why:* makes "when will it ask me?" predictable from config, and every answered question caches as `[]` or a pinned SKU, so prompting decays over time.
- *Alternative considered:* a price-distance/numeric ambiguity threshold. **Rejected** as opaque and hard to tune; brand-preference presence is legible and user-controlled.

### D6 — Scoring, not hard filters
Brand/dietary/availability are **scoring** signals, not eliminating filters — a missing preferred brand can't empty the candidate set (it just scores nothing on the brand axis, which naturally routes to `ambiguous`). This also enables ranked fallback brands (list order). Availability is the one near-hard constraint: a candidate not fulfillable via curbside/delivery is not a valid pick.

### D7 — Dietary is best-effort, never a gate
The public product response carries **no** dietary/nutrition attributes — only `brand`, `categories`, `description`, `size`. So dietary is a soft score (e.g. "organic" appears in the name), never a deterministic filter. The high-stakes "cooking for someone with X" case is human-reviewed before cart submit (a Change 06+ concern), so best-effort here is acceptable.

### D8 — The matcher never substitutes; it returns `unavailable`
PROJECT.md's earlier step-4 wording ("apply substitutions if exact unavailable") conflicts with the core "never auto-substitute" principle. Resolved: `match_ingredient_to_kroger_sku` matches the **given** ingredient and, if nothing is fulfillable, returns `{ resolved: false, reason: "unavailable" }`. Substitution stays the sole responsibility of `propose_substitutions` (the one owner of `substitutions.toml`), always under user confirmation. One tool owns the rules file; no silent swaps. (PROJECT.md step 4 reconciled accordingly.)

### D9 — Cache revalidation, no TTL
A cache hit short-circuits the **expensive** part (search + narrowing + the ask), but the resolved SKU is revalidated with one targeted lookup (current price + curbside/delivery availability) before being returned. Available → use with fresh price; unavailable → re-resolve (self-healing). Because every hit is revalidated, the cache needs **no TTL**; `last_used` is informational. `bypass_cache` lets the LLM force re-resolution when a hit doesn't fit recipe context (cached generic, recipe wants organic).
- *Why not trust the cached price:* stale availability would put a dead item in the cart; stale price corrupts sale-based decisions. One extra lookup per resolved SKU is trivial against the budget.

### D10 — `compare_unit_price`: one deterministic core, two entry points, raw input
A single pure unit-conversion function is used in-process for the matcher's tiebreaker and exposed as an MCP tool for the conversational ambiguous-flow. The tool takes **raw** `price` + `size` strings (the LLM forwards what it already has) and owns parsing, conversion, and division — the LLM never does arithmetic. It ranks **within** a dimension only (volume/weight/count); cross-dimension or unparseable items land in `incomparable`, which the LLM may normalize via `quantity_override`/`unit_override` and re-call.
- *Why raw input over pre-parsed:* turning `"1/2 gal"` into `0.5` is arithmetic; keeping it in the tool honors "don't let the LLM do the math" strictly and removes an LLM-normalization divergence path for the common case.

### D11 — Rate limits: design for `429`, not a hardcoded budget
Kroger publishes no firm numeric limits. The Kroger client honors `Retry-After` and applies exponential backoff with jitter on `429`, and caches the `client_credentials` access token in isolate memory (re-mint on expiry) rather than minting per call.

### D12 — Kroger client is a new path, mcp-server unchanged
The Kroger client parallels the existing GitHub client but is a distinct external path; it does not modify the `mcp-server` capability. Upstream Kroger failures map onto the existing structured-error convention (`upstream_unavailable`); the matcher's `unavailable` is a tool *result*, not an error.

## Risks / Trade-offs

- **Cold-start prompting** → The first real menu (empty cache, sparse `[brands]`) asks many "which X?" questions. Mitigation: seed `[brands]` + a few `skus/kroger.toml` entries for common staples before the first live cycle; note in the Change 08/09 "done when".
- **Flyer blind spots (D2)** → Deep sales on low-relevance items are missed. Mitigation: curate `flyer_terms.toml`, paginate a few pages deep, and frame `kroger_flyer` as non-exhaustive in user-facing output.
- **Unit-price parser gaps (D10)** → Odd size strings ("Family Size") won't parse. Mitigation: return them as `incomparable` and let the LLM normalize the residue; fall back to raw price for the tiebreaker.
- **Dietary under-matching (D7)** → Best-effort scoring may let a non-conforming item through. Mitigation: human cart review (downstream); never claimed as a guarantee.
- **Kroger API drift / outage** → Tools degrade to structured errors rather than throwing; the agent reports plainly.

## Migration Plan

- Additive only — no existing behavior changes; new tools register alongside the Change 04 reads.
- One-time manual setup: create the Kroger Developer (public) app, `wrangler secret put` the client ID/secret; document in `worker/README.md`. CD (Change 04) owns redeploys.
- Add `flyer_terms.toml` to the repo (curated, may start small). No data migration.
- Rollback: revert the Worker source; the new secrets and `flyer_terms.toml` are inert without it.

## Open Questions

- **`filter.fulfillment` codes** — ~~confirm the exact curbside/delivery filter values against the live API~~ **Resolved (implementation):** the client does **not** send a request-side `filter.fulfillment` (the exact codes are undocumented and unverified). Availability is instead read from the documented per-item response flags `items[].fulfillment.curbside` / `.delivery`, which `kroger_search` normalizes onto every candidate. This is robust regardless of the request-filter codes and satisfies the curbside/delivery availability requirement without speculation. Revisit only as an efficiency optimization (server-side pre-filtering) once a code is confirmed live.
- **`filter.productId` multi-ID** — confirm whether it accepts a comma-separated list; if so, batch cache revalidation into 1–2 calls instead of one-per-SKU.
- **"Cheapest acceptable" measure for `[]` commodities** — current call: smallest package covering the `quantity_hint`, then cheapest absolute (vs. best price-per-unit). Revisit if it picks awkward sizes in practice.
