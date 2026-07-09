---
update-when: the satellite sale-scan / order-fill adapter interfaces, their SDKs, or the raw-emit contract change
---

# Authoring store adapters for the satellite

The [home-network satellite](SELF_HOSTING.md#8b-satellite-optional) reaches stores the Worker has **no API** for: it observes a store's loyalty/sale prices (**sale-scan**) and fills that store's cart (**order cart-fill**), behind *your own* store login, off your cloud. It does this by running a small **per-store adapter module you write** and drop into the satellite's mounted adapters directory.

**There are no built-in retailer drivers.** The satellite core ships the *host* (the CLI, the daemon, the local cart-fill helper), the *wire contract*, and the *SDK* injected into your adapter — but **no named-retailer sale or order adapter**. The store-specific, ToS-edge driver is the one piece the operator supplies. A missing adapter is not an error at startup; it's simply a capability the machine doesn't run until you author it.

This is a **structural** boundary, not a documentation gap — and it differs from recipe-scrape, which *does* ship a generic adapter:

| | recipe-scrape | sale-scan / order-fill |
|---|---|---|
| Is there a standard schema? | **Yes** — schema.org `Recipe` JSON-LD | **No** — loyalty pages and carts carry no standard sale/cart schema |
| Generic adapter in core? | **Yes** — `jsonld` covers any site with a sitemap/feed + JSON-LD, zero per-site code | **No** — nothing generic to write |
| Operator-authored code? | Only the tail (a site with no usable structured data) | **Always** — every store is a per-store module |

The generic recipe adapter (`packages/satellite/src/adapters/jsonld.ts`) exists precisely *because* recipes have a standard: `discover` reads the feed and `extract` runs the shared JSON-LD parse, so one adapter serves thousands of sites. Sale/loyalty pages and store carts have no equivalent, so per-store code is unavoidable — see the source comments at the top of `packages/satellite/src/sale-adapter.ts` and `packages/satellite/src/order-adapter.ts`, which spell out the same reasoning.

> **An easier authoring model is under investigation.** A *declarative* driver — the operator supplies per-store selectors as config, the core interprets them — is being evaluated as a way to fill the empty "generic tier" for shopping. It is a feasibility spike, not shipped behaviour; the code-adapter model documented here is what ships today. See [`docs/spikes/declarative-store-adapters.md`](spikes/declarative-store-adapters.md).

---

## The two interfaces

Both interfaces live in `packages/satellite/src/`; both are default-exported as a **factory** `(sdk) => Adapter` from a module you place in the mounted `adapters_dir`. The module's **basename is the adapter name** you reference from config (`adapter = "target"` ⇄ `target.ts`). Types are exported from `@yamp/satellite` (the interfaces + SDKs) and `@yamp/contract` (the emit shapes).

### Sale-scan — `SaleScanAdapter.scan(sdk, target)`

```ts
interface SaleScanAdapter {
  id: string;
  scan(sdk: ScanSdk, target: ScanTarget): Promise<SaleObservation[] | { error: string }>;
}
```

`scan` observes the store for the task's broad terms and returns the RAW `sale` observations it found (or a structured `{ error }` to fail the task — e.g. an expired session). It runs on the **pull channel**: the Worker issues a `sale-scan` task, the satellite claims it, runs your adapter, and reports the observations home.

- **`target: ScanTarget`** = `{ store, locationId, terms }` — the store slug, the store's location id, and the broad flyer terms to scan (`terms` may be empty ⇒ report an empty set).
- **`sdk: ScanSdk`**:
  - `sdk.store` — the `[[scan_stores]]` config entry (`{ store, adapter, fetch_tier? }`).
  - `sdk.config` — the machine config (`adapters_dir`, `connector_url`, …).
  - `sdk.session` — the store's loaded session (`storageState`), or `null` when none was captured (a public sale page may still work).
  - `sdk.fetch(url)` — fetch through this store's **selected tier**, replaying the session. Returns `{ html, finalUrl, status }`. The tier is **HTTP by default** (cookie/session replay, no browser); set `fetch_tier = "browser"` in config for a page that only renders its sale list with JavaScript — the browser tier returns the *rendered* HTML through the same `fetch(url)` call.
  - `sdk.log` — a structured logger (`info`/`warn`/`error`).

There is **no live page** in the scan SDK — `scan` receives HTML text and parses it (a DOM parser you bring, or regex). Fetch is the only I/O primitive.

### Order cart-fill — `OrderAdapter.fill(sdk, lines)`

```ts
interface OrderAdapter {
  id: string;
  fill(sdk: OrderSdk, lines: OrderLine[]): Promise<OrderObservation[] | { error: string }>;
}
```

`fill` drives the store's own cart for the issued pull-list `lines`, resolving any ambiguity through the human, and returns the RAW per-item `order` observations it produced (or a structured `{ error }` to fail the whole fill). It runs from the **local helper** (`yamp-satellite order`), a loopback UI a person drives — cart-fill is the satellite's one human-directed, port-opening surface.

- **`lines: OrderLine[]`** — each `{ item_id, name, quantity, for_recipes, assumed_quantity }`. `item_id` is the canonical, authoritative key (=== `grocery_list.normalized_name`); echo it back on every emit.
- **`sdk: OrderSdk`**:
  - `sdk.store` — the `[[order_stores]]` config entry (`{ store, adapter }`).
  - `sdk.config` / `sdk.session` — as above (an order fill needs a real authenticated session; without one the store rejects the cart writes).
  - **`sdk.page`** — a **live authenticated Playwright `Page`** bound to the store session. Cart-fill is **browser-only** — there is no fetch tier; you drive the store's real cart on this page. The helper opens and disposes it.
  - **`sdk.checkpoint(prompt)`** — surface an ambiguity to the human and await their resolution (see below). This is the **only** resolver.
  - `sdk.log` — the logger. (Logging with a `{ progress: { item_id, state, product?, note? } }` extra is an *optional* live-progress channel the helper animates; the terminal item state comes from the returned observations regardless.)

**The human resolves every product match — the adapter never matches.** There is no automated matcher (by design). Your `fill` *searches* the store, *extracts* candidate products, and hands them to `sdk.checkpoint`; the **human** picks. You then act on their choice:

```ts
// what you pass in:
interface CheckpointPrompt {
  item_id: string;                          // the pull-list line
  message: string;                          // e.g. "3 close matches for 'whole milk' — pick one"
  options?: { productId: string; description: string; size?: string; price?: number; url?: string }[];
}
// what you get back — a discriminated union:
type CheckpointResolution =
  | { action: "select"; productId: string }                 // human picked one of your options
  | { action: "substitute"; product: { productId; description; size?; price?; url? } }  // human supplied a different product
  | { action: "skip" }                                      // leave this line for the human to handle
  | { action: "abort" };                                    // stop the whole fill
```

**The fill stops at review and NEVER checks out.** It fills the cart and drives to the store's own review/cart page — that's the terminal success. The human completes the purchase themselves in the store's UI. This is a safety property; do not automate checkout.

---

## The sensor-not-judge emit contract

An adapter is a **sensor, not a judge**: it emits only RAW, independently-checkable facts. Every derived conclusion is re-computed by the Worker from those raw facts — the same single source of truth a first-party Kroger scan flows through, so a satellite observation and a Kroger scan of the same product are indistinguishable downstream.

- **Sale** — emit `{ kind: "sale", store, locationId, productId, description, regular, promo }` (plus optional `size`, `brand`, `categories`, `url`). Report the raw shelf/loyalty prices as observed. **Never** emit a `savings`, `savings_pct`, `on_sale`, or `sale` field — the Worker re-derives "on sale" and the saving from `{ regular, promo }` and applies the deal floor at read time. (`productId` is the store-neutral merge/dedup identity; it maps to the flyer `sku` at intake.)
- **Order** — emit `{ kind: "order", item_id, disposition, product? }` (plus optional `note`). `disposition` is the raw outcome — `"carted"`, `"substituted"`, or `"unavailable"` — and `product` is the raw provenance of the carted/substituted store product (absent when `unavailable`). **Never** emit a derived grocery-list state (`in_cart`, `status`, `ordered`, …) — the Worker re-derives the `in_cart` transition itself.

**Every emit is validated locally before it leaves your machine.** `validateSaleEmit` / `validateOrderEmit` (in the two adapter modules) run each emitted item through the shared contract parse (`parseSaleObservation` / `parseOrderObservation`). A non-contract shape is rejected; a **smuggled derived field is rejected loudly** (category `judgment_smuggled`) rather than silently stripped, so a misbehaving adapter surfaces to the operator instead of quietly shipping a judgment. Rejects never reach the wire, and they feed the source-audit rejection ledger the admin panel shows.

You cannot bypass this — there is no raw wire access. Emit raw facts; let the Worker conclude.

---

## Wiring it up, end to end

The provisioning around the adapter (minting an ingest key, registering the store, marking a store `fulfillment: "satellite"`) is in [`docs/SELF_HOSTING.md` §8b/§8c](SELF_HOSTING.md#8b-satellite-optional). The adapter-authoring loop itself is:

1. **Capture the store session out-of-band.** The satellite reuses *your* login; it never automates one. On a machine with a display:

   ```bash
   yamp-satellite login <store>     # headful browser opens → you log in → session saved
   ```

   The session lands in the mounted `config/sessions/<store>.json` (Playwright `storageState`), keyed by the store slug. `cookie-import <store> <file>` imports a session you exported elsewhere. The daemon/helper consume it read-only; re-run `login` when it expires (the machine reports `auth_expired`).

2. **Drop your adapter module in `adapters_dir`.** A `.ts`/`.mjs`/`.js` file whose **basename is the adapter name**, default-exporting the factory. Point `adapters_dir` at the mounted directory in `config/satellite.toml`.

3. **Declare the store.** In `config/satellite.toml`:

   ```toml
   adapters_dir = "/config/adapters"

   # sale-scan (pull channel)
   [[scan_stores]]
   store      = "familyfare"    # the store slug (also the session id + the sale-scan task's store)
   adapter    = "familyfare"    # your module in adapters_dir (familyfare.ts)
   fetch_tier = "browser"       # omit for the default HTTP tier

   # order cart-fill (local helper) — browser-only, no fetch_tier
   [[order_stores]]
   store   = "target"           # the registered store slug (also the session id)
   adapter = "target"           # your module in adapters_dir (target.ts)
   ```

   Declaring any `[[scan_stores]]` entry is how the machine opts into the sale-scan capability; any `[[order_stores]]` entry opts into cart-fill.

4. **Run it.**
   - **Sale-scan:** `yamp-satellite run` (add `--watch` to loop on the schedule). The tick claims and runs `sale-scan` tasks and reports observations home.
   - **Order cart-fill:** `yamp-satellite order` (append the store slug if you declared more than one). It binds loopback, prints a URL + one-time token; you open it, hit Refresh, resolve each checkpoint, and it stops at review.

5. **Dry-run before going live.**
   - **Sale-scan:** `yamp-satellite test <store> <locationId> [terms...]` runs your scan adapter behind the store session, validates each emit locally, and **prints** the observations it *would* report — sending nothing. It also prints any locally-rejected emits so you catch a smuggled/malformed field.
   - **Order cart-fill:** exercise the adapter through the `order` helper itself; `yamp-satellite order --demo` previews the whole helper UI with canned fixtures (no Worker, no real store, no browser) so you can walk the flow before wiring a real adapter.

---

## Skeleton — sale-scan `scan()`

A minimal, non-retailer-specific starting point. Replace the placeholder selectors/parsing with your store's. Type-only imports are erased at load time, so the module runs even where the workspace type packages aren't installed — they're here to check the shapes while you author.

```ts
// adapters/mystore.ts  — basename "mystore" is the adapter name you put in [[scan_stores]].adapter
import type { SaleAdapterFactory, ScanSdk, ScanTarget } from "@yamp/satellite";
import type { SaleObservation } from "@yamp/contract";

// One raw product card parsed off the sale page. TODO: parse your store's markup.
// `sdk.fetch` returns HTML TEXT (the browser tier returns rendered HTML), so parse it with a
// DOM parser you bring (e.g. node-html-parser / cheerio) or with regex — there is no live page.
interface SaleCard {
  productId: string;
  description: string;
  regular: number; // raw shelf price, e.g. 4.99
  promo: number;   // raw loyalty/sale price, e.g. 2.99
  size?: string;
  url?: string;
}

function parseSaleCards(_html: string): SaleCard[] {
  // TODO: select the repeating product card and pull each field.
  //   const doc = parse(_html);
  //   return doc.querySelectorAll(".ad-item").map((el) => ({
  //     productId:   el.getAttribute("data-upc")!,               // TODO: your store's id attribute
  //     description: el.querySelector(".ad-item__title")!.text,  // TODO: your store's selectors
  //     regular:     parsePrice(el.querySelector(".ad-item__reg")!.text),  // "$4.99" → 4.99
  //     promo:       parsePrice(el.querySelector(".ad-item__sale")!.text),
  //     size:        el.querySelector(".ad-item__size")?.text,
  //     url:         el.querySelector("a")?.getAttribute("href"),
  //   }));
  return [];
}

const factory: SaleAdapterFactory = (sdk: ScanSdk) => ({
  id: sdk.store.store,

  async scan(sdkArg: ScanSdk, target: ScanTarget): Promise<SaleObservation[] | { error: string }> {
    // TODO: build your store's sale/weekly-ad URL from the task's location + terms.
    const url = `https://www.mystore.example/weekly-ad?store=${encodeURIComponent(target.locationId)}`;

    const { html, status } = await sdkArg.fetch(url); // replays the captured session
    if (status >= 400) return { error: `sale page fetch failed: HTTP ${status}` };

    // Emit the RAW regular + promo you read — never a computed saving or an "on sale" flag.
    // The Worker re-derives "on sale" and the saving from { regular, promo } and applies the deal
    // floor. A weekly-ad page is already the sale set; a promo == regular row is simply dropped by
    // the Worker, so you needn't filter it.
    return parseSaleCards(html).map((c): SaleObservation => ({
      kind: "sale",
      store: target.store,
      locationId: target.locationId,
      productId: c.productId,
      description: c.description,
      regular: c.regular,
      promo: c.promo,
      ...(c.size ? { size: c.size } : {}),
      ...(c.url ? { url: c.url } : {}),
    }));
  },
});

