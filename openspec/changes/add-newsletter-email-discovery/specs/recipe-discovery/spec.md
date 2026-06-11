## MODIFIED Requirements

### Requirement: RSS discovery returns a deduped candidate pool without scoring

`fetch_rss_discoveries` SHALL read the feeds configured in the **shared** `feeds.toml` at the data-repo root — read through the shared GitHub client, not a per-tenant `users/<id>/` path — fetch each feed, and return a deduped pool of candidate recipes as `{ candidates: [{ url, title, source, feed_weight, summary }] }`. Discovery feeds are a shared, top-level concern: any member's configured feeds contribute to one group pool, and the candidates are judged against the calling member's taste at menu time. It SHALL NOT compute or return a taste `score` and SHALL NOT rank or pre-select a "top" subset — taste fit and the final selection are the agent's judgment. `feed_weight` SHALL be passed through from the feed's configured weight, not used by the tool to order results. When the shared `feeds.toml` is absent or empty, the tool SHALL return an empty candidate list rather than erroring.

#### Scenario: Candidates returned without a score field

- **WHEN** `fetch_rss_discoveries` is called with feeds configured
- **THEN** each returned candidate carries `url`, `title`, `source`, `feed_weight`, and `summary`, and no candidate carries a taste `score`

#### Scenario: Feeds are read from the shared root, not a per-tenant path

- **WHEN** `fetch_rss_discoveries` resolves its feed configuration
- **THEN** it reads `feeds.toml` from the data-repo root via the shared client, and no `users/<id>/feeds.toml` is consulted

#### Scenario: Empty feed config is not an error

- **WHEN** the shared `feeds.toml` has no feed entries
- **THEN** the tool returns `{ candidates: [] }` and does not raise an error

### Requirement: RSS candidates are deduped against the existing corpus

`fetch_rss_discoveries` SHALL exclude any feed item whose canonical link matches the `source:` URL of a recipe already in the corpus, so already-imported recipes are not re-surfaced. The deduplication SHALL be performed by the tool (deterministically on the canonical URL — the same key the email discovery inbox dedups on), not left to the agent.

#### Scenario: Already-imported recipe is filtered out

- **WHEN** a feed item's canonical link equals the `source:` of an existing recipe in the corpus
- **THEN** that item is omitted from the returned candidate pool
