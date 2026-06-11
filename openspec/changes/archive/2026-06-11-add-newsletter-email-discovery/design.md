## Context

Change 10 shipped RSS pull discovery. Its feed spike confirmed — from Cloudflare's actual edge egress, with full browser headers — that Serious Eats (403) and Food52 (429 Vercel) bot-wall the Worker via TLS/bot-management fingerprinting, not a UA check, so header spoofing cannot recover them; NYT is paywall+login-gated. Pull discovery structurally cannot reach these. Email inverts the flow: the publisher pushes a teaser to us, so *discovery* becomes unblockable; only the optional full-recipe *import* fetch stays walled, and that already degrades to manual paste via the existing `create_recipe`.

Two facts about the current system shape the design:
- **Multi-tenant split.** "Which tenant" is the OAuth grant's `tenantId` prop on each MCP request. An inbound email carries **no OAuth session** — it arrives at an address. Recipes, however, are *shared corpus*; discovery is staging for shared content. So rather than invent email→tenant routing, discovery sources become shared and top-level. This also retroactively corrects `feeds.toml`, which shipped per-tenant (`users/<id>/feeds.toml`, read via `personalGh`) but feeds a shared corpus.
- **Existing machinery to reuse.** `discovery.ts` already has `canonicalizeUrl` and `extractRecipeSources` (the deterministic dedup primitives); `commit.ts`/`github.ts` provide the atomic commit engine and the GitHub App token; the Worker already runs on Cloudflare with those bindings.

## Goals / Non-Goals

**Goals:**
- Discover from bot-walled / paywalled sources by accepting forwarded newsletters.
- Make discovery sources (feeds + inbox + allowlist) shared, root-level, and open for any member to widen.
- Deterministic, no-LLM dedup keyed on canonical URL.
- Reuse the existing Worker, commit engine, and dedup primitives — no new runtime dependency.

**Non-Goals:**
- The `/follow-source` skill and its `update_feeds` / `update_discovery_sources` write tools (follow-on — they consume this infrastructure).
- Fetching the walled full recipe automatically (stays manual paste → `create_recipe`).
- Per-tenant inboxes or any email→tenant routing (explicitly rejected in favor of shared).
- Rich HTML→structured parsing of newsletter bodies beyond link extraction (v0 stores sender/subject/unwrapped links; richer parsing is incremental).

## Decisions

**Discovery sources are shared and top-level (not per-tenant).** `feeds.toml` moves to the data-repo root and is read via `sharedGh`; `discoveries_inbox.toml` and the allowlist live beside it. *Alternative considered:* per-tenant addresses (`<username>@<domain>`, local-part = username, routed against the KV `tenant:<id>` directory). Rejected — it solves a routing problem the shared model doesn't have, fragments a shared corpus, and keeps each member's finds out of the others' menu flow, which is the opposite of a friend-group recipe collection. Taste still filters per-conversation at menu time, exactly as the RSS pool already does.

**Forwarder-only intake, both forward forms.** `groceries-agent@` is never subscribed directly: confirm-links and paywalls are handled by the member's *own* inbox, so the agent's inbox only ever sees confirmed, paid content. Two forms, with different trust signatures:

| Form | `From` | Body | DKIM | Trust anchor |
|---|---|---|---|---|
| Auto-forward rule | newsletter sender (preserved) | ~intact | original may survive or break | the **sender** (+ relay fallback) |
| Manual "Forward" | the member | nested in a wrapper | re-signed by member | the **member** |

The allowlist is therefore a **union of trusted senders and trusted members**, and the gate accepts on: (a) `From` ∈ senders ∧ DKIM passes, (b) `From` ∈ members ∧ DKIM aligns to member, or (c) SPF-aligned to a known member relay (auto-forward whose original DKIM broke). *Alternative considered:* sender-only allowlist. Rejected — it can't authenticate manual forwards (where `From` is the member, not the newsletter). *Alternative considered:* member-only trust. Rejected — auto-forward rules preserve the newsletter `From`, so a sender entry is the natural key there. Supporting both forms means supporting both entry kinds.

