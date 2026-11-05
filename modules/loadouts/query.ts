// 列表先按地址栏的条件筛选、排序，再每把枪留 40 条。截断放在筛选前面时，
// 作者、来源或最便宜的码会落在这 40 条之外，页面上就怎么也搜不到。

export const LOADOUT_PER_WEAPON = 40;
export const LOADOUT_MODES = ["烽火地带", "全面战场", "黑潮爆破"] as const;
export const LOADOUT_SOURCES = ["官方热门", "鸟兽兽", "云码库", "洲械库"] as const;
export const LOADOUT_SORTS = ["popularity", "newest", "price", "tier"] as const;

export type LoadoutSort = (typeof LOADOUT_SORTS)[number];

export interface LoadoutListQuery {
  category: string | null;
  mode: (typeof LOADOUT_MODES)[number] | null;
  source: (typeof LOADOUT_SOURCES)[number] | null;
  tier: string | null;
  sort: LoadoutSort;
  /** 已 trim、NFKC、小写。空字符串表示不搜。 */
  q: string;
  pending: boolean;
  /** 最低、最高整枪价，单位是游戏币。没有这个条件就是 null。 */
  minPrice: number | null;
  maxPrice: number | null;
}

export interface ListedCode {
  id: number;
  mode: string | null;
  author: string | null;
  source: string | null;
  sources: readonly { label: string }[];
  notedAt: string | null;
  verification: "ok" | "pending" | "removed" | null;
  popularity: number | null;
  total: number | null;
}

interface QueryWeapon<C> {
  name: string;
  tier: string | null;
  codes: C[];
}

interface QueryCategory<W> {
  key: string;
  weapons: W[];
}

function wanParam(value: string | null): number | null {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return null;
  const wan = Number(value);
  if (!Number.isFinite(wan) || wan < 0) return null;
  return Math.round(wan * 10000);
}

export function parseLoadoutQuery(params: { get(name: string): string | null }): LoadoutListQuery {
  const mode = params.get("mode");
  const source = params.get("source");
  const sort = params.get("sort");
  const tier = params.get("tier")?.trim() || null;
  const category = params.get("category")?.trim() || null;
  return {
    category,
    mode: LOADOUT_MODES.find((item) => item === mode) ?? null,
    source: LOADOUT_SOURCES.find((item) => item === source) ?? null,
    tier,
    sort: LOADOUT_SORTS.find((item) => item === sort) ?? "popularity",
    q: (params.get("q") ?? "").normalize("NFKC").trim().toLowerCase(),
    pending: params.get("pending") === "1",
    minPrice: wanParam(params.get("min")),
    maxPrice: wanParam(params.get("max")),
  };
}

