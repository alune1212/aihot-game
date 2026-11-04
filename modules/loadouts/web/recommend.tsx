import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { pageMeta } from "@aihot/web/lib/seo";
import { IconChevronLeft } from "@aihot/web/components/icons";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { isWeaponListed, WEAPON_CATEGORIES } from "../catalog.ts";
import { PLAYSTYLES, STAT_FIELDS, type PlayStyle, type StatKey } from "../recommend-rules.ts";
import { LOADOUT_MODES } from "../query.ts";

export const handle: Screen = { tab: "loadouts", name: "推荐" };

interface SourceMark { label: string; url: string | null }
interface Hit {
  id: number;
  code: string;
  weapon: string;
  categoryLabel: string;
  mode: string | null;
  author: string | null;
  sources: SourceMark[];
  popularityText: string | null;
  tier: string | null;
  ttkText: string | null;
  costText: string | null;
  coverage: number | null;
  score: number;
  parts: Array<{ slotName: string; name: string; share: number }>;
  explanation: string;
  tradeoff: string;
  explanationSource: "template" | "model";
}
interface Payload {
  pricesAvailable: boolean;
  budgetApplied: boolean;
  popularityReady: boolean;
  query: {
    mode: string | null;
    style: PlayStyle;
    styleLabel: string;
    stats: StatKey[];
    weapon: string | null;
    category: string | null;
    budgetWan: number | null;
  };
  matched: number;
  results: Hit[];
  note: string;
}

export async function loader({ request }: { request: Request }) {
  const search = new URL(request.url).search;
  return apiGet<Payload>(`/api/loadouts/recommend${search}`, { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "改枪码推荐",
    description: "按模式、玩法和预算，从已经收录的改枪码里挑。不会新编方案码。",
    path: "/loadouts/recommend",
  });
}

