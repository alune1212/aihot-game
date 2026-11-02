import { type CSSProperties, type ReactNode } from "react";
import { useLoaderData, useSearchParams, type ShouldRevalidateFunction } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { compareCodes, gunHref, LOADOUT_MODES, LOADOUT_SOURCES, loadoutApiSearch, parseLoadoutQuery } from "../query.ts";

export const handle: Screen = { tab: "loadouts", name: "改枪" };

const MODES = LOADOUT_MODES;

interface LoadoutPart {
  name: string | null;
  pic: string | null;
  grade: number | null;
}

interface ShownSource {
  label: string;
  url: string | null;
}

interface LoadoutCode {
  id: number;
  code: string;
  mode: string | null;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  sources: ShownSource[];
  notedAt: string | null;
  popularityText: string | null;
  likesText: string | null;
  featured: boolean;
  stale: boolean;
  verification: "ok" | "pending" | "removed" | null;
  popularity: number | null;
  totalText: string | null;
  total: number | null;
  name: string | null;
  partCount: number;
  parts: LoadoutPart[];
}

interface Weapon {
  name: string;
  pic: string | null;
  grade: number | null;
  objectId: number | null;
  tier: string | null;
  tierAsOf: string | null;
  ttkText: string | null;
  ttkNote: string | null;
  patchText: string | null;
  codes: LoadoutCode[];
}

interface Category {
  key: string;
  label: string;
  note: string;
  weapons: Weapon[];
}

interface SeasonInfo {
  name: string;
  number: number | null;
  startsOn: string;
  label: string;
  confidence: "certain" | "uncertain";
}

interface Payload {
  game: { id: string; name: string };
  season?: SeasonInfo;
  categories: Category[];
  note: string;
}

const SOURCES = LOADOUT_SOURCES;
const SORTS = [
  { id: "popularity", label: "热度" },
  { id: "newest", label: "最新" },
  { id: "price", label: "价格" },
  { id: "tier", label: "梯队" },
] as const;
const TIER_ORDER = ["S+", "S", "A", "B", "C", "D"];

interface ShownWeapon extends Weapon {
  categoryKey: string;
  categoryLabel: string;
}

export async function loader({ request }: { request: Request }) {
  const search = loadoutApiSearch(new URL(request.url).searchParams);
  return apiGet<Payload>(`/api/loadouts${search}`, { signal: request.signal });
}

/** 打开某一把枪只改 gun，列表数据不变，不必再请求。筛选变了才重新要。 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) => {
  if (currentUrl.pathname === nextUrl.pathname && loadoutApiSearch(currentUrl.searchParams) === loadoutApiSearch(nextUrl.searchParams)) return false;
  return defaultShouldRevalidate;
};

export function meta({ loaderData }: { loaderData?: Payload }) {
  const name = loaderData?.game.name ?? "三角洲行动";
  return pageMeta({
    title: `${name}改枪码`,
    description: `按${name}的枪械查看改枪码。枪图和整枪价来自官方改枪台，导入前请回游戏里核对。`,
    path: "/loadouts",
  });
}

function playerhubPic(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "playerhub.df.qq.com") return null;
    return url;
  } catch {
    return null;
  }
}

/** 游戏内品质：白、绿、蓝、紫、金、红。0 和 1 都是白色普通品质。 */
function gradeColor(grade: number | null): string {
  switch (grade) {
    case 2: return "#3dd68c";
    case 3: return "#4c9aff";
    case 4: return "#b57bff";
    case 5: return "#f0c14a";
    case 6: return "#ff5d5d";
    default: return "#c5ceda";
  }
}

function wellStyle(grade: number | null): CSSProperties {
  const tinted = grade != null && grade >= 2;
  return { "--grade": gradeColor(grade), ...(tinted ? {} : { "--gun-grade-mix": "0%" }) } as CSSProperties;
}

function lowestTotal(codes: LoadoutCode[]): number | null {
  const value = (code: LoadoutCode) => (code.total != null && code.total > 0 ? code.total : null);
  const fresh = codes.filter((code) => !code.stale && value(code) != null);
  const pool = fresh.length ? fresh : codes.filter((code) => value(code) != null);
  if (!pool.length) return null;
  return Math.min(...pool.map((code) => value(code)!));
}

function priceLabel(value: number | null): string {
  if (value == null || value <= 0) return "—";
  const coins = Math.round(value);
  if (coins < 10000) return String(coins);
  const wan = coins / 10000;
  const shown = wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10);
  return `${shown}万`;
}