**One Worker, add an `email()` export.** Cloudflare Workers export `fetch` and `email` from the same Worker; the email handler reuses the GitHub App creds, `commitFiles`, and KV already bound. *Alternative considered:* a separate Email Worker. Rejected — it would duplicate the GitHub App auth and commit plumbing for no isolation benefit; the handler only activates when Email Routing is pointed at it.

**Dedicated spare domain for Routing.** Email Routing requires Cloudflare to own the zone's MX records; repointing the live ProtonMail zone would break existing mail. A spare unused domain is added fresh and dedicated to newsletter intake (`groceries-agent@<domain>`), isolating intake and touching nothing live.

**Deterministic two-layer dedup on canonical URL.** Layer 1 (inbox write-time): drop a candidate whose `canonicalizeUrl` result is already in the corpus `source:` set (`extractRecipeSources`) or the existing inbox. The handler does *not* fetch the live RSS pool to dedup — that would mean fetching every feed per inbound message; RSS-vs-inbox overlap collapses at surfacing (both `read_discovery_inbox` and `fetch_rss_discoveries` return the same canonical key) and at layer 2. Layer 2 (import-time): the existing `create_recipe` corpus dedup. Never title-based, never LLM. *Accepted limitation:* a teaser sometimes links to a roundup/listicle URL rather than a single recipe; that URL dedups fine *as a listicle*, but two different roundups sharing one recipe collapse only at layer 2 (import). Still deterministic at both layers.

**Link unwrapping decodes-or-follows, never downloads the destination.** Encoded destinations are decoded from the tracker URL with no network call; opaque redirectors are followed only to capture the final `Location`. The destination body is never downloaded — it may be walled, and we only need the clean URL. This also fixes Casey's home privacy-DNS breaking wrapped links: the Worker (off that DNS) unwraps once, so members only ever see working URLs.

**MIME parsing uses `postal-mime` (decided at apply — reverses the original hand-rolled call).** The `recipe-discovery` "no new parsing dependency" rule was written for RSS/HTML/JSON-LD, where hand-rolling is tractable. Robust MIME — multipart boundaries, quoted-printable + base64 decoding, charsets, *and* nested forward wrappers — is a far heavier, bug-prone job. `postal-mime` is the standard pure-JS MIME parser purpose-built for Cloudflare Email Workers: it runs on `workerd` and is unit-testable in Node, so it satisfies the *spirit* of the runtime-agnostic constraint (the constraint is now scoped to feed/HTML parsing, where hand-rolling still holds). Link extraction over the parsed `html`/`text` parts stays hand-rolled regex. The net-new concern — forward-wrapper nesting — is handled by extracting links from whatever `postal-mime` yields, with fixtures for both forms (auto-forward intact body + manual-forward nested wrapper).

**Anyone trusted with the MCP can widen intake — via a tool.** The allowlist is one shared root `discovery_sources.toml` with `[[members]]` (trusted personal addresses) and `[[senders]]` (trusted newsletter `From` addresses), and an `update_discovery_sources` write tool adds entries. Rationale (decided at apply): a member already trusted with the agent's full MCP surface is trusted to add a newsletter sender. *Alternatives considered:* two files (rejected — one validation case, one edit point); edit-only-when-directed with no tool (rejected — the tool is the natural path and the trust argument removes the reason to gate it). `update_feeds` and the `/follow-source` skill remain the follow-on.

**Failures bounce with a reason; success/duplicates are silent (revised at apply).** The original "drop silently" posture made forwarding undebuggable — a member who set up an auto-forward wrong got no signal. The handler now `awaits` processing (not `waitUntil`) and `setReject`s a failure in-session, so the sender gets an SMTP-550 bounce with the reason. `setReject` is the right primitive over `reply()`: it's a synchronous rejection (no new outbound email, so no backscatter-amplification risk), and the connecting MTA — the actual sender, even when `From` is spoofed — is who gets the 550. Reasons are tiered: an allowlisted-but-DKIM-unaligned address gets a detailed reason (it's a trusted address; tell it the auto-forward likely broke DKIM and that relay-SPF isn't enabled yet), an unknown sender gets a terse one. Accepted-with-all-duplicates is a *success* (nothing new, but not a failure), so it never bounces — otherwise forwarding a newsletter of known recipes would annoy. *Accepted tradeoff:* a 550 confirms the address is live to a prober; acceptable for a personal friend-group system, and dialable back to silent-for-unknown-senders later if spam appears.

