// 读者看到的社区补充。官方属性和价格不从这里来。
export interface WeaponBalanceView {
  tier: string | null;
  tierAsOf: string | null;
  ttkText: string | null;
  ttkNote: string | null;
  patchText: string | null;
}

export const EMPTY_BALANCE: WeaponBalanceView = { tier: null, tierAsOf: null, ttkText: null, ttkNote: null, patchText: null };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function presentBalance(row: { tier: string | null; tier_as_of: string | null; ttk: unknown; patch: unknown } | null | undefined): WeaponBalanceView {
  if (!row) return EMPTY_BALANCE;
  const tier = row.tier && /^[SABC][+\-*]?$/.test(row.tier) ? row.tier : null;
  const tierAsOf = row.tier_as_of && /^\d{4}-\d{2}-\d{2}$/.test(row.tier_as_of) ? row.tier_as_of : null;
  const ttk = record(row.ttk);
  const seconds = typeof ttk?.seconds === "number" ? ttk.seconds : null;
  let ttkText: string | null = null;
  let ttkNote: string | null = null;
  if (seconds && seconds > 0 && seconds <= 120) {
    const shown = seconds >= 10 ? seconds.toFixed(0) : (Math.round(seconds * 10) / 10).toFixed(1);
    ttkText = `理论 TTK ${shown}秒`;
    const scenario = typeof ttk?.scenario === "string" ? ttk.scenario : "";
    const meters = typeof ttk?.atMeters === "number" ? `${ttk.atMeters}米处` : "";
    const version = typeof ttk?.version === "string" && ttk.version ? `版本 ${ttk.version}` : "";
    const preview = ttk?.preview === true ? "数据集标记为 preview，可能含体验服调整" : "";
    ttkNote = ["社区理论，不是官方实测", "烽火地带", scenario, meters, version, preview].filter(Boolean).join("，");
  }
  const patch = record(row.patch);
  const lines = Array.isArray(patch?.lines) ? patch.lines.filter((line): line is string => typeof line === "string" && !!line.trim()) : [];
  const when = typeof patch?.observedAt === "string" ? patch.observedAt : "";
  const patchText = lines.length ? `体验服观察${when ? `（${when}）` : ""}：${lines.join("；")}。非正式服。` : null;
  return { tier, tierAsOf, ttkText, ttkNote, patchText };
}
