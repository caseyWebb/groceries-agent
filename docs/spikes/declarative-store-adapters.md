# Spike — Declarative store adapters for the satellite

> **Status: investigation, not a living-state doc.** This is a speculative feasibility spike, not
> documentation of shipped behaviour. **Run it from a session on the operator's own LAN** (a real
> browser that can reach real grocery sites, plus the operator's own store logins) — that's the whole
> reason it can't run from the cloud dev session. Fill in the coverage report at the bottom, then make
> the go/no-go call. Delete or convert this file to an OpenSpec proposal once the spike is resolved.

## Why this spike exists

The satellite's shopping capabilities (sale-scan, order cart-fill) require an **operator-authored,
per-store browser adapter** — today a TypeScript module implementing `scan(sdk, target)` /
`fill(sdk, lines)` against the SDK's live Playwright `page` / tiered `fetch`. That's the single
highest barrier in the product: it demands JS + Playwright skill per store, and there are
deliberately **no built-in retailer drivers** (they'd be the ToS-hostile part the core doesn't ship).

Recipe-scrape does *not* have this barrier because recipes have a **standard** — schema.org `Recipe`
JSON-LD — so one generic `jsonld` adapter covers thousands of sites. Sale/loyalty pages and store
carts have **no standard schema**, so per-store code is *structural*, not a docs oversight:

```
 recipe-scrape:  a STANDARD exists  → generic jsonld adapter (zero per-site code) + operator code (tail)
 sale / order:   NO standard        → ??? (nothing generic today)              + operator code (ALWAYS)
```

**The idea this spike evaluates:** ship a **generic declarative driver** in the satellite core that
interprets a per-store **config** (selectors + a few actions), filling the empty "generic tier."
The config *is* the per-store standard the operator supplies — the ToS-edge part stays operator-owned
(the core ships an empty engine, exactly like it ships the SDK today).

