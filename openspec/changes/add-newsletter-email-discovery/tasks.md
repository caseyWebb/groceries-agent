# Tasks

## 1. Shared discovery sources (relocate feeds, add inbox + allowlist)

- [x] 1.1 Switch the `feeds.toml` read in `src/discovery-tools.ts` from `personalGh` to `sharedGh` (root path). *(Discovery is now fully shared, so the `personalGh` param was dropped from `registerDiscoveryTools` and its call site.)*
- [x] 1.2 Add `docs/SCHEMAS.md` entries: relocate `feeds.toml` to the shared-root section, add `discoveries_inbox.toml` (`{ from, subject, received_at, candidates: [{ title, summary, url }] }`), add the allowlist config (`[[members]]` / `[[senders]]`). *(Also updated the shared-vs-per-tenant placement list.)*
- [x] 1.3 Update `CLAUDE.md`: move `feeds.toml` out of the per-tenant list into the shared-root list; add `discoveries_inbox.toml` (agent-writable side-effect) and the allowlist (curated, widenable-via-tool) lines.
- [x] 1.4 Extend `scripts/build-indexes.mjs` validation for `discoveries_inbox.toml` and the allowlist (`validateDiscoveriesInbox` / `validateDiscoverySources`, wired into `run()`); fixtures incl. malformed-inbox + bad-address failure cases in `tests/build-indexes.test.mjs`. Worker-side `validateFile` got matching structural cases too.

## 2. Email intake (`email()` handler)

