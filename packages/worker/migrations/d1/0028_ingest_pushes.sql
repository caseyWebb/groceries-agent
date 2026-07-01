-- 0028_ingest_pushes — the walled-source push history (recipe-ingestion), backing the admin
-- Discovery › Scrapers liveness rollup: per-(scraper, source) last-push + 24h/7d counts, the
-- throughput funnel, and the recent-pushes log. One row per authenticated POST /admin/api/ingest
-- batch. Retention-pruned (a rolling window; liveness only needs the recent tail).
CREATE TABLE ingest_pushes (
  id          TEXT PRIMARY KEY,  -- uuid
  key_id      TEXT NOT NULL,     -- the authenticating ingest key
  source      TEXT NOT NULL,     -- the batch `source` name ('unknown' when the envelope was invalid)
  received    INTEGER NOT NULL,  -- items in the batch
  accepted    INTEGER NOT NULL,  -- persisted (non-duplicate, valid) items
  deduped     INTEGER NOT NULL,  -- items deduped on arrival
  rejected    INTEGER NOT NULL,  -- items that failed per-item validation
  result      TEXT NOT NULL,     -- accepted | partial | bad_payload
  created_at  INTEGER NOT NULL   -- epoch ms
);
CREATE INDEX ingest_pushes_created ON ingest_pushes(created_at);
CREATE INDEX ingest_pushes_key ON ingest_pushes(key_id);
