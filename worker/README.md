# grocery-mcp Worker

Cloudflare Worker hosting the grocery agent's custom MCP server. Change 04
implemented the **read-only, repo-data-backed** tools; Change 05 added the
**Kroger-facing reads** and the ingredient→SKU matching pipeline; Change 06 adds
the **repo-data write tools**, the `grocery_list.toml` buy list, the atomic
batched-commit engine, and the **Cloudflare Access** identity gate. The Worker is
no longer authless. It remains stateless with no KV — the Kroger cart write,
`authorization_code` OAuth, and the KV refresh-token slot land in Change 06b.

## Tools

### Repo-data reads (Change 04)

All read only the GitHub repo and return structured JSON:

| Tool | Reads | Notes |
|------|-------|-------|
| `list_recipes(filters)` | `_indexes/recipes.json` | AND on array filters; `status` defaults to `active`, `"all"` opts out; `exclude_cooked_within_days` is a param |
| `read_recipe(slug)` | `recipes/<slug>.md` | returns `{ slug, frontmatter, body }` |
| `read_pantry(filter)` | `pantry.toml` | `category` + `prepared_only`; `stale_only` is `unsupported` until `ingredients.toml` (Change 12) |
| `read_preferences()` | `preferences.toml` | parsed |
| `read_taste()` | `taste.md` | raw markdown |
| `read_diet_principles()` | `diet_principles.md` | raw markdown |

### Kroger reads + matching (Change 05)

| Tool | Notes |
|------|-------|
| `kroger_prices(ingredients)` | per-ingredient `{ regular, promo }` price + curbside/delivery availability |
| `kroger_flyer(filter)` | synthesized sale scan: precise terms + broad `flyer_terms.toml`, keeps `promo > 0`, deduped by `productId` |
| `ready_to_eat_available()` | cross-references `ready_to_eat/*.toml` against curbside/delivery fulfillment |
| `compare_unit_price(items)` | deterministic price-per-unit, dimension-bucketed; the LLM never does the arithmetic |
| `match_ingredient_to_kroger_sku(ingredient, context)` | resolve-only 7-step pipeline → confident / `ambiguous` / `unavailable`; never writes the cache, never substitutes |

`kroger_search` is an **internal** helper (term + `locationId` + fulfillment) that
the Kroger tools and the matcher call; it is deliberately **not** registered as
an MCP tool.

### Repo-data writes (Change 06)

All persist via the atomic commit engine (`src/commit.ts`) — one tool call → one
commit, structurally validated first. No tool here writes a Kroger cart.

| Tool | Writes | Notes |
|------|--------|-------|
| `update_recipe(slug, updates)` | `recipes/<slug>.md` | merge frontmatter |
| `update_pantry(operations)` | `pantry.toml` | add/remove/verify; returns `{ applied, conflicts }` |
| `mark_pantry_verified(items)` | `pantry.toml` | reset `last_verified_at` |
| `add_draft_ready_to_eat(items)` | `ready_to_eat/<meal>.toml` | each item needs a `meal` |
| `update_ready_to_eat(name, updates)` | `ready_to_eat/<meal>.toml` | matched by name across meals |
| `update_{preferences,taste,diet_principles,substitutions,aliases}(content)` | the curated file | content-faithful; call only when the user directs an edit |
| `read/add/update/remove_grocery_list` | `grocery_list.toml` | SKU-free buy list; `add` merges by normalized name |
| `commit_changes(payload)` | many | batches a whole session into one commit |

Failures return a structured `{ error, message, ... }` (codes: `not_found`,
`index_unavailable`, `upstream_unavailable`, `malformed_data`, `unsupported`,
`validation_failed`, `conflict`) — never a raw throw. `validation_failed` means a
staged write didn't pass structural validation (nothing committed);
`conflict` means the branch kept advancing past the commit-engine retry bound.
The matcher's `unavailable` is a tool **result**, not an error.

## Architecture

- **Transport:** `createMcpHandler` (from `agents/mcp`) over Streamable HTTP —
  stateless, no Durable Objects, no KV. MCP endpoint is `POST /mcp`; `GET /`
  returns a health line.
- **Data access:** one authenticated GitHub client (`src/github.ts`) reads files
  at `GITHUB_REF` via the Contents API (raw media type), with retry/backoff.
- **Parsing:** `js-yaml` + a manual frontmatter split, `smol-toml` for TOML
  (`src/parse.ts`). No `gray-matter`. The `nodejs_compat` flag is enabled because
  the `agents` SDK needs it — our parsing code does not.

## Configuration

Non-secret repo coordinates are `vars` in `wrangler.jsonc`
(`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`). The secrets are:

- **`GITHUB_TOKEN`** — a fine-grained PAT scoped to the repo
  (`contents:read+write`; the write tools use the write scope via the Git Data API).
- **`KROGER_CLIENT_ID`** / **`KROGER_CLIENT_SECRET`** — a Kroger Developer
  (**public tier**) app's `client_credentials` credentials. Used by the Kroger
  client to mint access tokens for the public Products/Locations APIs.

