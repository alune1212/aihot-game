import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLoaderData, useLocation, useSearchParams } from "react-router";
import { beijingStamp } from "@aihot/contracts/time";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { pageMeta } from "@aihot/web/lib/seo";
import { IconChevronLeft } from "@aihot/web/components/icons";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { LOADOUT_MODES, LOADOUT_SOURCES, type LoadoutSort } from "../query.ts";
import { AttachmentHeat, type AttachmentReport } from "./heat.tsx";

export const handle: Screen = { tab: "loadouts", name: "改枪" };

const DESKTOP = "(min-width: 700px)";
const SORTS = [
  { id: "popularity", label: "热度" },
  { id: "newest", label: "最新" },
  { id: "price", label: "价格" },
  { id: "tier", label: "梯队" },
] as const;

interface ShownSource { label: string; url: string | null }
interface LoadoutCode {
  id: number;
  code: string;
  mode: string | null;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  sources: ShownSource[];
  popularityText: string | null;
  likesText: string | null;
  featured: boolean;
  stale: boolean;
  verification: "ok" | "pending" | "removed" | null;
  totalText: string | null;
  total: number | null;
  name: string | null;
  partCount: number;
}
interface Summary {
  total: number;
  priceMin: number | null;
  priceMax: number | null;
  modes: Array<{ mode: string; count: number }>;
}
interface WeaponView {
  name: string;
  categoryKey: string;
  categoryLabel: string;
  pic: string | null;
  grade: number | null;
  tier: string | null;
  tierAsOf: string | null;
  ttkText: string | null;
  ttkNote: string | null;
  patchText: string | null;
  summary: Summary;
  codes: LoadoutCode[];
  attachments: AttachmentReport | null;
}
interface Effect { value: string; color: "green" | "red" }
interface Slot {
  slotId: string;
  slotName: string;
  objectId: number | null;
  name: string | null;
  pic: string | null;
  grade: number | null;
  effects: Effect[];
  price: number | null;
}
interface Stats {
  meatHarm: number;
  shootDistance: number;
  recoil: number;
  control: number;
  stable: number;
  hipShot: number;
  armorHarm: number;
  fireSpeed: number;
}
interface Selected {
  code: {
    id: number;
    code: string;
    mode: string | null;
    author: string | null;
    source: string | null;
    sources: ShownSource[];
    popularityText: string | null;
    likesText: string | null;
    featured: boolean;
    verification: "ok" | "pending" | "removed" | null;
    priceText: string | null;
  };
  detail: {
    name: string | null;
    syncedAt: string;
    properties: { origin: Stats; change: Stats | null; fireMode: string | null; muzzleVelocity: number | null; capacity: number | null } | null;
    slots: Slot[];
    prices: { gun: number | null; parts: number | null; total: number | null; pricedAt: string | null; complete: boolean };
  } | null;
}
interface Payload {
  weapon: WeaponView;
  selected: Selected | null;
}

const BARS: Array<{ key: keyof Stats; label: string; scale: number }> = [
  { key: "meatHarm", label: "基础伤害", scale: 100 },
  { key: "armorHarm", label: "对甲伤害", scale: 100 },
  { key: "shootDistance", label: "有效射程", scale: 100 },
  { key: "recoil", label: "后坐力控制", scale: 100 },
  { key: "control", label: "操控速度", scale: 100 },
  { key: "stable", label: "据枪稳定性", scale: 100 },
  { key: "hipShot", label: "腰际射击精度", scale: 100 },
  { key: "fireSpeed", label: "射速", scale: 1000 },
];

export async function loader({ request, params }: { request: Request; params: { weapon?: string } }) {
  const name = params.weapon ?? "";
  const search = new URL(request.url).search;
  return loadOr404<Payload>(`/api/loadouts/gun/${encodeURIComponent(name)}${search}`, { signal: request.signal });
}

export function meta({ loaderData }: { loaderData?: Payload }) {
  const weapon = loaderData?.weapon.name ?? "改枪码";
  return pageMeta({
    title: `${weapon}改枪码`,
    description: `${weapon}的改枪方案，含配件、最新价格和改装前后属性。价格以游戏内交易行为准。`,
    path: `/loadouts/gun/${encodeURIComponent(weapon)}`,
  });
}

function playerhubPic(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "playerhub.df.qq.com") return null;
    return url;
  } catch {
    return null;
  }
}

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