**Decided in the design conversation (context, not part of this spike):**
- **Config authors = an LLM (drafting from a store's page HTML) or a future click+drag WYSIWYG UI on
  the satellite — NOT humans hand-writing TOML.** So the format optimizes for *machine generation +
  human review*, not hand-authoring ergonomics.
- Ship *now*, separately from this spike: a docs authoring guide + an LLM-codegen prompt + commented
  code skeletons (the low-stakes enablement for the current code-adapter model).
- The declarative engine is **deferred pending this spike's coverage verdict.**

## The design being validated (sketch — confirm or refute it against real DOMs)

**The load-bearing insight — the human checkpoint makes declarative order-fill tractable.** A
declarative order engine never has to *match* a product (the fuzzy part). Change 4's cart-fill already
routes every ambiguity to a **human** via `sdk.checkpoint(...)`. So the config only expresses the
**mechanical** parts — *search → extract candidates → add the chosen one → read back* — and the human
resolves the match. The fuzzy work stays with the human (Decision 9, untouched); the declarative part
is bounded and mechanical.

Sketched configs (validate these shapes — do the primitives suffice?):

```toml
# sale-scan — pure list extraction
[[scan_stores]]
store = "familyfare"
driver = "declarative"                 # vs. adapter = "<module.ts>"
  page.url  = "https://.../weekly-ad?store={location}"   # {location} from the task
  page.tier = "browser"                # else "http" (cookie/session replay, no browser)
  page.item = ".ad-item"               # repeating card; paginate = { next=".next", max=20 }
  fields.productId   = { sel=".ad-item",       get="attr:data-upc" }
  fields.description = { sel=".ad-item__title", get="text" }
  fields.regular     = { sel=".ad-item__reg",   get="price" }   # "$4.99" → 4.99
  fields.promo       = { sel=".ad-item__sale",  get="price" }
  # engine emits RAW {regular,promo} only; the on-sale gate + savings stay the Worker's (sensor-not-judge)
```
```toml
# order-fill — the per-line loop the engine runs; the HUMAN matches at the checkpoint
[[order_stores]]
store = "familyfare"
driver = "declarative"
  search.url    = "https://.../search?q={query}"   # {query} = the grocery line
  search.result = ".product-tile"                  # OR a search-box selector + type + submit
  candidate.productId   = { sel="",            get="attr:data-upc" }   # sel="" = the result element itself
  candidate.description = { sel=".tile__name", get="text" }
  candidate.price       = { sel=".tile__price",get="price" }
  candidate.size        = { sel=".tile__size", get="text" }
  add.button        = ".tile__add"        # within the chosen result tile
  add.confirm       = ".modal__confirm"   # optional 2nd step
  add.in_cart_check = ".tile--in-cart"    # read-back → disposition
  review.url        = "https://.../cart"  # drive here and STOP — never checkout (safety property)
```
Engine order loop: `for each line → goto search(query=line) → extract candidates → sdk.checkpoint({options:candidates}) → human picks productId → click that tile's add.button (+ confirm) → in_cart_check → emit {item_id, disposition: carted|unavailable, product}`. `unavailable` = no results / add failed.

**Proposed bounded primitive set** (the thing to keep SMALL — every temptation to add an `if`/loop is
a vote for "code, not config"):
- **Extractors:** a selector (`css`/`xpath`) + a `get` of `text | attr:<name> | price | regex:<pat>`.
- **Actions:** `goto(url-template)`, `type(sel, value)`, `click(sel)`, `waitFor(sel)`, `paginate(next-sel, max)`, `scroll(until)`.
- **Templating:** `{location}` (sale), `{query}` (order line).
- Nothing else. When a site needs more, the operator writes a **code adapter** — the existing model,
  unchanged. Declarative covers the easy majority; code covers the hard tail (the clean escape hatch).

**Two properties that make this more than convenience (confirm they hold):**
- **Composes with the LLM prompt** — the model drafts a *config* (from page HTML), far easier to get
  right + eyeball-fix than a Playwright module.
- **Supercharges source-audit (change 5)** — a broken selector is a *precise, structured* failure the
  engine can emit as the `contract_invalid` local-reject reason (e.g. `field 'regular': selector
  '.ad-item__reg' matched 0 elements`), a far better rejection-ledger signal than a code adapter's
  arbitrary throw. Declarative + the audit you just shipped tell the operator *exactly which selector
  rotted.*

## The investigation to run (on the LAN)

**Environment:** you're on the operator's LAN with a real browser (Playwright directly, or the
satellite's browser tier) and can reach real grocery sites + log into the operator's own store
accounts. Use browser devtools / Playwright to inspect the **live** DOM. You are *sketching configs
and recording where the primitives break* — **not building the engine.**

### 1. Pick 4–5 real test stores spanning the space
Suggested spread (adjust to what you can actually reach + log into):
- a **Kroger banner** (Kroger / Fred Meyer / King Soopers / Ralphs),
- an **Albertsons/Safeway banner** (Safeway / Albertsons / Vons),
- a **regional chain** (Meijer / Publix / H-E-B / WinCo / Wegmans),
- an **Instacart-backed storefront** (many small chains white-label Instacart),
- **the operator's OWN primary store** (the one that actually matters). Include ≥1 you have a login
  for (order-fill needs an authenticated session).

### 2. For each store, sketch + test BOTH configs against the live DOM
**A. Sale-scan (extraction).** Open the weekly-ad / loyalty / sale page. Find the repeating item
selector + the four field selectors (productId, description, regular, promo). Write the config; run
the extractors against the live page. Does the bounded primitive set pull the full sale list cleanly?
Record every gap: infinite scroll / lazy-load, per-category navigation, a weird price format the
`price` extractor misses, no stable product id, JS-only rendering, an anti-bot wall.

**B. Order-fill (search → extract → add).** Log in. For a sample line (e.g. "whole milk"): drive
search → result tiles → extract the candidate fields → (a human *would* pick here) → click the chosen
tile's add-to-cart → read back "in cart". Write the config; run it. Record every gap: variant/size
pickers, quantity steppers, a multi-step add (modal/confirm), out-of-stock handling (→ `unavailable`),
a login/anti-bot wall, a search that needs category navigation instead of a `?q=` URL.

### 3. Record per store
| store | sale-scan: covered? / gaps | order-fill: covered? / gaps | verdict: declarative / needs-1-primitive / irreducibly-code |
|---|---|---|---|
| _(fill in)_ | | | |

### 4. Answer these questions
1. **Coverage** — roughly what fraction of the tested sites does the bounded primitive set cover for
   (a) sale-scan and (b) order-fill separately? (Expect sale-scan higher — pure extraction; order-fill
   lower — the action loop.)
2. **The minimal primitive set** — what is the *smallest* set that covers the majority? Prune the
   sketch above to what you actually needed. **List every time you were tempted to add a conditional /
   loop / wait-hack** — that list is the "escape-hatch-to-code" boundary.
3. **The human-checkpoint hypothesis** — did having the human match (vs the config matching) actually
   make order-fill tractable? Where did it still need config-level logic beyond search/extract/add?
4. **Source-audit synergy** — confirm selector-level failures are cleanly expressible as structured
   local-reject reasons the change-5 ledger would surface.
5. **LLM-authorability** — given a store's page HTML, could a model plausibly draft the config
   correctly? (Eyeball a real page → the config it implies.)

### 5. Deliverable — bring back
- The filled coverage table + the pruned minimal primitive set.
- A **go / no-go recommendation**:
  - **Go** → build the declarative engine as a new OpenSpec change, **sale-scan-first** (pure
    extraction proves the engine + the `test` dry-run loop), **order-fill-second** (adds the action
    loop). Include the recommended primitive set + config schema, ready to turn into a proposal.
  - **No-go** → why (coverage too low / escape-hatch-to-code too frequent), and whether a *narrower*
    version (sale-scan-only declarative, or none) still earns its keep. Docs + LLM-prompt + code
    skeletons remain the model.

## Guardrails for the spike
- **Don't build the engine.** Sketch configs against live DOMs + report coverage. That's it.
- **Keep the primitive set honest.** Every reach for an `if` / loop / wait-hack is a vote toward
  "code, not config" — *record it* rather than quietly extending the DSL.
- **Respect ToS.** You're inspecting your *own* sessions on your *own* LAN for feasibility. The output
  is a **coverage report**, not a shipped retailer driver.
- If the coverage answer is obviously lopsided (e.g. sale-scan trivially covered, order-fill rarely),
  say so early — a **narrower "declarative sale-scan only"** outcome is a perfectly good result.

## Pointers into the code (what the engine would implement against)
- Adapter interfaces + SDKs: `packages/satellite/src/sale-adapter.ts` (`SaleScanAdapter`, `ScanSdk`,
  `validateSaleEmit`), `packages/satellite/src/order-adapter.ts` (`OrderAdapter`, `OrderSdk`,
  `CheckpointPrompt`, `validateOrderEmit`). A declarative driver is just a *generic implementation* of
  these interfaces that reads a config instead of hand-written logic.
- The generic-recipe precedent (the "generic tier" this mirrors): `packages/satellite/src/adapters/jsonld.ts`.
- Config wiring: `packages/satellite/src/config.ts` (`[[scan_stores]]` / `[[order_stores]]`); session
  capture: `packages/satellite/src/session.ts` + the `login <store>` CLI verb.
- Where a `test` dry-run + a future WYSIWYG editor would live: the sale-scan `test` verb in
  `packages/satellite/src/cli.ts`, and the local helper UI in `packages/satellite/src/helper/`.
- The source-audit signal a declarative engine would feed: `read_satellite_rejections` + the
  Satellites admin page (change 5).
