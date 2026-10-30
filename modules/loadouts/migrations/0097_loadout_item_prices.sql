-- 枪身和配件的最新成交价。同一件物品被多条方案共用，只存一行。
CREATE TABLE IF NOT EXISTS loadout_item_prices (
  object_id bigint PRIMARY KEY,
  price integer NOT NULL,
  source text NOT NULL,
  priced_at timestamptz NOT NULL
);
