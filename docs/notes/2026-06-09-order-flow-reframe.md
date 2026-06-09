# Order-flow reframe — capture/flush split + grocery list

**Status:** exploration note (not yet a formal OpenSpec change). Seeds a re-cut of
roadmap Change 06.
**Date:** 2026-06-09
**Context:** explored at the Change 05→06 boundary (Kroger read tools archived; no
write path, OAuth, KV, or auth gate exists yet).

---

## The core insight

`write_cart_and_commit` (as specced in `docs/TOOLS.md`) fuses two categorically
different operations:

1. **Persist memory** — git commit of `last_cooked`, pantry, drafts, SKU cache.
   Atomic, retryable, lives in a *fully mutable* store (the repo).
2. **Place an order** — `PUT /cart/add` to Kroger. External, **write-only**
   (no remove, no checkout, no read), un-rollback-able.

The repo commits exist for **memory's sake**, not the cart's — the repo *is* the
database (conversations are stateless, start fresh, so anything remembered across
them must be committed). The cart write was never *why* we commit; it got bolted
onto the commit by one overloaded tool. **Un-fusing them is the reframe.**

### The principle: opposite mutability → opposite write cadence

```
   MUTABLE store (git repo)              APPEND-ONLY store (Kroger cart)
 ┌──────────────────────────────┐     ┌──────────────────────────────────┐
 │ edit / remove / rewrite freely│     │ add only — no remove, no checkout │
 │ cheap to touch continuously   │     │ every touch leaves un-removable   │
 │                               │     │ cruft you prune by hand later     │
 └──────────────────────────────┘     └──────────────────────────────────┘
          ▲ capture HERE,                        ▲ flush HERE,
          │ continuously                         │ once, at order time
```

