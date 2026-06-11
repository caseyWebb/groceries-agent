## ADDED Requirements

### Requirement: Inbound email is received by a Worker email handler

The Worker SHALL expose an `email()` handler (alongside its existing `fetch` handler in the same Worker) that processes messages delivered by Cloudflare Email Routing for the configured newsletter address (`groceries-agent@<domain>`). The newsletter domain SHALL be a dedicated spare zone added to Cloudflare with Email Routing enabled — never the in-use ProtonMail zone — so enabling Routing's MX records breaks no live mail. The handler SHALL NOT poll a mailbox (no IMAP, no cron); intake is push-only.

#### Scenario: A delivered newsletter reaches the handler

- **WHEN** Cloudflare Email Routing delivers a message addressed to `groceries-agent@<domain>` to the Worker
- **THEN** the Worker's `email()` handler is invoked with that message and processes it without any scheduled trigger

### Requirement: Messages are authenticated and gated against the allowlist

The handler SHALL accept a message only when it is both authenticated and from an allowed source. The shared allowlist is a union of two entry kinds: trusted **senders** (newsletter `From` addresses) and trusted **members** (friend-group personal addresses). A message SHALL be accepted when any of the following holds:
- its `From` matches a trusted **sender** AND DKIM passes for that sender (auto-forward rule, original signature survived), or
- its `From` matches a trusted **member** AND DKIM aligns to that member's domain (manual forward, re-signed by the member's provider), or
- it is SPF-aligned to a known member's forwarding relay (auto-forward rule whose original DKIM broke in the hop).

A message that satisfies none of these SHALL NOT be written to the inbox. Instead of a silent drop, the handler SHALL reject it in-session (`setReject`, an SMTP 550) with a human-readable reason so the sender receives a bounce — a known-but-unaligned address (its `From` is allowlisted but DKIM did not align) SHALL get a detailed reason; an unknown sender SHALL get a terse one. (`setReject` is backscatter-safe: a synchronous SMTP rejection, not a new outbound email.) Authentication results SHALL be taken from Cloudflare's reported DKIM/SPF/DMARC verdicts, not inferred from header text.

#### Scenario: A failed message bounces with a reason instead of vanishing

- **WHEN** a message is not accepted by the gate (e.g. an allowlisted address whose DKIM did not align)
- **THEN** the handler rejects it in-session with a reason and writes nothing to the inbox, so the sender receives a bounce explaining why

#### Scenario: Auto-forwarded newsletter with surviving DKIM is accepted

- **WHEN** a message arrives with `From` equal to an allowlisted sender and a passing DKIM signature for that sender
- **THEN** the handler proceeds to extract candidates from it

#### Scenario: Manually forwarded message from a trusted member is accepted

- **WHEN** a message arrives with `From` equal to an allowlisted member and DKIM aligned to that member's domain
- **THEN** the handler proceeds to extract candidates from it

#### Scenario: Unallowlisted or unauthenticated mail is dropped

- **WHEN** a message's `From` is not in the allowlist and it is not SPF-aligned to a known member relay
- **THEN** the handler writes nothing and surfaces no error

### Requirement: Both forwarding forms are supported, including nested forward wrappers

The handler SHALL extract candidate recipes from both an auto-forwarded message (original newsletter body delivered ~intact) and a manually forwarded message (original body nested inside a forward wrapper, e.g. a `---------- Forwarded message ----------` header with quoted or re-encoded HTML). Candidate extraction SHALL operate on whatever links survive in the body and SHALL NOT fail when the original content is nested one or more wrapper levels deep.

#### Scenario: Manual forward wrapper does not defeat extraction

- **WHEN** the handler processes a manually forwarded message whose original newsletter HTML is nested inside a forward wrapper
- **THEN** it still extracts the candidate recipe links from the nested body

### Requirement: Tracker-wrapped links are unwrapped to canonical URLs

Before storing any candidate, the handler SHALL resolve each link to its canonical destination. When the destination is encoded in the tracker URL's path or query, it SHALL be decoded without a network call; otherwise the handler SHALL follow the redirect from the Worker's egress and capture the final `Location`, WITHOUT downloading the (possibly walled) destination body. The stored candidate URL SHALL be the canonicalized destination (tracking query strings stripped), so links are clean and work even behind a privacy DNS that blocks the original redirectors.

#### Scenario: Encoded destination is decoded without a network call

- **WHEN** a candidate link is a tracker URL carrying its destination encoded in the path or query
- **THEN** the handler decodes and canonicalizes that destination and stores it, making no outbound request

#### Scenario: Opaque redirector is followed without downloading the body

- **WHEN** a candidate link is an opaque redirector with no encoded destination
- **THEN** the handler follows the redirect to capture the final URL and stores its canonical form, without downloading the destination page body

### Requirement: Candidates are appended to a shared discoveries inbox

