# MIGRATION — single mono-repo → code repo + one private data repo

This runbook splits the original `caseyWebb/groceries` mono-repo (code **and** data) into:

1. **This repo** — `caseyWebb/groceries-agent` (renamed from `groceries`), the **code-only upstream** (`worker/`, `docs/`, `openspec/`, `scripts/`, `site/`, `tests/`). Self-hosters clone and deploy it; they never fork-and-diverge. It also hosts the **reusable CI workflows** (`.github/workflows/data-build-*.yml`) that data repos call.
2. **One private data repo** on the operator's personal account (no org) holding **all** the data:

```
<data-repo>/
├── recipes/                # shared content (objective frontmatter + body)
├── aliases.toml  ingredients.toml  substitutions.toml  flyer_terms.toml
├── skus/  ready_to_eat/  _indexes/
└── users/
    └── <username>/         # one subtree per member
        pantry.toml  preferences.toml  stockup.toml  grocery_list.toml
        taste.md  diet_principles.md  cooking_log.toml  meal_plan.toml  feeds.toml
        overlay.toml  notes/
```

> **The data repo is PRIVATE.** It holds every member's personal state, so it cannot be public; recipes are no longer world-public (reversing the 2026-06-08 posture). Members read recipes through the agent, not GitHub. They need **no GitHub account** — the Worker writes on their behalf via the GitHub App; identity is an invite code (§3).
>
> **Nothing here is automatic or destructive until you say so.** The staging script only *reads* the live repo and writes a throwaway `.migration/` tree. You create the repo and push; you delete root data only after verifying.

## 1. Decide names

- **Data repo**: e.g. `grocery-data` on your personal account (`caseyWebb/grocery-data`). Private.
- **Your username**: an opaque slug, e.g. `operator` (the default) or your handle. It names your `users/<username>/` subtree, your overlay, and your `kroger:refresh:<username>` key.

## 2. Stage the data repo (non-destructive)

```bash
node scripts/migrate/build-data-repos.mjs --tenant operator
```

Writes `.migration/data/` (gitignored): shared content + reference at the root, your personal files under `users/operator/`. It transforms each recipe — objective frontmatter stays in `recipes/`; `rating`+`status` go to `users/operator/overlay.toml`; `last_cooked` is dropped (it's derived from `cooking_log.toml`, copied across intact). **Read the warnings** — any recipe whose `last_cooked` wasn't reflected in `cooking_log.toml` is flagged so no cooked-history is lost.

Review:

```bash
find .migration/data -maxdepth 2
sed -n '1,30p' .migration/data/recipes/american-chop-suey.md       # no rating/status/last_cooked
sed -n '1,12p' .migration/data/users/operator/overlay.toml          # captured the dispositions
```

## 3. Create the private repo and push

```bash
gh repo create <you>/grocery-data --private
( cd .migration/data && git init -b main && git add -A \
    && git commit -m "Seed data repo from single-repo migration" \
    && git remote add origin git@github.com:<you>/grocery-data.git && git push -u origin main )
```

## 4. Register the GitHub App (no org)

Register a GitHub App on your **personal account** and install it scoped to **just** `<you>/grocery-data` (Contents: read+write). No org required — Apps install on personal accounts. Capture the **App id**, the **installation id**, and download the **private key** (PKCS#8 PEM). Full step-by-step lands in **§9.1 (`docs/SELF_HOSTING.md`, pending)**.

```bash
cd worker
wrangler secret put GITHUB_APP_PRIVATE_KEY   # paste the PEM
```

## 5. Wire the Worker to the data repo

In `worker/wrangler.jsonc` `vars` (scaffolded by §1.3):

```
DATA_OWNER = "<you>"
DATA_REPO  = "grocery-data"
DATA_REF   = "main"
DATA_USER_PREFIX = "users/operator"     # was "" pre-migration; set it once data has moved
GITHUB_APP_ID          = "<app id>"
GITHUB_INSTALLATION_ID = "<installation id>"
```

Create the tenant-directory KV namespace and allowlist your username:

```bash
npx wrangler kv namespace create TENANT_KV     # paste the id into wrangler.jsonc
npx wrangler kv key put --binding=TENANT_KV "tenant:operator" '{"id":"operator"}'
```

(The directory is just the allowlist now — repo coords, install, and the `users/<id>` prefix are all global/derived.) Until the OAuth provider (§3) lands, the Worker resolves the single operator tenant from env (`tenantFromEnv`) behind Cloudflare Access, so the deployment keeps working through the migration.

## 6. Wire the data repo's CI (indexes + site)

The build scripts live only in the code repo; the data repo's CI **calls them** via reusable workflows (`caseyWebb/groceries-agent/.github/workflows/data-build-*.yml`). The `groceries-agent-data-template` repo carries the two thin caller workflows + a `.gitignore`. Because your `groceries-agent-data` was seeded from the migration staging (not created from the template), copy the CI into it once:

```bash
# from a clone of caseyWebb/groceries-agent-data
gh repo clone caseyWebb/groceries-agent-data-template /tmp/tmpl
cp -r /tmp/tmpl/.github . && cp /tmp/tmpl/.gitignore .
git add .github .gitignore && git commit -m "Add CI (calls groceries-agent reusable workflows)" && git push
```

- **Pages needs GitHub Pro** — publishing a public Pages site from a private repo requires it ([GitHub plans](https://docs.github.com/get-started/learning-about-github/githubs-products)). Enable Pages on `groceries-agent-data` (Source: GitHub Actions). The site renders **only** `recipes/` (never `users/`), so no personal data is exposed.
- Runs are billed to **your** account (the caller), not the code repo's, and count against your private-repo Actions allowance (covered by the same Pro plan).
- Trigger the workflows (push to `recipes/` or `workflow_dispatch`) to regenerate `_indexes/` and deploy the site. The staged `_indexes/` is a verbatim copy that still carries subjective fields — the CI run replaces it with the clean (subjective-stripped) index. *(It's not actually blocking the Worker: `read`/`list_recipes` overlay the caller's own rating/status/last_cooked, overwriting whatever the stale index carries — but regenerating is the clean state.)*

## 6b. Re-run Kroger consent

The refresh-token key moved to `kroger:refresh:<username>` (§4). Re-run consent so your token lands under the new key (`DATA_TENANT_ID` is your id, e.g. `casey`):

```
GET https://<worker-host>/oauth/init?tenant=casey
```

## 7. Make this repo code-only (§5.0) — LAST, after verifying

Only once `<you>/grocery-data` is pushed, the Worker points at it, and a full menu→order flow works (§10.1):

```bash
git rm -r recipes _indexes ready_to_eat skus \
  aliases.toml ingredients.toml substitutions.toml flyer_terms.toml \
  pantry.toml preferences.toml stockup.toml grocery_list.toml \
  taste.md diet_principles.md cooking_log.toml meal_plan.toml feeds.toml
git commit -m "§5.0: this repo is now the code-only upstream; data lives in <you>/grocery-data"
```

Keep `scripts/migrate/` and this runbook — they provision the next member.

## Onboarding another member later

Re-run step 2 with `--tenant <username>` to stage their `users/<username>/` subtree (overlay starts empty → everything reads `draft` until they disposition recipes). Copy that subtree into the data repo and push, allowlist `tenant:<username>` in `TENANT_KV`, and hand them their invite code (§3.2) + the connector URL. The shared `recipes/` are reused, not re-created — that's the collaborative cookbook.