Capture intent continuously into the mutable store all week; flush to the
append-only cart exactly once, when ready to review-and-checkout in the Kroger
app. Given the API is write-only, batching the cart to order-time is both cleaner
architecture *and* better UX (a cart dribbled into since Tuesday accumulates items
you can't remove via API).

`grocery_list.toml` is the buffer that makes this possible.

---

## Three-file state model — three distinct facts

```
  pantry.toml          what's physically in the kitchen        OBSERVATION (truth)
    quantity: low/out      "I'm running low on olive oil"
  stockup.toml         standing conditional watchlist          CONDITIONAL intent
    buy_at_or_below        "buy rice IF it drops below $X"
  grocery_list.toml    explicit "buy this next order"          COMMITTED intent  (NEW)
    (vague, ingredient-level, no SKU)
```

Observation (`pantry` is low) ≠ intent (`buy it`). They are different facts and
must not be conflated:
- An item can be **low but you don't want to rebuy** (using it up, switching).
- An item can be **on the list but not low** (stocking up, a new recipe needs it).

**Why the list must be explicit, not derived from pantry:** "out" *destroys* the
signal. Running out = the item is **removed** from `pantry.toml`, so pantry-absence
carries no "buy me" breadcrumb. "Low" leaves a trace; "out" does not. Only an
explicit list durably remembers a rebuy intent.

### Transitions are always prompted, never automatic

(consistent with CLAUDE.md "never auto-decide on consequential choices")

```
  "I'm low on olive oil"  → pantry.quantity = low  (breadcrumb stays) + PROMPT "add to list?"
  "I'm out of olive oil"  → remove from pantry      (no breadcrumb)    + PROMPT "add to list?"
  stockup item hits price → (flyer/menu pass)                          + PROMPT "add to list?"
  menu agreed             → needed ingredients                          → list (the menu IS the intent)
```

Two prompting moments:
- **At capture (primary):** when Casey says low/out, ask "want that on the next
  order?" Keeps the list current.
- **At order time (backstop):** before resolving, sweep `pantry.toml` for `low`
  items not already on the list and surface as a batch.

---

## Order lifecycle state machine

The agent **cannot read the Kroger cart or verify checkout** (write-only API). So
every state past "pushed to cart" is **user-asserted, never agent-verified** —
mirrors the existing honesty rule ("never claim items were removed from the cart").

```
  active ──[place_order: resolve list → PUT /cart/add]──► in_cart
                                                            │
                              "I placed the order" ─────────▼
                                                          ordered ──► (suppresses re-prompt
                                                            │           even though pantry
                          "I picked up the groceries" ──────▼           still reads `low`)
                                                          received ──► flip pantry quantities
                                                                       back to full; clear from
                                                                       active list
```

- **`place_order`** (agent action, 06b): resolves the whole list against *current*
  availability, pushes to cart, marks items `in_cart`. The agent *believes* these
  are in the cart (it pushed them) but cannot confirm.
- **"I placed the order"** (user assertion): `in_cart → ordered`. Suppresses
  re-prompting. Pantry stays `low`/absent — nothing physical has changed yet.
- **"I picked up the groceries" / "order arrived"** (user assertion):
  `ordered → received`. **This is the loop closure** — the restock physically
  arrived, so pantry quantities flip back to full and the items clear from the
  active list. Casey corrects exceptions ("they were out of basil").

**Cross-session stale cart (DECIDED — accepted, not engineered around).** Casey
places the order himself (clicks the button), sanity-checks, and removes items as
needed. If he doesn't place the order in the same session the cart was built, he
clears the Kroger cart manually before the next order. So the agent does **not**
solve dedup/stale-cart against the write-only API. Posture: at the start of a new
order, if the prior list is still `in_cart` and was never confirmed `ordered`,
remind him to clear the cart manually first — then proceed. He confirms placement;
the agent trusts the assertion.

---

## Brand/availability drift — deferral is the fix

Because the list holds **ingredient-level intent, never a SKU**, there is nothing
to go stale between capture and order. All resolution happens once, at order time:

```
  OLD (resolve at add-time):  add → pin SKU#123 ──[3 days]──► SKU#123 unavailable → stale cart  ✗
  NEW (resolve at order-time): add "olive oil" ──[3 days]──► resolve NOW vs current availability ✓
```

Change 05's matcher already does the right things at order time:
- cache hit → **revalidated** for current price + curbside/delivery availability;
  unavailable → re-resolve (no TTL).
- preferred brand gone → `[brands]` is a *ranked soft score*, not a hard filter →
  falls to next acceptable brand automatically.
- genuinely unavailable / ambiguous → surfaces at the **order-time resolution
  checkpoint** as a batch ("3 items need a call before I build the cart").
- `stockup.toml` item no longer ≤ `buy_at_or_below` → natural prompt.

"Resolve as late as possible, exactly once, against current reality." The
write-only cart is *why* — you can't fix a stale cart entry via API.

---

## Resulting change re-cut (preserves the security property)

The roadmap bundled write tools + cart + OAuth + Cloudflare Access into one
Change 06 so "the first write and its gate ship together." But that conflates
*"the gate must precede the first write"* (true) with *"the gate ships with the
**cart** write"* (false — it must ship with the first **git** write, which is
earlier). The capture/flush split gives a principled seam:

```
  06  — git WRITE path + atomic commit + Cloudflare Access  (NO Kroger, NO OAuth, NO KV)
        update_recipe, update_pantry, mark_pantry_verified, add/update_ready_to_eat,
        update_*config, grocery-list tools (add/read/remove/promote), commit_changes,
        the atomic-commit engine (Git Data API: tree → commit → update ref).
        Gate goes up here — before any write tool exists.

  06b — ORDER placement  (behind the already-secured Worker)
        place_order (resolve grocery_list → cart + commit SKU cache),
        order-lifecycle actions ("placed" / "picked up"),
        authcode OAuth + PKCE, /oauth callback, KV refresh-token rotation,
        Access carve-out for /oauth/*.
```

This also re-cuts the overloaded `write_cart_and_commit`:
- `commit_changes` becomes the **everyday persist path** (06).
- `place_order` becomes the **order-time flush** (06b).

