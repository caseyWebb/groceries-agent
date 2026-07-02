-- 0036_coresolution_rejections — co-resolution rejection memory (normalization-audit-calibration).
-- The SKU co-resolution pass proposes a merge for two distinct surviving ids that share a Kroger
-- SKU; a pair the classifier confirm REJECTS (distinct products — e.g. pecorino romano/parmesan
-- on one store-brand SKU) was re-proposed every tick forever, one wasted classifier call each.
-- This table remembers the rejection: (a, b) is the pair's SURVIVING ids at decision time,
-- lexicographically ordered (a < b). The pass suppresses a remembered pair for a long backoff
-- (re-confirming once after it; a re-rejection refreshes decided_at), and a later merge that
-- changes either survivor changes the key — so a materially-changed graph re-opens the question
-- immediately. Shared corpus (no tenant column), like the rest of the identity graph.

CREATE TABLE ingredient_coresolution_rejection (
  a          TEXT NOT NULL,                    -- smaller surviving id of the rejected pair
  b          TEXT NOT NULL,                    -- larger surviving id of the rejected pair
  decided_at INTEGER NOT NULL,                 -- epoch ms of the (latest) rejection
  PRIMARY KEY (a, b)
);