export default factory;
```

---

## Skeleton — order cart-fill `fill()`

```ts
// adapters/mystore.ts  — basename "mystore" is the adapter name you put in [[order_stores]].adapter
import type { OrderAdapterFactory, OrderSdk } from "@yamp/satellite";
import type { OrderLine, OrderObservation } from "@yamp/contract";

// A candidate store product extracted from a search result. TODO: your store's tile markup.
interface Candidate {
  productId: string;
  description: string;
  size?: string;
  price?: number;
  url?: string;
}

const factory: OrderAdapterFactory = (sdk: OrderSdk) => ({
  id: sdk.store.store,

  async fill(sdkArg: OrderSdk, lines: OrderLine[]): Promise<OrderObservation[] | { error: string }> {
    const page = sdkArg.page; // a LIVE authenticated Playwright page bound to the store session
    const observations: OrderObservation[] = [];

    for (const line of lines) {
      // 1. Search the store for this line and extract candidate products (you search; you never match).
      const searchUrl = `https://www.mystore.example/search?q=${encodeURIComponent(line.name)}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

      // TODO: read the result tiles into candidates.
      //   const candidates = await page.$$eval(".product-tile", (tiles) => tiles.map((t) => ({ ... })));
      const candidates: Candidate[] = [];

      if (candidates.length === 0) {
        observations.push({ kind: "order", item_id: line.item_id, disposition: "unavailable", note: "no search results" });
        continue;
      }

      // 2. Hand the candidates to the HUMAN — the only resolver. The adapter never picks.
      const resolution = await sdkArg.checkpoint({
        item_id: line.item_id,
        message: `${candidates.length} matches for "${line.name}" — pick one`,
        options: candidates,
      });

      // 3. Act on the human's resolution.
      if (resolution.action === "abort") return observations;          // stop the whole fill
      if (resolution.action === "skip") {
        observations.push({ kind: "order", item_id: line.item_id, disposition: "unavailable", note: "skipped by operator" });
        continue;
      }

      // "select" (one of your options) or "substitute" (a product the human supplied).
      const chosen: Candidate =
        resolution.action === "select"
          ? candidates.find((c) => c.productId === resolution.productId) ?? candidates[0]
          : resolution.product;
      const disposition = resolution.action === "select" ? "carted" : "substituted";

      // 4. Add the chosen product to the store's real cart. TODO: your store's add-to-cart flow.
      //   await page.click(`[data-product="${chosen.productId}"] .add-to-cart`);
      //   await page.click(".confirm-modal__add");            // optional 2nd step
      //   await page.waitForSelector(".cart-count");           // read back that it landed

      // 5. Emit the RAW per-item outcome — never a derived in_cart/status field.
      observations.push({
        kind: "order",
        item_id: line.item_id,
        disposition,
        product: {
          productId: chosen.productId,
          description: chosen.description,
          ...(chosen.size ? { size: chosen.size } : {}),
          ...(chosen.price !== undefined ? { price: chosen.price } : {}),
          ...(chosen.url ? { url: chosen.url } : {}),
        },
      });
    }

    // 6. Drive to the store's review/cart page and STOP. Never check out — the human does that.
    await page.goto("https://www.mystore.example/cart", { waitUntil: "domcontentloaded" });
    return observations;
  },
});

export default factory;
```

---

## Drafting an adapter with an LLM

Writing a per-store adapter is a good fit for an LLM working from a page's HTML — the mechanical parts (selectors, the search→extract→add loop) are exactly what a model drafts well, and the human checkpoint means the model never has to solve product matching. Run the prompt below **in your own Claude/LLM** against a store's page HTML.

> This is an **operator** convenience, not part of the member plugin — nothing here calls the Worker or the agent. You own the output and the ToS decision; always dry-run it (`yamp-satellite test …`, or the `order` helper) before going live.

````text
You are writing a per-store adapter module for a self-hosted grocery "satellite". The satellite core
ships no built-in retailer drivers; I supply the store-specific one. Write ONE TypeScript module,
default-exporting a factory. Choose the interface based on what I ask for:

SALE-SCAN — observe a store's weekly-ad / loyalty sale prices:
  const factory: SaleAdapterFactory = (sdk: ScanSdk) => ({
    id,
    async scan(sdk: ScanSdk, target: ScanTarget): Promise<SaleObservation[] | { error: string }> { ... }
  });
  - target = { store, locationId, terms }.
  - sdk.fetch(url) => { html, finalUrl, status }: fetches through the captured session and returns
    HTML TEXT (no live page). Parse it with a DOM parser or regex.
  - Emit RAW sale facts ONLY: { kind: "sale", store, locationId, productId, description, regular, promo }
    (optional: size, brand, categories, url). NEVER emit savings / savings_pct / on_sale / sale — the
    Worker re-derives "on sale" and the saving from { regular, promo }.

ORDER CART-FILL — fill the store's cart for a pull-list:
  const factory: OrderAdapterFactory = (sdk: OrderSdk) => ({
    id,
    async fill(sdk: OrderSdk, lines: OrderLine[]): Promise<OrderObservation[] | { error: string }> { ... }
  });
  - lines: each { item_id, name, quantity, for_recipes, assumed_quantity }. Echo item_id on every emit.
  - sdk.page is a LIVE authenticated Playwright Page (browser-only; no fetch tier). Drive the real cart.
  - The adapter NEVER matches a product. For each line: search, extract candidates, then call
    await sdk.checkpoint({ item_id, message, options }) and act on the human's resolution:
      { action: "select"; productId }  -> add that option; disposition "carted"
      { action: "substitute"; product } -> add that product; disposition "substituted"
      { action: "skip" }                -> disposition "unavailable" (leave for the human)
      { action: "abort" }               -> return the observations so far and stop
  - Emit RAW per-item outcomes ONLY: { kind: "order", item_id, disposition, product? } (optional note).
    disposition is "carted" | "substituted" | "unavailable"; product is the raw store product (omit
    when unavailable). NEVER emit in_cart / status / ordered — the Worker re-derives cart state.
  - Fill the cart, drive to the store's review/cart page, and STOP. NEVER check out (safety property).

Contract for BOTH: you are a sensor, not a judge. Emit only independently-checkable raw facts; every
emit is validated locally and a smuggled derived field is rejected loudly. Return a structured
{ error } to fail the task (e.g. an expired session) — never throw. Use placeholder selectors marked
// TODO where the store's markup is needed.

Here is the store's page HTML and the flow to automate:
[PASTE the sale-page or search-result HTML, and describe the add-to-cart / review flow]
````