function tierClass(tier: string): string {
  if (tier.startsWith("S")) return "bg-amber-soft text-amber-ink";
  if (tier.startsWith("A")) return "bg-ok-soft text-ok-ink";
  if (tier.startsWith("B")) return "bg-accent-soft text-accent-ink";
  return "border border-line text-ink-2";
}

function tierTitle(weapon: { tierAsOf: string | null }): string {
  return `聪聪强度梯队${weapon.tierAsOf ? `，${weapon.tierAsOf} 更新` : ""}。社区排名，不是官方`;
}

function cardId(name: string): string {
  return `gun-card-${encodeURIComponent(name)}`;
}

function tierRank(tier: string | null): number {
  if (!tier) return 99;
  const index = TIER_ORDER.indexOf(tier);
  return index === -1 ? 50 : index;
}

function compareWeapons(a: ShownWeapon, b: ShownWeapon, sort: (typeof SORTS)[number]["id"], codesOf: (weapon: ShownWeapon) => LoadoutCode[]): number {
  if (sort === "tier") {
    const byTier = tierRank(a.tier) - tierRank(b.tier);
    if (byTier) return byTier;
  }
  if (sort === "price") {
    const aPrice = lowestTotal(codesOf(a)) ?? Number.POSITIVE_INFINITY;
    const bPrice = lowestTotal(codesOf(b)) ?? Number.POSITIVE_INFINITY;
    if (aPrice !== bPrice) return aPrice - bPrice;
  }
  if (sort === "newest") {
    const newest = (weapon: ShownWeapon) => {
      const times = codesOf(weapon).map((code) => code.notedAt ? Date.parse(code.notedAt) : 0);
      return times.length ? Math.max(...times) : 0;
    };
    const byTime = newest(b) - newest(a);
    if (byTime) return byTime;
  }
  const pop = (weapon: ShownWeapon) => Math.max(-1, ...codesOf(weapon).map((code) => code.popularity ?? -1));
  const byPop = pop(b) - pop(a);
  if (byPop) return byPop;
  return a.name.localeCompare(b.name, "zh");
}

