-- 枪的社区补充：聪聪梯队、DFTTK 理论 TTK 和体验服观察。官方属性和价格不放这里。
CREATE TABLE IF NOT EXISTS loadout_weapon_balance (
  weapon text PRIMARY KEY,
  tier text,
  tier_as_of text,
  ttk jsonb,
  patch jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