Secrets are **never** committed. Set once via `wrangler secret put`; they persist
across deploys.

### One-time Kroger setup

1. Create an app at the [Kroger Developer portal](https://developer.kroger.com/)
   on the **public** tier. Note its **Client ID** and **Client Secret**.
2. Push the credentials as Worker secrets (production):

   ```sh
   npx wrangler secret put KROGER_CLIENT_ID
   npx wrangler secret put KROGER_CLIENT_SECRET
   ```
3. Add them to `.dev.vars` for local runs (gitignored — see below).

The preferred store is read from `preferences.toml` (`[stores].preferred_location`,
e.g. `"Kroger - 76104"`); the Worker resolves its ZIP to a Kroger `locationId`
via the Locations API and caches it. Pricing requires a `locationId`, so this
must be set for any priced tool to work.

## Local development

```sh
npm install

# Provide secrets for local runs. .dev.vars is gitignored — never commit it.
cat > .dev.vars <<'EOF'
GITHUB_TOKEN = "github_pat_..."
KROGER_CLIENT_ID = "..."
KROGER_CLIENT_SECRET = "..."
EOF

npm run dev          # wrangler dev (local Worker)
npm run typecheck    # tsc --noEmit
npm test             # vitest (pure logic: unit-price, matching, Kroger client, parsing, errors)
```

Point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at
the local URL's `/mcp` endpoint and call `list_recipes({ status: "active" })`.

> Gitignored-but-needed-to-run: **`.dev.vars`** (local secrets). Add any future
> local-only files to this list as they're introduced.

## First deploy (one-time, manual)

Requires a Cloudflare account and a `workers.dev` subdomain.

```sh
npx wrangler deploy                       # creates the Worker
npx wrangler secret put GITHUB_TOKEN        # paste the PAT
npx wrangler secret put KROGER_CLIENT_ID    # paste the Kroger client ID
npx wrangler secret put KROGER_CLIENT_SECRET # paste the Kroger client secret
```

After this, **CD owns every deploy**: a push to `worker/**` on `main` runs
[`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml),
which typechecks, tests, and deploys using the `CLOUDFLARE_API_TOKEN` Actions
secret. The Worker's own secrets are not touched by CD — they persist.

## Cloudflare Access gate (Change 06)

The Worker exposes write tools, so the MCP endpoint must not be public. It sits
behind **Cloudflare Access** with a policy that authorizes **only the owner's
identity**. Because the Claude.ai **web** client is OAuth-only (it can't send
custom headers, so Access **service tokens won't work**), use **Managed OAuth**:
Access becomes the OAuth authorization server, so the Worker needs no MCP-facing
OAuth code.

No custom domain needed — Access can protect the `*.workers.dev` URL directly.
Prereqs: a (free) **Zero Trust** organization and an identity method
(**One-time PIN** works for a single user — no external IdP).

One-time setup (Cloudflare **Zero Trust** dashboard, **manual** — not in CD):

1. **Access controls → Applications → Create new application → Self-hosted and
   private.**
2. **Add public hostname** → enter `grocery-mcp.<subdomain>.workers.dev` (root
   host only, **not** `/mcp`).
3. Add a **policy**: Allow, Emails = your email only.
4. **Advanced settings → enable Managed OAuth** (Access emits `WWW-Authenticate`
   → `/.well-known/oauth-authorization-server` and runs registration + PKCE +
   token issuance). Copy the **AUD tag** from Additional settings.

Access protects the whole hostname — no path carve-out is needed for this change
(`/mcp` is validated like everything else).

**In-Worker JWT validation (defense-in-depth, implemented).** `src/access.ts`
revalidates the `Cf-Access-Jwt-Assertion` header that Access injects, using `jose`
against the team's signing keys. This closes the gap if a request ever reaches
the Worker without passing Access (e.g. the un-gated `workers.dev` URL). It is
**config-gated**: enforced only when both `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`
(`vars` in `wrangler.jsonc`, both non-secret) are set — so local dev is
unaffected. `ACCESS_AUD` is the application's AUD tag; `ACCESS_TEAM_DOMAIN` is the
Zero Trust team domain, e.g. `casey.cloudflareaccess.com`. Leave
`ACCESS_TEAM_DOMAIN` blank to disable the in-Worker check (the edge gate still
applies).

> **Managed OAuth is in open beta.** Re-verify availability before wiring
> Claude.ai (Change 07). Fallback: [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
> implements the OAuth endpoints in the Worker itself (more code, not
> beta-dependent, still standard-OAuth so Claude.ai web works).
>
> Change 06b adds a Kroger OAuth callback at `/oauth/*` that **must bypass**
> Access (Kroger's redirect carries no Access JWT) — protected by OAuth
> `state`/PKCE instead. Confirm it doesn't collide with Access's own
> Managed-OAuth endpoints when that lands.

## Observability

`observability.enabled` is on in `wrangler.jsonc`. Tail live logs with:

```sh
npx wrangler tail
```
