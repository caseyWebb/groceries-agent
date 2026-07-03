-- 0038_satellite_order_lists — the issued to-buy set for a satellite cart-fill (satellite-order-cart-fill).
--
-- Order-fill is a DIRECT request/response, not a pull-channel task: a satellite-fulfilled tenant's
-- local helper calls `POST /satellite/order/list` (which MINTS one row here per Refresh, recording
-- the exact canonical ingredient ids the Worker handed that tenant) and later `POST /satellite/order/receipt`
-- (which references the row by id). The `item_ids` column is the AUTHORITATIVE issued set the receipt
-- is validated against — a receipt can only advance ids the Worker issued (it cannot invent an item,
-- graft in another list's id, or redirect another tenant's list); the write identity is this row's,
-- never the observation's (the order-fill analog of the sale intake's task-scoped-authoritative rule).
-- All access goes through src/order-lists-db.ts → src/db.ts (throw-free → structured storage_error).
CREATE TABLE order_lists (
  id           TEXT PRIMARY KEY,               -- opaque order-list id ("ol_<hex>"; the receipt correlation key)
  tenant       TEXT NOT NULL,                  -- the issuing tenant (from the ingest key's binding)
  store        TEXT NOT NULL,                  -- primary store slug at issue time
  location_id  TEXT,                           -- store location id (may be NULL — the operator's preferred_location label)
  item_ids     TEXT NOT NULL,                  -- JSON array of canonical ingredient ids issued (authoritative)
  status       TEXT NOT NULL DEFAULT 'issued', -- 'issued' | 'received'
  created_at   INTEGER NOT NULL,               -- epoch ms
  received_at  INTEGER                         -- epoch ms a receipt was applied; NULL until then
);
-- Per-tenant recency scan (audit / prune ordering).
CREATE INDEX order_lists_tenant ON order_lists (tenant, created_at);