### Partial-failure dissolves

Nothing in the repo is transactional with the cart. Repo commit = pure git, fully
retryable. At order time, cart write + SKU-cache commit are two **independent
best-effort** ops — SKU cache is just a hint, so either failing alone corrupts
nothing.

---

## `grocery_list.toml` schema (DECIDED 2026-06-09)

Matches repo TOML conventions (`[[items]]`, snake_case, ISO dates, loose quantity
strings, `null` for absent). Agent-writable side-effect file (joins the
pantry/recipes "update as side effects" bucket, NOT the curated-config bucket).

```toml
# [[items]]
# name = "extra virgin olive oil"   # order-time search term (required)
# quantity = "1 bottle"             # loose BUY amount: count | "1 bottle" | "enough for the week"
# kind = "grocery"                  # grocery | household | other  (non-grocery skip pantry reconcile)
# status = "active"                 # active | in_cart | ordered   (required)
# source = "pantry_low"             # ad_hoc | menu | pantry_low | stockup
# for_recipes = []                  # recipe slugs needing it (menu-derived); drives qty aggregation + dedup
# note = null                       # freeform: one-off brand request, occasion, etc.
# added_at = "2026-06-09"           # ISO date (required)
# ordered_at = null                 # ISO date set when status → ordered; else null
```

Field rationale:
- `name` — the only thing the order-time matcher needs; **no SKU** (the "vague list" point).
- `quantity` — the **buy** amount, loose like pantry. Recipe-level needs are NOT
  stored; they're re-aggregated from `for_recipes` at prompt time (keeps the
  no-portion-math stance).
- `kind` — `grocery`/`household`/`other`. Earns its keep at **receive**: only
  `grocery` items flip a pantry quantity; household/other never pantry-reconcile.
  Makes non-food a clean first-class citizen (general shopping list).
- `status` — lifecycle. `received` is NOT stored: it's terminal (entry deleted +
  pantry restocked), keeping the file current-only like pantry.