Accepted candidates SHALL be appended to a shared `discoveries_inbox.toml` at the data-repo root (not a per-tenant file) via the atomic commit engine. Each inbox record SHALL carry the source identity (`from`), `subject`, `received_at`, and a `candidates` list of `{ title, summary, url }` where `url` is the unwrapped canonical URL. The file SHALL be an agent-writable side-effect file, not user-curated config.

#### Scenario: Accepted message lands as an inbox record

- **WHEN** the handler accepts a message and extracts one or more candidates
- **THEN** a record with `from`, `subject`, `received_at`, and the canonical-URL candidates is appended to the root `discoveries_inbox.toml` in a single commit

### Requirement: Inbox writes dedup deterministically by canonical URL

At inbox write-time the handler SHALL drop any candidate whose canonical URL already appears in the existing corpus `source:` URLs or in an existing `discoveries_inbox.toml` entry — a deterministic set-membership test on the canonical URL. It SHALL NOT dedup by title or any fuzzy/LLM comparison. The handler does NOT fetch the live RSS pool to dedup (that would mean fetching every feed on each inbound message); RSS-vs-inbox overlap collapses at *surfacing/import* via the same canonical-URL key — `read_discovery_inbox` and `fetch_rss_discoveries` return the same key, and import-time `create_recipe` corpus dedup is the backstop. A candidate that cannot be reduced to a stable canonical URL MAY be stored and is not required to dedup until import-time.

#### Scenario: Same recipe forwarded by two members is stored once

- **WHEN** two accepted messages each yield a candidate with the same canonical URL
- **THEN** the URL is written to the inbox only once

#### Scenario: Already-imported recipe is not re-surfaced

- **WHEN** a candidate's canonical URL equals the `source:` of a recipe already in the corpus
- **THEN** that candidate is omitted from the inbox write

### Requirement: Senders are notified of failures but not of routine success

The handler SHALL `setReject` (bounce) a message that the gate rejects, and an accepted message from which **no** recipe links could be extracted. It SHALL NOT reject a message that was accepted and yielded at least one extractable link — including the case where every candidate was a duplicate already in the corpus or inbox (that is a routine success, not a failure, so forwarding a newsletter of already-known recipes does not bounce). A processing error SHALL also reject with a generic reason rather than being swallowed.

#### Scenario: Accepted message with no recipe links bounces

- **WHEN** an accepted message contains no extractable content links
- **THEN** the handler rejects it with a "no recipe links found" reason

#### Scenario: All-duplicate forward is accepted silently

- **WHEN** an accepted message's candidates are all already in the corpus or inbox
- **THEN** the handler writes nothing new and does NOT reject (no bounce)

### Requirement: read_discovery_inbox returns the pooled inbox candidates

`read_discovery_inbox` SHALL read the shared `discoveries_inbox.toml` and return its candidates as a deduped pool (`{ candidates: [{ url, title, summary, from, received_at }] }`), carrying no taste `score` — taste fit and selection are the agent's judgment, consistent with `fetch_rss_discoveries`. When the inbox file is absent or empty, it SHALL return an empty candidate list rather than erroring. The meal-plan flow SHALL surface these candidates at menu time alongside the RSS pool.

#### Scenario: Inbox candidates returned without a score

- **WHEN** `read_discovery_inbox` is called with a populated inbox
- **THEN** each candidate carries `url`, `title`, `summary`, `from`, and `received_at`, and no candidate carries a taste `score`

#### Scenario: Empty inbox is not an error

- **WHEN** `discoveries_inbox.toml` is absent or has no entries
- **THEN** the tool returns `{ candidates: [] }` and does not raise an error

### Requirement: Walled sources degrade to manual paste at import time

Discovery via email is unblockable, but full-recipe import still hits the same bot walls / paywalls. The flow SHALL present the clean canonical link and let the user paste the recipe text for the agent to assemble and persist via the existing `create_recipe`. It SHALL NOT introduce a new import tool and SHALL NOT claim to have fetched a walled page.

#### Scenario: Paywalled candidate is imported by paste

- **WHEN** the user chooses an inbox candidate whose source is paywalled
- **THEN** the agent presents the clean link, the user pastes the recipe text, and the agent assembles and persists it via `create_recipe`

### Requirement: New shared discovery files are schema-validated at build

`scripts/build-indexes.mjs` SHALL validate the shared `discoveries_inbox.toml` and the allowlist config: TOML parses, required fields present, and allowlist entries are well-formed (a `senders`/`members` shape). Validation failures SHALL be reported like other build validation errors and SHALL NOT silently pass.

#### Scenario: Malformed inbox file fails the build

- **WHEN** `discoveries_inbox.toml` has a malformed entry (missing `url` on a candidate)
- **THEN** `build-indexes.mjs` reports a validation error rather than producing indexes
