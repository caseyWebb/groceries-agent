# grocery-mcp Worker

Cloudflare Worker hosting the grocery agent's custom MCP server. Change 04
implemented the **read-only, repo-data-backed** tools; Change 05 adds the
**Kroger-facing reads** and the ingredient→SKU matching pipeline. The Worker
stays authless and stateless — every Change 05 tool uses the `client_credentials`
grant, so there is still no write surface and no persistent storage (those, plus
the Cloudflare Access gate, land in Change 06).

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

Failures return a structured `{ error, message, ... }` (codes: `not_found`,
`index_unavailable`, `upstream_unavailable`, `malformed_data`, `unsupported`) —
never a raw throw. Upstream Kroger failures (after retries) map to
`upstream_unavailable`; the matcher's `unavailable` is a tool **result**, not an
error.

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
  (`contents:read+write`; write scope reserved for Change 06).
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

## Observability

`observability.enabled` is on in `wrangler.jsonc`. Tail live logs with:

```sh
npx wrangler tail
```