**Auth gate ships the two DKIM paths; relay-SPF (c) is deferred.** Paths (a) `sender ∧ DKIM` and (b) `member ∧ DKIM-aligned` are verifiable from Cloudflare's reported verdicts and ship now. Path (c) — SPF-aligned-to-a-known-member-relay for auto-forwards whose original DKIM broke — can't be validated without a real forwarded message's auth headers, so it's stubbed and flagged to wire up once we can test against a live verdict. Consequence: manual forwards (b) work immediately; auto-forwards work when the original DKIM survives the hop (common), and the broke-in-transit tail waits for (c).

## Risks / Trade-offs

- **DKIM breaks on the forwarding hop** → the relay-SPF fallback (c) accepts auto-forwards whose original signature didn't survive, scoped to known member relays; for a small trusted friend group this is proportionate. Document which forward setups are known-good.
- **`groceries-agent@` is a fixed, guessable spam target** → the allowlist + authentication gate drops everything not from a trusted, authenticated source; unallowlisted mail is dropped silently (no inbox write, no error).
- **Shared allowlist means anyone can widen group intake** → intended. It's edit-when-directed shared config; a trusted friend group accepts that any member can add a source.
- **Manual-forward body mangling** (clients re-encode/quote HTML) → extraction operates on surviving links and tolerates nesting; worst case a candidate is missed, never a crash. Covered by fixtures.
- **Listicle-URL dedup gap** (above) → accepted; import-time dedup is the backstop.

## Migration Plan

The work spans three repos — this code repo, the live data repo (`caseyWebb/groceries-agent-data`), and the template (`caseyWebb/groceries-agent-data-template`, vendored here as the `docs/data-template/` submodule). Order matters: ship the code's shared-read switch and the live-repo merge together so `fetch_rss_discoveries` never reads a path that just moved.

1. **This repo (code):** switch the `feeds.toml` read in `src/discovery-tools.ts` from `personalGh` to `sharedGh`; add `read_discovery_inbox`; add the `email()` handler module; `build-indexes.mjs` validation for the new files.
2. **This repo (docs):** `docs/SCHEMAS.md` (relocated `feeds.toml`, new `discoveries_inbox.toml`, allowlist), `CLAUDE.md` shared-root list + curated-config line, `docs/TOOLS.md` (`read_discovery_inbox`), `docs/SELF_HOSTING.md` (spare domain + Email Routing + the forwarder model).
3. **`groceries-agent-data` (live, BREAKING):** merge every `users/<id>/feeds.toml` into one root `feeds.toml` (union, de-duplicated by URL), then delete the per-tenant copies; add an empty root `discoveries_inbox.toml` and the allowlist seeded with the real members; redeploy the Worker via `deploy.yml`.
4. **`groceries-agent-data-template`:** in `README.md`, move `feeds.toml` from the per-tenant `users/<username>/` block to the shared reference-data block (it's documented as per-tenant today); seed a root `feeds.toml`, add an empty root `discoveries_inbox.toml` and an allowlist stub; document the spare-domain / Email Routing operator step. Then bump the `docs/data-template/` submodule pin in this repo.
5. **Infra:** add the spare domain to Cloudflare, enable Email Routing, route `groceries-agent@<domain>` to the Worker.
- **Rollback:** the `email()` export and `read_discovery_inbox` are additive; pointing Email Routing away disables intake. The feeds relocation is the only one-way step — keep the pre-merge per-tenant files until the shared read is confirmed working.

## Open Questions

- **Allowlist file shape** — one file with `[[members]]` / `[[senders]]` tables vs. two sibling files. Propose-time leaning: one file, two tables.
- **Relay-SPF fallback specifics** — which member mail providers reliably preserve DKIM on auto-forward vs. need the SPF fallback; confirm against Cloudflare's reported auth verdicts during the build.
- **`read_discovery_inbox` vs. extending `fetch_rss_discoveries`** — kept separate here (clean fetch-vs-read split); revisit if the meal-plan skill would rather call one tool.
- **Inbox pruning** — when/whether dispositioned or stale inbox entries are removed (vs. growing unbounded). Likely a small follow-on once usage is observed.