function priceLabel(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value < 10000) return String(Math.round(value));
  const wan = value / 10000;
  const shown = wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10);
  return `${shown}万`;
}

function tierClass(tier: string): string {
  if (tier.startsWith("S")) return "bg-amber-soft text-amber-ink";
  if (tier.startsWith("A")) return "bg-ok-soft text-ok-ink";
  if (tier.startsWith("B")) return "bg-accent-soft text-accent-ink";
  return "border border-line text-ink-2";
}

function schemeTitle(code: { name: string | null; author: string | null }): string {
  return code.name ?? (code.author ? `${code.author}的方案` : "改枪方案");
}

export default function GunLoadoutsPage() {
  const { weapon, selected } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const mode = LOADOUT_MODES.find((item) => item === searchParams.get("mode")) ?? null;
  const source = LOADOUT_SOURCES.find((item) => item === searchParams.get("source")) ?? null;
  const sort = SORTS.some((item) => item.id === searchParams.get("sort")) ? searchParams.get("sort") as LoadoutSort : "popularity";
  const pendingOnly = searchParams.get("pending") === "1";
  const codeParam = searchParams.get("code");
  const active = weapon.codes.find((code) => String(code.id) === codeParam) ?? null;
  const hasCode = Boolean(codeParam && selected);
  const outsideFilter = Boolean(selected && !active);

  function href(next: Record<string, string | null>, code?: string | null): string {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (code !== undefined) {
      if (code) params.set("code", code);
      else params.delete("code");
    }
    const text = params.toString();
    return `${pathname}${text ? `?${text}` : ""}`;
  }

  useEffect(() => {
    if (codeParam || !weapon.codes[0]) return;
    if (!window.matchMedia(DESKTOP).matches) return;
    const params = new URLSearchParams(searchParams);
    params.set("code", String(weapon.codes[0].id));
    setSearchParams(params, { replace: true, preventScrollReset: true });
  }, [codeParam, weapon.codes, searchParams, setSearchParams]);

  const picture = playerhubPic(weapon.pic);
  const listBack = href({}, null);
  return (
    <div className="pb-8">
      <PhoneBar back={hasCode ? { to: listBack, label: "方案" } : { to: "/loadouts", label: "改枪码" }} title={weapon.name} />
      <header>
        <a href="/loadouts" className="inline-flex items-center gap-0.5 pt-3 text-[13px] text-ink-3 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:pt-1">
          <IconChevronLeft size={16} />
          返回改枪码
        </a>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex w-full flex-col overflow-hidden rounded-panel border border-line sm:w-[420px] sm:shrink-0">
            <div className="gun-well relative flex h-[128px] shrink-0 items-center justify-center px-3" style={wellStyle(weapon.grade)}>
              {picture
                ? <img data-gun="" src={picture} alt="" width={420} height={120} fetchPriority="high" decoding="async" className="gun-sprite max-h-[120px] max-w-full object-contain" />
                : <span className="text-[13px] text-ink-4">暂无官方图</span>}
              <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: gradeColor(weapon.grade) }} />
            </div>
          </div>
          <div className="min-w-0">
            <h1 data-page-title="" className="text-[26px] font-semibold leading-tight text-ink">{weapon.name}</h1>
            <p className="mt-1 text-[14px] text-ink-2">
              {weapon.categoryLabel}
              {" · "}
              <span className="num">{weapon.summary.total}</span> 个方案
              {" · "}
              <span className="num font-semibold text-amber">{priceLabel(weapon.summary.priceMin)}</span>
              <span className="text-ink-3"> – </span>
              <span className="num font-semibold text-amber">{priceLabel(weapon.summary.priceMax)}</span>
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              {weapon.tier ? <span className={`rounded-mark px-1.5 py-0.5 text-[12px] font-semibold ${tierClass(weapon.tier)}`} title={`聪聪强度梯队${weapon.tierAsOf ? `，${weapon.tierAsOf} 更新` : ""}。社区排名，不是官方`}>聪聪 {weapon.tier}</span> : null}
              {weapon.ttkText ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-[12px] text-ink-2" title={weapon.ttkNote ?? undefined}>{weapon.ttkText}</span> : null}
              <a href={`/loadouts/recommend?weapon=${encodeURIComponent(weapon.name)}`} className="rounded-mark border border-accent bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-ink">按这把枪推荐</a>
            </p>
            <p className="mt-2 text-[13px] text-ink-3">
              {weapon.summary.modes.map((item, index) => (
                <span key={item.mode}>{index ? " · " : ""}{item.mode} <span className="num">{item.count}</span></span>
              ))}
            </p>
            {weapon.patchText ? <p className="mt-1 text-[12px] leading-relaxed text-ink-4">{weapon.patchText}</p> : null}
          </div>
        </div>
      </header>
      {weapon.attachments ? (
        <AttachmentHeat report={weapon.attachments} pageMode={mode} tier={weapon.tier} tierAsOf={weapon.tierAsOf} ttkText={weapon.ttkText} ttkNote={weapon.ttkNote} />
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="模式">
        <Chip href={href({ mode: null })} pressed={!mode}>全部模式</Chip>
        {LOADOUT_MODES.map((item) => <Chip key={item} href={href({ mode: item })} pressed={mode === item}>{item}</Chip>)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="更多筛选">
        <label className="min-w-[8rem] flex-1">
          <span className="sr-only">搜索作者或枪名</span>
          <input
            value={searchParams.get("q") ?? ""}
            placeholder="作者、主播或枪名"
            className="w-full rounded-control border border-line bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => {
              const params = new URLSearchParams(searchParams);
              const value = event.target.value;
              if (value) params.set("q", value);
              else params.delete("q");
              setSearchParams(params, { preventScrollReset: true, replace: true });
            }}
          />
        </label>
        <FilterSelect label="排序" value={sort} onChange={(value) => setSearchParams(hrefParams(searchParams, { sort: value === "popularity" ? null : value }), { preventScrollReset: true })}>
          {SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </FilterSelect>
        <FilterSelect label="来源" value={source ?? ""} onChange={(value) => setSearchParams(hrefParams(searchParams, { source: value || null }), { preventScrollReset: true })}>
          <option value="">全部来源</option>
          {LOADOUT_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
        </FilterSelect>
        <label className="flex items-center gap-1 text-[13px] text-ink-2">
          <span className="sr-only">最低价，单位万</span>
          <input inputMode="decimal" value={searchParams.get("min") ?? ""} placeholder="最低万" className="w-16 rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => setSearchParams(hrefParams(searchParams, { min: event.target.value.trim() || null }), { preventScrollReset: true, replace: true })} />
          <span aria-hidden="true">–</span>
          <span className="sr-only">最高价，单位万</span>
          <input inputMode="decimal" value={searchParams.get("max") ?? ""} placeholder="最高万" className="w-16 rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => setSearchParams(hrefParams(searchParams, { max: event.target.value.trim() || null }), { preventScrollReset: true, replace: true })} />
        </label>
        <Chip href={href({ pending: pendingOnly ? null : "1" })} pressed={pendingOnly}>待验证</Chip>
      </div>
      <p className="mt-3 text-[13px] text-ink-3">当前 <span className="num">{weapon.codes.length}</span> 条</p>
      <div className="mt-3 lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-4">
        <div className={hasCode ? "hidden lg:block" : ""}>
          {weapon.codes.length ? (
            <ul className="overflow-hidden rounded-card border border-line bg-surface" aria-label="方案列表">
              {weapon.codes.map((code) => {
                const on = String(code.id) === codeParam;
                return (
                  <li key={code.id} className="gun-code-row border-b border-line last:border-b-0">
                    <a href={href({}, String(code.id))} aria-current={on ? "page" : undefined} className={`block px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "bg-accent-soft" : "hover:bg-bg-sunk"}`}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[14px] font-semibold text-ink">{schemeTitle(code)}</span>
                        <span className="num shrink-0 text-[14px] font-bold text-amber">{code.totalText ?? "—"}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                        {code.mode ? <span className="rounded-mark border border-[#31465f] bg-[#172232] px-1.5 py-0.5 text-[#d6e6ff]">{code.mode}</span> : null}
                        <SourceMarks code={code} />
                        {code.featured ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 font-semibold text-amber-ink">主播</span> : null}
                        {code.verification === "pending" ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-4">待验证</span> : null}
                        {code.verification === "removed" ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-4">源站已撤</span> : null}
                        {code.popularityText ? <span className="text-ink-3">{code.popularityText}</span> : null}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-[14px] text-ink-3">这个筛选下还没有这把枪的方案。</p>
          )}
        </div>
        <div className={`${hasCode ? "" : "hidden"} lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain`}>
          {hasCode ? (
            <a href={listBack} className="mb-3 inline-flex items-center gap-0.5 text-[13px] text-ink-3 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden">
              <IconChevronLeft size={16} />
              返回方案
            </a>
          ) : null}
          {selected ? (
            <CodeDetail code={selected} outside={outsideFilter} title={active ? schemeTitle(active) : (selected.detail?.name || schemeTitle({ name: null, author: selected.code.author }))} />
          ) : (
            <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-[14px] text-ink-3">从左边选一条方案。</p>
          )}
        </div>
      </div>
      <style>{`
        .gun-code-row { content-visibility: auto; contain-intrinsic-size: auto 64px; }
      `}</style>
    </div>
  );
}

function hrefParams(current: URLSearchParams, next: Record<string, string | null>): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(next)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

function Chip({ href, pressed, children }: { href: string; pressed: boolean; children: string }) {
  return (
    <a href={href} aria-current={pressed ? "true" : undefined} className={`rounded-control border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${pressed ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-ink-2"}`}>
      {children}
    </a>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="text-[13px] text-ink-2">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} className="rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function SourceMarks({ code }: { code: { source: string | null; sourceUrl?: string | null; sources?: ShownSource[] } }) {
  const marks = code.sources?.length ? code.sources : (code.source ? [{ label: code.source, url: code.sourceUrl ?? null }] : []);
  return marks.map((item) => (
    item.url
      ? <a key={item.label} href={item.url} className="rounded-mark border border-line px-1.5 py-0.5 text-ink-2 hover:text-accent">{item.label}</a>
      : <span key={item.label} className={`rounded-mark px-1.5 py-0.5 font-semibold ${item.label === "官方热门" ? "bg-ok-soft text-ok-ink" : "border border-line text-ink-2"}`}>{item.label}</span>
  ));
}

function CodeDetail({ code, title, outside }: { code: Selected; title: string; outside: boolean }) {
  const detail = code.detail;
  const installed = detail?.slots.filter((slot) => slot.objectId) ?? [];
  const updatedAt = detail ? beijingStamp(detail.prices.pricedAt ?? detail.syncedAt) : null;
  return (
    <article data-code-detail="" className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-[20px] font-semibold leading-snug text-ink">{title}</h2>
      {outside ? <p className="mt-1 text-[12px] text-ink-4">这条不在当前筛选里。</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        {code.code.mode ? <span className="rounded-mark border border-[#31465f] bg-[#172232] px-1.5 py-0.5 text-[#d6e6ff]">{code.code.mode}</span> : null}
        <SourceMarks code={code.code} />
        {code.code.featured ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 font-semibold text-amber-ink">主播</span> : null}
        {code.code.verification === "pending" ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-4">待验证</span> : null}
        {code.code.verification === "removed" ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-4">源站已撤</span> : null}
        {code.code.author ? <span className="text-ink-3">作者 <span className="font-semibold text-ink">{code.code.author}</span></span> : null}
        {code.code.popularityText ? <span className="text-ink-3">{code.code.popularityText}</span> : null}
        {code.code.likesText ? <span className="text-ink-3">{code.code.likesText}</span> : null}
      </div>
      {detail ? (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-tile border border-line bg-bg-sunk px-3 py-2">
            <dt className="text-[12px] text-ink-3">配件合计</dt>
            <dd className="num mt-0.5 text-[16px] font-bold text-amber">{priceLabel(detail.prices.parts)}</dd>
          </div>
          <div className="rounded-tile border border-line bg-bg-sunk px-3 py-2">
            <dt className="text-[12px] text-ink-3">枪身</dt>
            <dd className="num mt-0.5 text-[16px] font-bold text-amber">{priceLabel(detail.prices.gun)}</dd>
          </div>
          <div className="rounded-tile border border-ok bg-ok-soft px-3 py-2">
            <dt className="text-[12px] text-ink-3">整枪总价</dt>
            <dd className="num mt-0.5 text-[20px] font-bold leading-none text-amber">{priceLabel(detail.prices.total)}</dd>
          </div>
        </dl>
      ) : (
        <p className="num mt-3 text-[22px] font-bold text-amber">{code.code.priceText ?? "—"}</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <p className="min-w-0 flex-1 break-all rounded-control border border-line bg-bg-sunk px-3 py-2 font-mono text-[12px] leading-snug text-ink">{code.code.code}</p>
        <CopyCode value={code.code.code} />
      </div>
      {detail ? <p className="mt-2 text-[12px] text-ink-4">以游戏内交易行为准{updatedAt ? ` · 更新于 ${updatedAt}（北京时间）` : ""}{detail.prices.complete ? "" : " · 有的配件还没有价格，总价先不算"}</p> : null}
      {detail ? (
        <>
          <h3 className="mt-4 text-[14px] font-bold text-ink">配件 <span className="ml-1 text-[12px] font-medium text-ink-3">{installed.length} 件 · 官方交易行均价</span></h3>
          {installed.length ? (
            <ul className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-3">
              {installed.map((slot) => {
                const pic = playerhubPic(slot.pic);
                return (
                  <li key={slot.slotId} className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-[#24527f] dark:text-[#9ec0ff]">{slot.slotName}</p>
                    <div className="gun-well mt-1 grid h-[76px] place-items-center rounded-control border-2 p-1" style={{ ...wellStyle(slot.grade), borderColor: gradeColor(slot.grade) }}>
                      {pic ? <img src={pic} alt="" width={120} height={72} loading="lazy" decoding="async" className="gun-sprite max-h-full max-w-full object-contain" /> : <span className="text-[12px] text-ink-4">无图</span>}
                    </div>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">{slot.name ?? "未命名配件"}</p>
                    <p className="text-[12px] text-ink-3">单价 <span className="num font-bold text-amber">{priceLabel(slot.price)}</span></p>
                    {slot.effects.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {slot.effects.map((effect) => (
                          <li key={effect.value} className={`text-[12px] leading-snug ${effect.color === "green" ? "text-ok" : "text-hot"}`}>{effect.value}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-2 text-[13px] text-ink-3">官方方案里没有已安装的配件。</p>}
          <h3 className="mt-4 text-[14px] font-bold text-ink">枪械属性 <span className="ml-1 text-[12px] font-medium text-ink-3">改装前 / 改装后</span></h3>
          <AttributeBars properties={detail.properties} />
        </>
      ) : (
        <p className="mt-3 rounded-tile border border-line bg-bg-sunk px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          <strong className="font-semibold">解不出配件。</strong>
          <span className="mt-1 block text-ink-3">这条码不在官方方案里。码尾不是配件编号的公开编码，所以没有配件、价格和改装属性，这里不会猜一套。</span>
        </p>
      )}
    </article>
  );
}

function AttributeBars({ properties }: { properties: NonNullable<Selected["detail"]>["properties"] }) {
  if (!properties) return <p className="mt-2 text-[13px] text-ink-3">官方方案里没有这把枪的属性。</p>;
  const extra = [
    properties.fireMode ? `射击模式 ${properties.fireMode}` : null,
    properties.capacity != null ? `弹匣容量 ${properties.capacity}` : null,
    properties.muzzleVelocity != null ? `初速 ${properties.muzzleVelocity}` : null,
  ].filter(Boolean);
  return (
    <div className="mt-2 flex flex-col gap-2">
      {BARS.map((row) => {
        const before = properties.origin[row.key];
        const delta = properties.change ? properties.change[row.key] : 0;
        const after = before + delta;
        const base = Math.max(0, Math.min(100, (before / row.scale) * 100));
        const next = Math.max(0, Math.min(100, (after / row.scale) * 100));
        return (
          <div key={row.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
            <span className="text-[12px] text-ink-3">{row.label}</span>
            <span className="relative h-2 overflow-hidden rounded-full bg-bg-muted" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[#8a93a8]/80" style={{ width: `${base}%` }} />
              {delta > 0 ? <span className="absolute inset-y-0 rounded-full bg-accent" style={{ left: `${base}%`, width: `${Math.max(0, next - base)}%` }} /> : null}
              {delta < 0 ? <span className="absolute inset-y-0 rounded-full bg-hot" style={{ left: `${next}%`, width: `${Math.max(0, base - next)}%` }} /> : null}
            </span>
            <span className="num text-right text-[13px] font-bold text-ink">
              {after}
              {delta > 0 ? <span className="ml-1 text-accent">+{delta}</span> : null}
              {delta < 0 ? <span className="ml-1 text-hot">{delta}</span> : null}
            </span>
          </div>
        );
      })}
      {extra.length ? <p className="text-[12px] text-ink-3">{extra.join(" · ")}</p> : null}
    </div>
  );
}

function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-control bg-accent px-3 py-2 text-[13px] font-semibold text-accent-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={() => {
        void copyText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "已复制" : "复制改枪码"}
    </button>
  );
}