- `source` — provenance for dedup/behavior: `pantry_low`/`stockup` were promoted
  (don't re-prompt); `menu` aggregates with recipe needs; `ad_hoc` is a one-off.
- `for_recipes` — powers "how much does the plan need" aggregation + order-time
  dedup against menu needs. Empty for ad-hoc/non-food.
- `note` — home for a **one-off** brand request ("the fancy olive oil this time"),
  explicitly NOT `preferences.toml` (transient, not a standing disposition).
- `ordered_at` — drives the stale-cart reminder (prior list `in_cart`, never
  `ordered` → remind to clear manually).

Schema-implied behaviors (live in tools/CLAUDE.md, not the file): merge-on-add by
normalized `name`; `active→in_cart` on `place_order`; `in_cart→ordered` on "I
placed the order"; `ordered→`removed + pantry restock (grocery only) on "I picked
up"; order-time dedup `list ∪ menu-needs − pantry-has`.

## New design surface (small, bounded)

- `grocery_list.toml` schema (SCHEMAS.md entry) — ingredient-level, loose quantity
  (inherits the no-portion-math / "whiteboard problem" stance), provenance
  (source recipe / ad-hoc), and lifecycle state (`active`/`in_cart`/`ordered`).
- Grocery-list tools: add / read / remove / promote-from-pantry.
- Order-lifecycle actions: `place_order`, "I placed the order", "I picked up".
- Order-time dedup rule: to-buy = `grocery_list ∪ (menu needs) − (pantry has)`.
- CLAUDE.md updates: capture-vs-flush behavior, prompting rules, honesty rule that
  order states past `in_cart` are user-asserted.

---

## Decisions (resolved 2026-06-09)

- **Cart idempotency / stale cart — accepted limitation, human-in-the-loop.**
  Casey clicks place-order, sanity-checks, removes items manually, and clears a
  stale cart himself before the next order. The agent does not engineer dedup
  against the write-only API. See the "Cross-session stale cart" note in the
  lifecycle section above.
- **Partials → prompt, don't auto-net.** When pantry holds a *partial* of an
  ingredient the plan needs, the agent (a) **tells Casey how much the meal plan
  needs** (aggregated from the recipes' stated ingredient amounts) and (b) **asks
  him to verify he has enough**, else add to the list. Default buy quantity is
  1 package unless told otherwise; this prompt is the partial-specific exception.
  *Note:* summing recipe-stated amounts to inform a prompt is **not** a violation
  of the no-portion-math / "whiteboard problem" rule — that rule forbids tracking
  how much of a *prepared/leftover* item remains, not reading and totalling
  recipe ingredient quantities.
- **Non-food tracking — intended feature, not just tolerated.** The grocery list
  naturally handles household / non-food items ("paper towels"). Embrace it: the
  schema allows free-form items with no pantry/recipe counterpart, broadening the
  list into a general shopping list. They still resolve via
  `match_ingredient_to_kroger_sku` at order time.

## Spike: Cloudflare Access ↔ Claude.ai web auth (RESOLVED 2026-06-09)

**Question:** how does Claude.ai (web), a machine MCP client, authenticate through
Cloudflare Access in front of the Worker (leg 2)?

**Findings (verified against Cloudflare + Anthropic docs):**
- **Service tokens are RULED OUT.** Claude.ai *web* custom connectors support
  **only OAuth** — no custom headers, no static bearer. Custom-header support is
  an open, unshipped feature request (anthropics/claude-ai-mcp issues #10, #112).
  So `CF-Access-Client-Id/Secret` header auth cannot be sent by the web client.
  (Claude Code/Desktop *do* support headers, but the use case is web-on-phone.)
- **Resolution: Cloudflare Access "Managed OAuth."** Access becomes the OAuth
  authorization server: emits `WWW-Authenticate` → `/.well-known/oauth-authorization-server`,
  runs Dynamic Client Registration (RFC 7591) + PKCE (RFC 7636) + token issuance
  on behalf of the app. The Worker needs **no MCP-facing OAuth code** — it just
  validates `Cf-Access-Jwt-Assertion` (or trusts Access fronting it). Identity
  policy (only Casey's email) is enforced at the Access layer. Cloudflare docs
  name this the correct method for browser-based clients like Claude.ai. One-click
  to enable. **Caveat: open beta** — re-verify availability before Change 07.
- **Fallback if beta is unacceptable:** `workers-oauth-provider` (CF TS library)
  adds the OAuth provider endpoints *in* the Worker. More code, not beta-dependent,
  still standard-OAuth (works with Claude.ai web).

**Conclusion:** leg 2 is solvable; **Change 07 does not dead-end.** The 06
"Access in front" deliverable shrinks to mostly Cloudflare config + a one-click
toggle, with optional JWT-assertion validation in the Worker.

**Design clarifications from the spike:**
- **Two distinct OAuth flows — do not conflate.** Access-Managed-OAuth handles
  leg 2 (Claude.ai → Worker) *for* the Worker. Leg 3 (Worker → Kroger) is the
  Worker acting as an OAuth *client* (authcode + PKCE + KV refresh-rotation),
  unaffected by this finding and still owned by 06b.
- **`/oauth/*` carve-out still required.** The Worker's Kroger callback must bypass
  Access (Kroger's redirect carries no Access JWT). Managed OAuth adds Access's own
  well-known/authorize/token endpoints in front — confirm no path collision with
  the Worker's `/oauth/callback` at build time.

Sources: Cloudflare "Managed OAuth for Access" blog; Cloudflare One "Secure MCP
servers" docs; anthropics/claude-ai-mcp issues #10 and #112.

## Open questions still on the table

1. **Atomic-commit second-writer race** (carried over, blast radius shrunk).
   Mid-week list/pantry writes touch non-indexed files → no index-regen Action →
   no second writer for the common case. The recipe/index-touching commit happens
   ~once per order, so the optimistic-ref-update-with-retry is exercised rarely
   but still required.