export default function LoadoutsPage() {
  const { game, season, categories, note } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const listQuery = parseLoadoutQuery(searchParams);
  const { category: categoryKey, mode, source, tier, sort, pending: pendingOnly } = listQuery;
  const category = categories.find((item) => item.key === categoryKey) ?? null;
  const weapons: ShownWeapon[] = categories.flatMap((item) => item.weapons.map((weapon) => ({ ...weapon, categoryKey: item.key, categoryLabel: item.label })));
  const visibleCodes = (weapon: ShownWeapon) => [...weapon.codes].sort((a, b) => compareCodes(a, b, sort));
  const cards = weapons
    .filter((weapon) => (category ? weapon.categoryKey === category.key : true))
    .filter((weapon) => !tier || weapon.tier === tier)
    .filter((weapon) => visibleCodes(weapon).length > 0)
    .sort((a, b) => compareWeapons(a, b, sort, visibleCodes));
  const shownCount = cards.reduce((sum, weapon) => sum + visibleCodes(weapon).length, 0);
  const tiers = [...new Set(weapons.map((weapon) => weapon.tier).filter((item): item is string => !!item))].sort((a, b) => tierRank(a) - tierRank(b) || a.localeCompare(b, "zh"));

  function patch(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { preventScrollReset: true });
  }

  return (
    <div className="pb-6">
      <PhoneBar title="改枪码" />
      <div>
        <div className="min-w-0" style={{ containerType: "inline-size" }}>
          <header className="pb-2 pt-3 lg:pt-1">
            <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">改枪码</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
              按{game.name}的枪械浏览。当前 <span className="num">{shownCount}</span> 条。
              {season ? <span>{season.confidence === "certain" ? `当前赛季 ${season.label}，${season.startsOn} 起。` : `赛季未确认，暂按 ${season.label}（${season.startsOn}）。`}</span> : null}
              枪图和整枪价来自官方改枪台，没有官方价显示 —。
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-4">{note}</p>
          </header>
          <div className="mt-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="筛选">
            <Chip pressed={!category} onClick={() => patch({ category: null })}>全部</Chip>
            {categories.map((item) => (
              <Chip key={item.key} pressed={item.key === category?.key} onClick={() => patch({ category: item.key })}>{item.label}</Chip>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            <Chip pressed={!mode} square onClick={() => patch({ mode: null })}>全部模式</Chip>
            {MODES.map((item) => (
              <Chip key={item} pressed={item === mode} square onClick={() => patch({ mode: item })}>{item}</Chip>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="更多筛选">
            <label className="min-w-[8rem] flex-1">
              <span className="sr-only">搜索作者或枪名</span>
              <input
                value={searchParams.get("q") ?? ""}
                placeholder="作者、主播或枪名"
                className="w-full rounded-control border border-line bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => patch({ q: event.target.value ? event.target.value : null })}
              />
            </label>
            <FilterSelect label="排序" value={sort} onChange={(value) => patch({ sort: value === "popularity" ? null : value })}>
              {SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </FilterSelect>
            <FilterSelect label="来源" value={source ?? ""} onChange={(value) => patch({ source: value || null })}>
              <option value="">全部来源</option>
              {SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
            </FilterSelect>
            <FilterSelect label="梯队" value={tier ?? ""} onChange={(value) => patch({ tier: value || null })}>
              <option value="">全部梯队</option>
              {tiers.map((item) => <option key={item} value={item}>聪聪 {item}</option>)}
            </FilterSelect>
            <label className="flex items-center gap-1 text-[13px] text-ink-2">
              <span className="sr-only">最低价，单位万</span>
              <input inputMode="decimal" value={searchParams.get("min") ?? ""} placeholder="最低万" className="w-16 rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => patch({ min: event.target.value.trim() || null })} />
              <span aria-hidden="true">–</span>
              <span className="sr-only">最高价，单位万</span>
              <input inputMode="decimal" value={searchParams.get("max") ?? ""} placeholder="最高万" className="w-16 rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => patch({ max: event.target.value.trim() || null })} />
            </label>
            <Chip pressed={pendingOnly} square onClick={() => patch({ pending: pendingOnly ? null : "1" })}>待验证</Chip>
          </div>
          {category?.note ? <p className="mt-3 text-[12px] text-ink-4">{category.note}</p> : null}
          {cards.length ? (
            <div className="armory-grid mt-4">
              {cards.map((weapon, index) => {
                const codes = visibleCodes(weapon);
                const pic = playerhubPic(weapon.pic);
                return (
                  // 同一行里有的卡片多一行理论 TTK，网格会把矮的卡片拉高。
                  // 卡片做成纵向 flex，图片井 shrink-0 钉在顶上，避免内容被垂直居中后顶上露出底色。
                  <a
                    key={weapon.name}
                    id={cardId(weapon.name)}
                    href={gunHref(weapon.name, searchParams)}
                    className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="gun-well relative flex h-[110px] shrink-0 items-center justify-center px-3" style={wellStyle(weapon.grade)}>
                      {weapon.tier ? <span className={`absolute left-2 top-2 rounded-mark px-1.5 py-0.5 text-[11px] font-semibold ${tierClass(weapon.tier)}`} title={tierTitle(weapon)}>聪聪 {weapon.tier}</span> : null}
                      {pic ? (
                        <img
                          src={pic}
                          alt=""
                          width={280}
                          height={90}
                          className="gun-sprite max-h-[90px] max-w-full object-contain"
                          fetchPriority={index === 0 ? "high" : undefined}
                          loading={index < 4 ? undefined : "lazy"}
                        />
                      ) : (
                        <span className="text-[13px] text-ink-4">暂无官方图</span>
                      )}
                    </span>
                    <span className="block h-[3px]" style={{ background: gradeColor(weapon.grade) }} />
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-[15px] font-semibold text-ink">{weapon.name}</span>
                      <span className="mt-1 block text-[13px] text-ink-3">
                        <span className="text-[#24527f] dark:text-[#9ec0ff]">{weapon.categoryLabel}</span>
                        {" · "}
                        <span className="num">{codes.length}</span> 个方案
                      </span>
                      <span className="mt-1 block text-[13px] text-ink-2">
                        最低 <span className="num font-semibold text-amber">{priceLabel(lowestTotal(codes))}</span>
                      </span>
                      {weapon.ttkText ? <span className="mt-1 block truncate text-[12px] text-ink-3" title={weapon.ttkNote ?? undefined}>{weapon.ttkText}</span> : null}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-card border border-line bg-surface px-4 py-10 text-center text-[14px] text-ink-3">这个筛选下还没有改枪码。</p>
          )}
        </div>
      </div>
      <style>{`
        .armory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        @container (min-width: 640px) { .armory-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @container (min-width: 920px) { .armory-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      `}</style>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="text-[13px] text-ink-2">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        className="rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function Chip({ pressed, square, onClick, children }: { pressed: boolean; square?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${square ? "rounded-control" : "rounded-full"} ${pressed ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-ink-2"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
