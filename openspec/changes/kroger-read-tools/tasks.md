## 1. Kroger developer setup + secrets

- [x] 1.1 Create a Kroger Developer (public tier) app; obtain `client_credentials` client ID/secret — **DONE (user): production app created with redirect URI `https://grocery-mcp.caseywebb.workers.dev/oauth/callback`.**
- [x] 1.2 `wrangler secret put` the Kroger client ID and secret; add them to `.dev.vars` for local runs — **DONE (user): secrets set; `KROGER_CLIENT_ID`/`KROGER_CLIENT_SECRET` present in `.dev.vars`.**
- [x] 1.3 Confirm `.gitignore` still covers `.dev.vars`; document the one-time setup in `worker/README.md`

## 2. Kroger API client

- [x] 2.1 Implement the Kroger client with `client_credentials` auth and in-memory access-token caching (re-mint on expiry)
- [x] 2.2 Add `429` handling: honor `Retry-After`, else exponential backoff with jitter; map exhausted/unreachable to structured `upstream_unavailable`
- [x] 2.3 Unit-test token reuse, backoff, and structured-error mapping with mocked fetch

## 3. Location resolution

- [x] 3.1 Resolve `preferences.toml` `preferred_location` → `locationId` via the Locations API; cache in isolate memory
- [x] 3.2 Thread `locationId` into all priced product calls; test resolve-once-then-reuse
- [x] 3.3 Confirm the live `filter.fulfillment` codes for curbside/delivery (build-time check) — **Resolved by design: availability is read from documented per-item response flags (`items[].fulfillment.curbside/.delivery`); no undocumented request-side `filter.fulfillment` is sent. See design.md Open Questions.**

## 4. kroger_search (internal helper)

- [x] 4.1 Implement `kroger_search(term)` → Products API with `filter.term` + `locationId` (+ curbside/delivery fulfillment)
- [x] 4.2 Normalize the response to candidates carrying `price { regular, promo }`, `size`, `brand`, fulfillment flags
- [x] 4.3 Keep it internal (not registered as an MCP tool)

## 5. Kroger read tools

- [x] 5.1 `kroger_prices(ingredients)` → per-ingredient `{ regular, promo }`, on-sale, curbside/delivery availability
- [x] 5.2 Add `flyer_terms.toml` (curated) + its `docs/SCHEMAS.md` entry; read it in the Worker
- [x] 5.3 `kroger_flyer(filter)` → scan precise (context) + broad (`flyer_terms.toml`) terms, keep `promo > 0`, dedupe by `productId`, paginate a few pages deep; degrade gracefully when `flyer_terms.toml` is absent
- [x] 5.4 `ready_to_eat_available()` → cross-reference `ready_to_eat/*.toml` against curbside/delivery fulfillment; partition available/unavailable

## 6. compare_unit_price

- [x] 6.1 Implement the deterministic unit-conversion core (parse raw size strings; bucket by volume/weight/count)
- [x] 6.2 Expose `compare_unit_price(items)` returning `{ ranked, cheapest, incomparable }`; support `quantity_override`/`unit_override`
- [x] 6.3 Test dimension bucketing, unparseable-size handling, and override re-call

## 7. match_ingredient_to_kroger_sku (resolve-only)

- [x] 7.1 Step 1 — alias-driven normalization (strip quantity/units, lowercase, apply `aliases.toml`)
- [x] 7.2 Step 2 — cache lookup in `skus/kroger.toml` + revalidate the SKU (live price + curbside/delivery), no TTL; honor `bypass_cache`
- [x] 7.3 Steps 3–4 — search via `kroger_search`; score (tri-state `[brands]`, best-effort dietary, availability) as scoring, not filters
- [x] 7.4 Step 5 — deterministic tiebreaker (on-sale > regular, then unit-price core; `[]` commodity → smallest covering package then cheapest)
- [x] 7.5 Step 6 — confidence gate: cache hit or defined `[brands]` → confident; else `ambiguous`; nothing fulfillable → `unavailable`
- [x] 7.6 Return the three documented shapes; ensure NO cache write occurs here
- [x] 7.7 Pipeline tests with mocked Kroger responses: normalization, cache+revalidation, scoring, tiebreaker/unit-price, confidence gate, `unavailable`

## 8. Registration + integration

- [x] 8.1 Register `kroger_prices`, `kroger_flyer`, `ready_to_eat_available`, `match_ingredient_to_kroger_sku`, `compare_unit_price` on the existing `McpServer`
- [x] 8.2 Verify `docs/TOOLS.md` matches the implemented params/returns (no drift)

## 9. Verify + ship

- [x] 9.1 `wrangler dev` + MCP Inspector: `match_ingredient_to_kroger_sku("extra virgin olive oil")` returns a confident SKU or `ambiguous` candidates against the live public API — **VERIFIED via live read-only smoke (`worker/test/kroger.live.test.ts`, `KROGER_LIVE=1`): token mint, ZIP→locationId, search, and the matcher returned `ambiguous` candidates with live unit-prices. Delta still worth a manual pass: the same call through the MCP transport with GitHub-sourced `[brands]`/aliases/cache (needs local `GITHUB_TOKEN` + a set `preferred_location`).**
- [x] 9.2 MCP Inspector: `kroger_flyer` returns real on-sale items synthesized from precise + broad terms — **VERIFIED via the same live smoke: a broad-term scan returned real on-sale items (`promo > 0`, fulfillable) with prices parsed.**
- [x] 9.3 Push `worker/**`; confirm CD redeploys and the tools list over the deployed URL — **DONE: pushed to `main`; deploy-worker CD ran green (typecheck/test/deploy); `tools/list` over `https://grocery-mcp.caseywebb.workers.dev/mcp` returns all 5 new tools (`kroger_search` correctly internal). Note: deployed `match`/`prices`/`flyer` calls need `[stores].preferred_location` set in `preferences.toml@main` (currently commented) to resolve a locationId.**
