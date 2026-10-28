-- 聚合站上一次抓到这条码的时间。从文章抽出的码这里为空。
ALTER TABLE loadout_codes ADD COLUMN fetched_at timestamptz;