export default function RecommendPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const style = data.query.style;
  const stats = new Set(data.query.stats);
  const category = data.query.category;
  const weapon = data.query.weapon;

  function patch(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { preventScrollReset: true });
  }

  function toggleStat(key: StatKey) {
    const next = new Set(stats);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const ordered = STAT_FIELDS.map((item) => item.key).filter((item) => next.has(item));
    patch({ stats: ordered.length ? ordered.join(",") : null });
  }

  const guns = WEAPON_CATEGORIES.flatMap((group) => group.weapons.filter((item) => isWeaponListed(item)).map((item) => ({
    categoryKey: group.key,
    categoryLabel: group.label,
    name: item.name,
  })));
  const visibleGuns = category ? guns.filter((item) => item.categoryKey === category || item.name === weapon) : guns;

  return (
    <div className="pb-8">
      <PhoneBar back={{ to: "/loadouts", label: "改枪码" }} title="推荐" />
      <header className="pt-3 lg:pt-1">
        <a href="/loadouts" className="inline-flex items-center gap-0.5 text-[13px] text-ink-3 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <IconChevronLeft size={16} />
          返回改枪码
        </a>
        <h1 data-page-title="" className="mt-3 text-[26px] font-semibold leading-tight text-ink">按玩法挑改枪码</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">只排库里已经有的方案。条件变了就重新打分，不会编一串新的码。</p>
      </header>
      <form className="mt-4 rounded-card border border-line bg-surface p-4" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="min-w-0">
          <legend className="text-[12px] font-semibold text-ink-3">模式</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="模式">
            <Choice on={!data.query.mode} onClick={() => patch({ mode: null })}>不限</Choice>
            {LOADOUT_MODES.map((item) => <Choice key={item} on={data.query.mode === item} onClick={() => patch({ mode: item })}>{item}</Choice>)}
          </div>
        </fieldset>
        <fieldset className="mt-4 min-w-0">
          <legend className="text-[12px] font-semibold text-ink-3">玩法</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="玩法">
            {PLAYSTYLES.map((item) => <Choice key={item.id} on={style === item.id} title={item.hint} onClick={() => patch({ style: item.id === "balanced" ? null : item.id })}>{item.label}</Choice>)}
          </div>
        </fieldset>
        <fieldset className="mt-4 min-w-0">
          <legend className="text-[12px] font-semibold text-ink-3">更看重的属性</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {STAT_FIELDS.map((item) => <Choice key={item.key} on={stats.has(item.key)} onClick={() => toggleStat(item.key)}>{item.label}</Choice>)}
          </div>
        </fieldset>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-[12px] font-semibold text-ink-3">
            枪种
            <select
              aria-label="枪种"
              value={category ?? ""}
              className="mt-1 w-full rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => patch({ category: event.target.value || null, weapon: null })}
            >
              <option value="">不限枪种</option>
              {WEAPON_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-3">
            枪
            <select
              aria-label="枪"
              value={weapon ?? ""}
              className="mt-1 w-full rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => patch({ weapon: event.target.value || null })}
            >
              <option value="">不限枪</option>
              {visibleGuns.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-3">
            预算（万）
            <input
              inputMode="decimal"
              disabled={!data.pricesAvailable}
              value={searchParams.get("budget") ?? ""}
              placeholder={data.pricesAvailable ? "不限" : "暂无总价"}
              aria-label="预算，单位万"
              className="mt-1 w-full rounded-control border border-line bg-surface px-2 py-1.5 text-[13px] font-normal text-ink placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => patch({ budget: event.target.value.trim() || null })}
            />
          </label>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
          {data.pricesAvailable
            ? "预算按覆盖率 100% 的整枪总价。缺价的方案设了预算之后不参与。"
            : "还没有覆盖完整的交易行总价，预算先不筛。价格齐了以后这项会自己生效。"}
        </p>
      </form>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{data.note}</p>
      {data.results.length ? (
        <ol data-recommend-results="" className="mt-3 space-y-3">
          {data.results.map((hit, index) => (
            <li key={hit.id} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-ink-3">第 <span className="num">{index + 1}</span> 名</p>
                  <h2 className="mt-0.5 text-[18px] font-semibold leading-snug text-ink">
                    <a href={`/loadouts/gun/${encodeURIComponent(hit.weapon)}?code=${hit.id}`} className="hover:text-accent">{hit.weapon}</a>
                  </h2>
                </div>
                <p className="shrink-0 text-right">
                  <span className="num block text-[22px] font-bold leading-none text-accent">{hit.score}</span>
                  <span className="text-[11px] text-ink-4">匹配</span>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                {hit.mode ? <span className="rounded-mark border border-line bg-bg-sunk px-1.5 py-0.5 text-ink-2">{hit.mode}</span> : null}
                <span className="text-ink-3">{hit.categoryLabel}</span>
                {hit.sources.map((source) => (
                  source.url
                    ? <a key={source.label} href={source.url} className="rounded-mark border border-line px-1.5 py-0.5 text-ink-2 hover:text-accent">{source.label}</a>
                    : <span key={source.label} className={`rounded-mark px-1.5 py-0.5 font-semibold ${source.label === "官方热门" ? "bg-ok-soft text-ok-ink" : "border border-line text-ink-2"}`}>{source.label}</span>
                ))}
                {hit.tier ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 font-semibold text-amber-ink">聪聪 {hit.tier}</span> : null}
                {hit.ttkText ? <span className="text-ink-3">{hit.ttkText}</span> : null}
                {hit.costText
                  ? <span className="num font-semibold text-amber">{hit.costText}</span>
                  : hit.coverage != null && hit.coverage > 0 && hit.coverage < 100
                    ? <span className="text-ink-4">价格覆盖 <span className="num">{hit.coverage}</span>%</span>
                    : <span className="text-ink-4">总价未齐</span>}
                {hit.author ? <span className="text-ink-3">{hit.author}</span> : null}
                {hit.popularityText ? <span className="text-ink-3">{hit.popularityText}</span> : null}
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-ink">{hit.explanation}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-3">取舍：{hit.tradeoff}</p>
              {hit.explanationSource === "model" ? <p className="mt-1 text-[12px] text-ink-4">这句说明由模型按上面的事实改写。</p> : null}
              {hit.parts.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {hit.parts.map((part) => (
                    <li key={`${part.slotName}-${part.name}`} className="rounded-mark border border-line px-1.5 py-0.5 text-[12px] text-ink-2">
                      {part.slotName} {part.name} <span className="num">{Math.round(part.share * 100)}%</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <p className="min-w-0 flex-1 break-all rounded-control border border-line bg-bg-sunk px-3 py-2 font-mono text-[12px] leading-snug text-ink">{hit.code}</p>
                <CopyCode value={hit.code} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 rounded-card border border-line bg-surface px-4 py-10 text-center text-[14px] text-ink-3">这个条件底下没有可推荐的现成改枪码。</p>
      )}
    </div>
  );
}

function Choice({ on, title, onClick, children }: { on: boolean; title?: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      className={`rounded-control border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-ink-2"}`}
      onClick={onClick}
    >
      {children}
    </button>
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
