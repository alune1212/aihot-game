-- 交易行价格按抓取时间留历史。同一物品、同一来源、同一次抓取只记一行。
CREATE TABLE IF NOT EXISTS loadout_price_history (
  object_id bigint NOT NULL,
  item_name text NOT NULL,
  price integer NOT NULL,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (object_id, source, fetched_at)
);