/** 转给 /api/loadouts 的查询串。默认值不写进去，无筛选时地址和以前一样。 */
export function loadoutApiSearch(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of ["category", "mode", "source", "tier", "sort", "q", "pending", "min", "max"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const text = next.toString();
  return text ? `?${text}` : "";
}

function authorlessYunmaku(code: ListedCode): boolean {
  return !code.author && (code.sources.length ? code.sources : [{ label: code.source }]).every((item) => item.label === "云码库");
}

export function compareCodes(a: ListedCode, b: ListedCode, sort: LoadoutSort): number {
  if (sort === "popularity") {
    const byDemote = Number(authorlessYunmaku(a)) - Number(authorlessYunmaku(b));
    if (byDemote) return byDemote;
  }
  if (sort === "newest") {
    const aTime = a.notedAt ? -Date.parse(a.notedAt) : Number.POSITIVE_INFINITY;
    const bTime = b.notedAt ? -Date.parse(b.notedAt) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
  }
  if (sort === "price") {
    const aPrice = a.total ?? Number.POSITIVE_INFINITY;
    const bPrice = b.total ?? Number.POSITIVE_INFINITY;
    if (aPrice !== bPrice) return aPrice - bPrice;
  }
  const byPop = (b.popularity ?? -1) - (a.popularity ?? -1);
  if (byPop) return byPop;
  return b.id - a.id;
}

function matchesCode(weaponName: string, code: ListedCode, query: LoadoutListQuery): boolean {
  if (query.mode && code.mode !== query.mode) return false;
  if (query.source && !code.sources.some((item) => item.label === query.source) && code.source !== query.source) return false;
  if (query.pending && code.verification !== "pending" && code.verification !== "removed") return false;
  if (query.minPrice != null && (code.total == null || code.total < query.minPrice)) return false;
  if (query.maxPrice != null && (code.total == null || code.total > query.maxPrice)) return false;
  if (query.q) {
    const haystack = `${weaponName} ${code.author ?? ""}`.normalize("NFKC").toLowerCase();
    if (!haystack.includes(query.q)) return false;
  }
  return true;
}

function selectCodes<C extends ListedCode>(categoryKey: string, weapon: QueryWeapon<C>, query: LoadoutListQuery, cap: boolean): C[] {
  if (query.category && query.category !== categoryKey) return [];
  if (query.tier && weapon.tier !== query.tier) return [];
  const matched = weapon.codes.filter((code) => matchesCode(weapon.name, code, query));
  if (!cap) return matched;
  // 热度和梯队沿用收录时的顺序（官方、主播、热度、过季最后）。最新和价格要先排再截断，否则第 41 条永远出不来。
  const ordered = query.sort === "newest" || query.sort === "price"
    ? [...matched].sort((a, b) => compareCodes(a, b, query.sort))
    : matched;
  return ordered.slice(0, LOADOUT_PER_WEAPON);
}

export function applyLoadoutQuery<C extends ListedCode, W extends QueryWeapon<C>, Cat extends QueryCategory<W>>(
  categories: readonly Cat[],
  query: LoadoutListQuery,
  cap = true,
): Cat[] {
  return categories.map((category) => ({
    ...category,
    weapons: category.weapons.map((weapon) => ({
      ...weapon,
      codes: selectCodes(category.key, weapon, query, cap),
    })),
  }));
}

/**
 * 价格要等官方总价算出来才能筛、才能按价格排。其他条件先收窄再计价，避免每把枪只给前 40 条计价。
 * 不需要价格的排序在计价前就截断。
 */
export async function shapeLoadoutCategories<C extends ListedCode, W extends QueryWeapon<C>, Cat extends QueryCategory<W>>(
  categories: readonly Cat[],
  query: LoadoutListQuery,
  price: (categories: Cat[]) => Promise<Cat[]>,
  cap = true,
): Promise<Cat[]> {
  const deferCap = query.sort === "price" || query.minPrice != null || query.maxPrice != null;
  const prepared = applyLoadoutQuery(categories, deferCap ? { ...query, minPrice: null, maxPrice: null, sort: "popularity" } : query, cap && !deferCap);
  const priced = await price(prepared);
  return deferCap ? applyLoadoutQuery(priced, query, cap) : priced;
}

/** 一把枪的页面用：筛选和排序作用在这把枪的全部方案上，不按每枪 40 条截断。 */
export function gunPageCodes<C extends ListedCode>(codes: readonly C[], query: LoadoutListQuery): C[] {
  const [category] = applyLoadoutQuery(
    [{ key: "", weapons: [{ name: "", tier: null, codes: [...codes] }] }],
    { ...query, category: null, tier: null },
    false,
  );
  const matched = category?.weapons[0]?.codes ?? [];
  return [...matched].sort((a, b) => compareCodes(a, b, query.sort));
}

export function gunSummary(codes: readonly ListedCode[]): {
  total: number;
  priceMin: number | null;
  priceMax: number | null;
  modes: Array<{ mode: (typeof LOADOUT_MODES)[number]; count: number }>;
} {
  const totals = codes.map((code) => code.total).filter((value): value is number => value != null && value > 0);
  return {
    total: codes.length,
    priceMin: totals.length ? Math.min(...totals) : null,
    priceMax: totals.length ? Math.max(...totals) : null,
    modes: LOADOUT_MODES.map((mode) => ({ mode, count: codes.filter((code) => code.mode === mode).length })),
  };
}

/** 枪械页地址。带上列表里仍然适用的筛选，不带枪种、梯队和旧的 gun 参数。 */
export function gunHref(name: string, params?: { get(name: string): string | null }): string {
  const next = new URLSearchParams();
  if (params) {
    for (const key of ["mode", "source", "sort", "q", "pending", "min", "max"]) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
  }
  const search = next.toString();
  return `/loadouts/gun/${encodeURIComponent(name)}${search ? `?${search}` : ""}`;
}
