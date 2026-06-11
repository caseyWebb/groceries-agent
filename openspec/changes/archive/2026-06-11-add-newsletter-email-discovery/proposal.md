## Why

Pull discovery (Change 10's `fetch_rss_discoveries`) cannot reach the sources Casey most wants — Serious Eats and Food52 bot-wall the Worker via TLS/bot-management fingerprinting (not a UA check, so headers can't recover them), and NYT Cooking is paywalled. A *push* source inverts the block: when a publisher emails a teaser, discovery becomes unblockable because the content arrives at us. This adds inbound-email discovery as the complement to RSS — and, in doing so, fixes a model mismatch the multi-tenant split left behind: discovery sources are currently per-tenant (`users/<id>/feeds.toml`), but the recipes they produce are *shared corpus*. Discovery is staging for shared content, so its sources belong at the shared root, not siloed per member.

## What Changes

- **Discovery sources move to the shared root.** `feeds.toml` relocates from `users/<id>/feeds.toml` to the data-repo root, read through the shared GitHub client. A new shared `discoveries_inbox.toml` (email candidates) and a shared sender/forwarder allowlist live beside it. Anyone in the friend group can widen the group's intake; everyone sees the pooled candidates and judges them against their own taste at menu time. **BREAKING**: existing per-tenant `feeds.toml` files must be merged up to the root and removed.
- **Inbound-email intake.** The existing Worker gains an `email()` handler; Cloudflare Email Routing on a dedicated spare domain delivers mail for `groceries-agent@<domain>` to it. The handler authenticates the message (DKIM/SPF/DMARC), gates it against the allowlist, unwraps tracker-wrapped links to canonical URLs, extracts candidate recipes, and appends them to `discoveries_inbox.toml` via the commit engine.
- **Forwarder-only model, both forward forms.** `groceries-agent@` is never subscribed directly (sidesteps confirm-links and paywalls — the member's own inbox handles those). Members feed it by **auto-forward rules** (`From` stays the newsletter sender → keyed on the trusted *sender*) and by the **manual "Forward" button** (`From` becomes the member → keyed on the trusted *member*; original body arrives nested in a forward wrapper). The allowlist is a union of trusted senders and trusted members; the extractor is robust to forward-wrapper nesting.
- **Deterministic, two-layer dedup.** Candidates dedup by **unwrapped canonical URL** — at inbox write-time against the corpus + existing inbox + RSS pool, and again at import-time (existing `create_recipe` corpus dedup). No title matching, no LLM in the dedup path.
- **Surfacing.** A new `read_discovery_inbox` read tool returns the pooled, deduped inbox candidates; the meal-plan flow surfaces them alongside the RSS pool at menu time. Import stays split: present clean link → user pastes recipe text → `create_recipe` (walls still block the full-recipe fetch, degrades to manual paste).

The `/follow-source` skill and its `update_feeds` / `update_discovery_sources` write tools are an intentional **follow-on** (they consume the infrastructure this change establishes) — noted in tasks, not built here.

## Capabilities

### New Capabilities
- `newsletter-discovery`: inbound-email recipe discovery — the `email()` handler, the shared allowlist (trusted senders + members) and authentication gate, both forwarding forms, tracker-link canonical unwrapping, forward-wrapper-robust candidate extraction, the shared `discoveries_inbox.toml`, the `read_discovery_inbox` tool with two-layer canonical-URL dedup, and menu-time surfacing.

### Modified Capabilities
- `recipe-discovery`: `feeds.toml` relocates from the per-tenant subtree to the shared data-repo root and is read through the shared GitHub client (previously personal). RSS candidate dedup is unchanged in mechanism but now shares the canonical-URL key with the email inbox pool.

## Impact

- **Code**: `src/discovery-tools.ts` (`feeds.toml` read switches `personalGh` → `sharedGh`; add `read_discovery_inbox`); new `email()` export on the Worker entrypoint with a handler module (allowlist gate, auth-result checks, MIME/forward-wrapper parse, link unwrap, commit). Reuses `discovery.ts` (`canonicalizeUrl`, `extractRecipeSources`), `commit.ts`, `github.ts`.
- **`caseyWebb/groceries-agent-data` (live repo, BREAKING migration)**: move every `users/<id>/feeds.toml` up to a single merged root `feeds.toml`; add root `discoveries_inbox.toml` + the allowlist config seeded with the real friend-group members; redeploy the Worker (the new `email()` handler) via the data-repo `deploy.yml`.
- **`caseyWebb/groceries-agent-data-template` (template for new operators)**: relocate `feeds.toml` from the per-tenant block to the shared-root block in `README.md` (it documents `feeds.toml` under `users/<username>/` today), seed a root `feeds.toml`, add an empty root `discoveries_inbox.toml` and an allowlist stub, and document the Email Routing / spare-domain setup. Bump the vendored submodule pin at `docs/data-template/` afterward.
- **This repo (code/docs)**: `docs/SCHEMAS.md` entries for the two new files + the relocated `feeds.toml`; `CLAUDE.md` shared-root file list + curated-config (allowlist) line.
- **Infra**: a spare domain added to Cloudflare with Email Routing enabled, a catch-all/route to the Worker, and the newsletter address documented in `docs/SELF_HOSTING.md`. No new runtime dependency (parsing stays hand-rolled, runtime-agnostic per the existing discovery constraint).
- **Docs**: `docs/TOOLS.md` (`read_discovery_inbox`; feeds-now-shared note), `docs/PROJECT.md` (discovery sources are shared).
- **Out of scope (follow-on)**: the `/follow-source` skill, `update_feeds`, `update_discovery_sources`.