- [x] 2.1 Added an `email()` export to the Worker entrypoint (`src/index.ts`) that wraps the `OAuthProvider` (`fetch` + `email` in one Worker) and dispatches to `src/email.ts` via `ctx.waitUntil`; reuses GitHub App creds (`dataCoords` + `createInstallationAuth`) + `commit.ts`.
- [x] 2.2 Allowlist load + auth gate: `parseAllowlist` (root `discovery_sources.toml`) + `parseAuthResults` (Cloudflare `Authentication-Results`) + `gateMessage` — accepts (sender ∧ aligned-DKIM) | (member ∧ aligned-DKIM), drops everything else silently. **Relay-SPF path (c) deferred** (stubbed + TODO; can't verify without a live verdict — per the apply decision).
- [x] 2.3 Body parsing robust to both forward forms via **postal-mime** (apply decision — reverses the hand-rolled plan; workerd-compatible + Node-testable). `extractAnchors` scans every `href`, so auto-forward (intact) and manual-forward (nested wrapper) both yield links; fixtures for both.
- [x] 2.4 Tracker-link unwrapping: `decodeTrackerUrl` decodes query-encoded destinations with no network call; `followRedirect` follows opaque redirectors `redirect: "manual"` reading only `Location` (never downloads the body); `canonicalizeUrl` for the final form. `isLikelyContentLink` drops social/unsubscribe chrome.
- [x] 2.5 Candidate extraction → `InboxEntry`; `appendInboxEntry` writes the root `discoveries_inbox.toml` via the commit engine.
- [x] 2.6 Inbox write-time dedup: drop candidates whose canonical URL is in the corpus `source:` set (`extractRecipeSources`) or the existing inbox (`flattenInbox`). *(RSS-pool overlap is NOT fetched at write-time — it collapses at surfacing/import via the shared canonical key; spec + design reconciled to match.)*
- [x] 2.7 Unit tests (`test/email.test.ts`, 21): auth-gate matrix (both accept paths + 3 drop cases), auth-results parsing, forward-wrapper extraction, link unwrap (decode + follow-flag), content-link filter, dedup set-membership, allowlist add/dedup.

## 3. Surfacing (`read_discovery_inbox`)

- [x] 3.1 Implement `read_discovery_inbox` reading the shared inbox → `{ candidates: [{ url, title, summary, from, received_at }] }`, no taste `score`; empty/absent file → `{ candidates: [] }`. *(Pure `flattenInbox` helper in `discovery.ts` + tool in `discovery-tools.ts`.)*
- [x] 3.2 Updated `AGENT_INSTRUCTIONS.md` menu flow: `read_discovery_inbox()` added to the parallel context batch and the step-5 discovery bullet (combined pool with RSS, dedup by URL, paste-to-import for the walled inbox sources). *(Canonical source updated; the generated plugin bundle rebuilds at deploy with the operator's real MCP URL — `build:plugin` refuses the placeholder.)*
- [x] 3.3 `docs/TOOLS.md`: add `read_discovery_inbox` + `update_discovery_sources`; note `feeds.toml` is now shared/root.
- [x] 3.4 Tests for `read_discovery_inbox` (populated pool, empty/absent inbox). *(`flattenInbox` tests: flatten, cross-entry dedup, empty/malformed, no-url skip.)*

## 3b. Allowlist write tool (pulled in from the follow-on per the apply decision)

- [x] 3b.1 `update_discovery_sources({ members?, senders? })` in `discovery-tools.ts` — adds trusted members/senders to the shared `discovery_sources.toml` (pure `addSources` in `email.ts`, deduped by address), one commit. Rationale: anyone trusted with the MCP is trusted to widen intake. Tested in `test/email.test.ts`; documented in `docs/TOOLS.md`.

## 4. Data repos — EXTERNAL (operator runs against the other two repos)

- [ ] 4.1 **`caseyWebb/groceries-agent-data-template`:** in `README.md`, move `feeds.toml` from the per-tenant `users/<username>/` block to the shared reference-data block; add a seeded root `feeds.toml`, an empty root `discoveries_inbox.toml`, and an allowlist stub (`[[members]]` / `[[senders]]` with commented examples); document the spare-domain / Email Routing operator step. *(Separate repo; the vendored `docs/data-template/` submodule currently has unrelated uncommitted changes from the kitchen-equipment change — do not entangle.)*
- [ ] 4.2 Bump the vendored `docs/data-template/` submodule pin in this repo to the updated template (`git submodule update --remote && git add docs/data-template`) — after 4.1 is pushed.
- [ ] 4.3 **`caseyWebb/groceries-agent-data` (live, BREAKING):** merge every `users/<id>/feeds.toml` into one root `feeds.toml` (union, dedup by URL), delete the per-tenant copies, add an empty root `discoveries_inbox.toml`, and seed `discovery_sources.toml` with the real friend-group members. Land together with the deployed `personalGh → sharedGh` switch (1.1); keep the pre-merge per-tenant files until the shared read is confirmed live.
- [ ] 4.4 Redeploy the Worker (new `email()` handler) via the data repo's `deploy.yml`.

## 5. Infra + docs

- [ ] 5.1 **EXTERNAL (operator):** add the spare domain to Cloudflare, enable Email Routing, route `groceries-agent@<domain>` to the Worker (dashboard; no `wrangler.jsonc` change needed — Email Routing binds the address to the Worker).
- [x] 5.2 Documented the address, the forwarder-only model (both forward forms), and allowlist setup in `docs/SELF_HOSTING.md` (new "Newsletter discovery via email" section); noted discovery sources are shared in `docs/PROJECT.md` (repo-tree + shared list).
- [ ] 5.3 **EXTERNAL (operator):** deploy + smoke test — forward a real newsletter (auto-forward rule and manual forward), confirm it lands in `discoveries_inbox.toml` with unwrapped URLs and surfaces at menu time. *(Live test is also where relay-SPF path (c) gets its real auth verdict to wire up.)*

## 6. Follow-on (NOT in this change — noted for later)

- [ ] 6.1 `/follow-source` skill: try RSS autodiscovery → `update_feeds`; else guide forwarder setup → `update_discovery_sources` (already built).
- [ ] 6.2 `update_feeds` write tool (shared feeds). *(`update_discovery_sources` was pulled forward into this change — see §3b.)*
