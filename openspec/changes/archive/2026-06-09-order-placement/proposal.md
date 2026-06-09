## Why

Change 06 built the **capture** half: a SKU-free `grocery_list.toml` buy list that accumulates intent across the week, behind the Cloudflare Access gate. Nothing yet turns that list into a Kroger order. This change builds the **flush** half — resolve the whole list against current availability, write the cart once, and drive the order lifecycle — plus the user-context Kroger auth a cart write requires. See `docs/notes/2026-06-09-order-flow-reframe.md` for the capture/flush rationale.

## What Changes

- **`place_order`** — the order-time flush: resolve the whole `grocery_list.toml` via the Change 05 matcher (`match_ingredient_to_kroger_sku`, with cache revalidation against current price + curbside/delivery availability) → surface ambiguous/unavailable items as one batch checkpoint → `PUT /v1/cart/add` for the resolved set → append learned mappings to `skus/kroger.toml`. Order-time dedup: to-buy = `grocery_list ∪ (menu needs) − (pantry has)`. Partials prompt the user; default buy is 1 package unless told.
- **Order lifecycle** — `active → in_cart → ordered → received`. `place_order` sets `in_cart`. Because the cart API is write-only and unreadable, states past `in_cart` are **user-asserted**: "I placed the order" → `ordered`; "I picked up the groceries" → `received` (terminal: entry removed + pantry restocked for `grocery`-kind items). A stale-cart reminder fires at the start of a new order if the prior list is still `in_cart`.
- **Partial-failure honesty** — the SKU-cache commit and the cart write are independent best-effort ops (the SKU cache is a hint). `place_order` returns honest partial status and never claims a populated cart when the write failed.
- **Kroger `authorization_code` OAuth (PKCE)** — a one-time `/oauth/*` callback route in the Worker for the token exchange, plus automatic refresh. Kroger refresh tokens are **single-use/rotating**, so the refresh token lives in a **KV namespace** (one key): write the new refresh token to KV **before** using the access token; a rejected refresh returns `{ error: "reauth_required" }`, never a silent failure. This is the Worker's one piece of persistent state.
- **`/oauth/*` Access carve-out** — the Kroger callback must bypass Cloudflare Access (Kroger's redirect carries no Access JWT); it is protected by OAuth `state`/PKCE instead. The cart-write restriction from Change 06's `mcp-server` spec is lifted.

## Capabilities

### New Capabilities
- `order-placement`: the `place_order` tool (whole-list resolution → cart write → SKU-cache persistence), the `active→in_cart→ordered→received` lifecycle including the user-asserted transitions and pantry restock on receive, order-time dedup, the partial/quantity prompt, and honest partial-failure reporting.
- `kroger-user-auth`: the Kroger `authorization_code` + PKCE flow — the one-time `/oauth/*` callback route, automatic token refresh, and the KV-backed single-use refresh-token rotation (write-before-use; `reauth_required` on rejection).

### Modified Capabilities
- `mcp-server`: lift the cart-write/external-call restriction (cart writes are now permitted behind the gate) and add the `/oauth/*` Access carve-out for the Kroger callback.

## Impact

- **Worker (`worker/`):** new `place_order` tool; a Kroger user-context auth client (authcode + PKCE + refresh); an `/oauth/*` route group (init + callback); reuse of the Change 05 matcher and the Change 06 atomic-commit engine for the SKU-cache write.
- **State:** a **KV namespace** (new) holding the rotating Kroger refresh token — the Worker's first persistent storage. Added to `wrangler.jsonc`.
- **Secrets/config:** Kroger `authorization_code` app credentials (client ID/secret may be the existing Kroger app or a new one with a redirect URI) as Worker secrets; the OAuth redirect URI registered with Kroger.
- **Infra:** a Cloudflare Access **bypass policy** for `/oauth/*` on the gated hostname.
- **Repo data:** `skus/kroger.toml` gains entries as orders resolve; `grocery_list.toml` items advance through the lifecycle and clear on receive; `pantry.toml` restocked on receive.
- **Docs:** `docs/TOOLS.md` (`place_order` semantics, lifecycle), `CLAUDE.md` (order-placement orchestration, stale-cart reminder), `worker/README.md` (Kroger OAuth + KV setup, `/oauth/*` carve-out).
- **Dependencies:** Change 05 (matching pipeline) and Change 06 (commit engine, grocery-list, Access gate) — both archived.
