## Context

Change 05 built the resolve-only Kroger matcher and the read-side `client_credentials` client; Change 06 built the atomic-commit engine, the SKU-free `grocery_list.toml`, and the Cloudflare Access gate (with `place_order` explicitly reserved for here). This change wires the order-time flush: list → resolved SKUs → cart, plus the user-context Kroger auth a cart write needs. The full reasoning (capture/flush, three-file model, lifecycle, brand-drift-by-deferral, partial-failure) lives in `docs/notes/2026-06-09-order-flow-reframe.md`.

## Goals / Non-Goals

**Goals:**
- `place_order`: resolve the whole list against *current* availability, write the cart once, persist learned SKUs.
- The order lifecycle (`in_cart → ordered → received`) with honest, user-asserted state past the cart write.
- Kroger `authorization_code` + PKCE with correct single-use refresh-token rotation in KV.
- Lift the cart restriction and carve `/oauth/*` out of Access.

**Non-Goals:**
- Reading or clearing the Kroger cart (the public API is add-only/unreadable — accepted human-in-the-loop from Change 06).
- Portion math / netting partials (prompt instead).
- Any menu-generation orchestration (Changes 08–09) — `place_order` is invoked when the user is ready to order.
- A Durable Object for token state (KV suffices — see below).

## Decisions

### Resolve at order time, over the whole list (late binding)
The list holds ingredient-level intent, never a SKU, so resolution happens once at `place_order` against current price + curbside/delivery availability via the Change 05 matcher (cache hits revalidated; stale → re-resolve). **Why:** the write-only cart can't be fixed via API, so binding as late as possible avoids stale entries. Ambiguous/unavailable items batch into one checkpoint rather than interrupting per-item.

### Cart write and SKU-cache commit are independent best-effort
Nothing in the repo is transactional with the cart. Persist the SKU-cache append via the Change 06 commit engine, then `PUT /v1/cart/add`; report both outcomes. **Why this order:** the SKU cache is a pure hint, so committing it first means a cart failure leaves the repo correct and the cart retryable; a commit failure after a successful cart just re-resolves next time. Either single failure corrupts nothing. `place_order` never claims a populated cart on cart-write failure.

### KV for the rotating refresh token, not a Durable Object
Kroger refresh tokens are single-use/rotating, so they need a writable slot. **Why KV over a DO:** single user, no coordination/strong-consistency need. The real hazard is *durability ordering*, not concurrency, and a DO wouldn't help that. Mitigation: on refresh, **write the new refresh token to KV before using the new access token**, so a crash mid-refresh can't strand the account on a consumed token. A Kroger-rejected refresh returns structured `{ error: "reauth_required" }` → re-run the one-time auth.

### `/oauth/*` carve-out, secured by state + PKCE
Kroger's redirect carries no Access JWT, so `/oauth/*` must bypass Cloudflare Access or the callback is blocked. It is secured by OAuth `state` (CSRF) + PKCE instead. The carve-out is scoped to `/oauth/*`; `/mcp` and everything else stay gated. This is configured as an Access bypass policy on the gated hostname.

### User-asserted lifecycle past the cart write
The agent cannot read the cart or verify checkout, so `ordered` and `received` are set only on the user's word ("I placed the order" / "I picked up"), mirroring the honesty rule from Change 06. `received` restocks `pantry.toml` for `grocery`-kind items only and clears the list entry. A stale-cart reminder fires when a new order starts with leftover `in_cart` items.

### Reuse, don't rebuild
`place_order` composes existing pieces: the Change 05 matcher for resolution, the Change 06 `commitFiles` engine for the SKU-cache write and any list/pantry mutations. New code is the cart-write subroutine, the user-auth client, and the `/oauth/*` routes.

## Risks / Trade-offs

- **Refresh-token brick window** → write-new-refresh-to-KV-before-use; `reauth_required` recovery path. The only unrecoverable case (KV write fails after Kroger consumes the old token) degrades to re-running the one-time auth — surfaced clearly, never silent.
- **Public Cart API is add-only / unreadable** → can't dedup or clear programmatically; accepted human-in-the-loop (user clicks place-order, prunes, and clears stale carts manually). `place_order` tracks `in_cart` belief but does not attempt API-level reconciliation.
- **KV eventual consistency** → a single key read on cold start then written on refresh; for one user this is effectively read-your-writes within an isolate, acceptable.
- **Cart-write scope/credentials unknowns** → see Open Questions; designed to fail structured if a scope is missing.

## Migration Plan

1. Register the `authorization_code` redirect URI (`https://grocery-mcp.<domain>/oauth/callback`) with the Kroger app; capture client ID/secret as Worker secrets (`wrangler secret put`).
2. Create the KV namespace; bind it in `wrangler.jsonc`.
3. Add a Cloudflare Access **bypass** policy for `/oauth/*` on the gated hostname.
4. Deploy (CD); run the one-time `/oauth/init` authorization to seed the refresh token.
5. `place_order` smoke against the live (sandbox if available) cart.

Rollback: `place_order` is additive; disabling it leaves the capture half (Change 06) fully functional.

## Open Questions

- **Cart scopes:** confirm the exact Kroger OAuth scope for `PUT /v1/cart/add` (commonly `cart.basic:write`) and that the public tier grants it.
- **One app or two:** confirm whether the existing Kroger app can carry both `client_credentials` (reads) and `authorization_code` (cart) grants + a redirect URI, or whether a second app is cleaner.
- **Token endpoint reuse:** whether the user-auth client can share the Change 05 Kroger client's token/backoff plumbing or warrants its own module (likely its own, given the refresh-rotation state).
