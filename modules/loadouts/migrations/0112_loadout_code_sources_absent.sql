-- 这一来源完整抓取后不再列出这条码的时间。抓取不完整时不写。
ALTER TABLE loadout_code_sources ADD COLUMN absent_at timestamptz;
