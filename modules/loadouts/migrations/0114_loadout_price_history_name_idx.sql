-- 配件名对不上物品 id 时，按名称找最近一次报价。
CREATE INDEX CONCURRENTLY IF NOT EXISTS loadout_price_history_name_idx ON loadout_price_history (item_name, fetched_at DESC);
