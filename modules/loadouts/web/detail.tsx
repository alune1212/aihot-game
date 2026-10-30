import { useState } from "react";
import { data, useLoaderData } from "react-router";
import { beijingStamp } from "@aihot/contracts/time";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "loadouts", name: "改枪" };

type StatKey = "meatHarm" | "shootDistance" | "recoil" | "control" | "stable" | "hipShot" | "armorHarm" | "fireSpeed";
type Stats = Record<StatKey, number>;

interface Effect {
  value: string;
  color: "green" | "red";
}

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

interface Sibling {
  id: number;
  name: string | null;
  mode: string | null;
  source: string | null;
  popularityText: string | null;
  featured: boolean;
  stale: boolean;
  hasDetail: boolean;
}

interface Related {
  id: number;
  name: string | null;
  source: string | null;
  popularityText: string | null;
  totalText: string | null;
  pic: string | null;
}

interface Payload {
  game: { id: string; name: string };
  code: {
    id: number;
    weapon: string;
    categoryKey: string;
    code: string;
    mode: string | null;
    priceText: string | null;
    author: string | null;
    source: string | null;
    sourceUrl: string | null;
    popularityText: string | null;
    featured: boolean;
    stale: boolean;
  };
  categoryLabel: string;
  gun: { pic: string | null; grade: number | null; objectId: number | null };
  siblings: Sibling[];
  related: Related[];
  detail: {
    source: "ams";
    sourceLabel: string;
    syncedAt: string;
    name: string | null;
    previewPic: string | null;
    gun: { objectId: number | null; name: string; pic: string | null; grade: number | null };
    properties: { origin: Stats; change: Stats | null; fireMode: string | null; muzzleVelocity: number | null; capacity: number | null } | null;
    slots: Slot[];
    prices: { gun: number | null; parts: number | null; total: number | null; pricedAt: string | null; complete: boolean };
  } | null;
}

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  const id = params.id ?? "";
  if (!/^\d+$/.test(id)) throw data({ message: "not_found" }, { status: 404 });
  return loadOr404<Payload>(`/api/loadouts/${id}`, { signal: request.signal });
}

export function meta({ loaderData }: { loaderData?: Payload }) {
  const weapon = loaderData?.code.weapon ?? "改枪码";
  const name = loaderData?.game.name ?? "三角洲行动";
  return pageMeta({
    title: `${loaderData?.detail?.name || weapon}改枪方案`,
    description: `${name} ${weapon} 的改枪方案，含配件、最新价格和改装前后属性。价格以游戏内交易行为准。`,
    path: loaderData ? `/loadouts/${loaderData.code.id}` : "/loadouts",
  });
}

const RADAR: Array<{ key: StatKey; label: string; scale: number }> = [
  { key: "meatHarm", label: "伤害", scale: 100 },
  { key: "armorHarm", label: "护甲", scale: 100 },
  { key: "shootDistance", label: "射程", scale: 100 },
  { key: "recoil", label: "后坐", scale: 100 },
  { key: "control", label: "操控", scale: 100 },
  { key: "stable", label: "稳定", scale: 100 },
  { key: "hipShot", label: "腰射", scale: 100 },
  { key: "fireSpeed", label: "射速", scale: 1200 },
];

const BARS: Array<{ key: StatKey; label: string; scale: number }> = [
  { key: "meatHarm", label: "基础伤害", scale: 100 },
  { key: "armorHarm", label: "对甲伤害", scale: 100 },
  { key: "shootDistance", label: "有效射程", scale: 100 },
  { key: "recoil", label: "后坐力控制", scale: 100 },
  { key: "control", label: "操控速度", scale: 100 },
  { key: "stable", label: "据枪稳定性", scale: 100 },
  { key: "hipShot", label: "腰际射击精度", scale: 100 },
  { key: "fireSpeed", label: "射速", scale: 1000 },
];

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

/** 0 和 1 是普通品质，用中性色，不套绿蓝紫金红。 */
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

function gradeWell(grade: number | null): string {
  switch (grade) {
    case 2: return "radial-gradient(ellipse at center,#1c4030 0%,#121820 72%)";
    case 3: return "radial-gradient(ellipse at center,#1a3050 0%,#121820 72%)";
    case 4: return "radial-gradient(ellipse at center,#321c4a 0%,#121820 72%)";
    case 5: return "radial-gradient(ellipse at center,#403418 0%,#121820 72%)";
    case 6: return "radial-gradient(ellipse at center,#4a2020 0%,#121820 72%)";
    default: return "radial-gradient(ellipse at center,#2a3548 0%,#121820 72%)";
  }
}

function money(value: number | null): string {
  if (value === null) return "—";
  if (value < 10000) return String(value);
  const wan = value / 10000;
  const shown = wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10);
  return `${shown}万`;
}

function signed(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function point(index: number, value: number, scale: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + (index / RADAR.length) * Math.PI * 2;
  const length = Math.max(0, Math.min(1, value / scale)) * radius;
  return [100 + Math.cos(angle) * length, 100 + Math.sin(angle) * length];
}

function polygon(stats: Stats, radius: number): string {
  return RADAR.map((axis, index) => point(index, stats[axis.key], axis.scale, radius).join(",")).join(" ");
}

function pct(value: number, scale: number): number {
  if (!Number.isFinite(value) || scale <= 0) return 0;
  return Math.max(0, Math.min(100, (value / scale) * 100));
}

function schemeLabel(name: string | null, mode: string | null): string {
  return name || mode || "方案";
}

export default function LoadoutDetailPage() {
  const { code, categoryLabel, gun, siblings, related, detail } = useLoaderData<typeof loader>();
  const title = detail?.name || code.weapon;
  const crumb = detail?.name || (code.source ? `${code.source}方案` : "改枪方案");
  const picture = playerhubPic(detail?.previewPic) || playerhubPic(detail?.gun.pic) || playerhubPic(gun.pic);
  const grade = detail ? detail.gun.grade : gun.grade;
  const listCategory = `/loadouts?category=${encodeURIComponent(code.categoryKey)}`;
  const listGun = `${listCategory}&gun=${encodeURIComponent(code.weapon)}`;
  const installed = detail?.slots.filter((slot) => slot.objectId) ?? [];
  const updatedAt = detail ? beijingStamp(detail.prices.pricedAt ?? detail.syncedAt) : null;
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: listGun, label: code.weapon }} title={title} />
      <nav aria-label="面包屑" className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[13px] text-ink-3 lg:pt-1">
        <a href="/loadouts" className="hover:text-accent">改枪码</a>
        <span aria-hidden="true">/</span>
        <a href={listCategory} className="hover:text-accent">{categoryLabel}</a>
        <span aria-hidden="true">/</span>
        <a href={listGun} className="hover:text-accent">{code.weapon}</a>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink" aria-current="page">{crumb}</span>
      </nav>
      {siblings.length > 1 ? (
        <nav aria-label="同枪方案" className="mt-3 flex flex-wrap gap-2">
          {siblings.map((item) => {
            const on = item.id === code.id;
            return (
              <a
                key={item.id}
                href={`/loadouts/${item.id}`}
                aria-current={on ? "page" : undefined}
                className={`max-w-full truncate rounded-control border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-ink-2 hover:text-ink"}`}
              >
                {schemeLabel(item.name, item.mode)}
              </a>
            );
          })}
        </nav>
      ) : null}
      <section className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">
        <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-panel border border-line bg-[radial-gradient(ellipse_at_center,#243044_0%,#10141c_70%)] px-4">
          {picture
            ? <img src={picture} alt="" width={640} height={240} fetchPriority="high" decoding="async" className="max-h-[240px] max-w-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]" />
            : <span className="text-[14px] text-[#c5ceda]">暂无官方图</span>}
          <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: gradeColor(grade) }} />
        </div>
        <div className="flex min-w-0 flex-col gap-2.5 py-1">
          <h1 data-page-title="" className="text-[26px] font-extrabold leading-tight text-ink">{title}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {code.mode ? <span className="rounded-mark border border-[#31465f] bg-[#172232] px-1.5 py-0.5 text-[12px] text-[#d6e6ff]">{code.mode}</span> : null}
            {code.source ? (
              code.sourceUrl
                ? <a href={code.sourceUrl} className="rounded-mark border border-line px-1.5 py-0.5 text-[12px] font-semibold text-ink-2 hover:text-accent">{code.source}</a>
                : <span className={`rounded-mark px-1.5 py-0.5 text-[12px] font-semibold ${code.source === "官方热门" ? "bg-ok-soft text-ok-ink" : "border border-line text-ink-2"}`}>{code.source}</span>
            ) : null}
            {code.featured ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 text-[12px] font-semibold text-amber-ink">主播</span> : null}
            {code.stale ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-[12px] text-ink-4">过季</span> : null}
          </div>
          {detail ? (
            <p className="text-[13px] text-ink-3">
              {code.author ? <>作者 <strong className="font-semibold text-ink">{code.author}</strong></> : null}
              {code.popularityText ? <span>{code.author ? " · " : ""}{code.popularityText}</span> : null}
            </p>
          ) : (
            <p className="num text-[28px] font-extrabold leading-none text-amber">{code.priceText ?? "—"}</p>
          )}
          {detail ? null : <p className="text-[12px] text-ink-4">{code.priceText ? "来源价 · " : ""}以游戏内交易行为准</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <p className="min-w-0 flex-1 break-all rounded-control border border-line bg-bg-sunk px-3 py-2.5 font-mono text-[13px] leading-snug text-ink">{code.code}</p>
            <CopyCode code={code.code} />
          </div>
          {detail ? (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-tile border border-line bg-surface px-3 py-2.5">
                  <dt className="text-[12px] text-ink-3">配件合计</dt>
                  <dd className="num mt-1 text-[18px] font-extrabold text-amber">{money(detail.prices.parts)}</dd>
                </div>
                <div className="rounded-tile border border-line bg-surface px-3 py-2.5">
                  <dt className="text-[12px] text-ink-3">枪身</dt>
                  <dd className="num mt-1 text-[18px] font-extrabold text-amber">{money(detail.prices.gun)}</dd>
                </div>
                <div className="rounded-tile border border-ok bg-ok-soft px-3 py-2.5">
                  <dt className="text-[12px] text-ink-3">整枪总价</dt>
                  <dd className="num mt-1 text-[22px] font-extrabold leading-none text-amber sm:text-[26px]">{money(detail.prices.total)}</dd>
                </div>
              </dl>
              <p className="text-[12px] text-ink-4">以游戏内交易行为准 · 更新于 {updatedAt}（北京时间）{detail.prices.complete ? "" : " · 有的配件还没有价格，总价先不算"}</p>
            </>
          ) : (
            <p className="rounded-tile border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink">
              <strong className="font-semibold">暂无官方配件详情，可在游戏内改枪台导入查看。</strong>
              <span className="mt-1 block text-ink-3">这条码还没对上官方方案，配件、属性和交易行价格先留空。</span>
            </p>
          )}
        </div>
      </section>
      {detail ? (
        <>
          <h2 className="mt-6 text-[14px] font-bold text-ink">枪械属性 <span className="ml-1 text-[12px] font-medium text-ink-3">改装前 / 改装后</span></h2>
          <div className="mt-3 grid items-center gap-4 rounded-panel border border-line bg-surface p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            {detail.properties ? <Radar origin={detail.properties.origin} change={detail.properties.change} /> : <p className="text-[13px] text-ink-3">官方方案里没有这把枪的属性。</p>}
            <AttributeBars properties={detail.properties} />
          </div>
          <h2 className="mt-6 text-[14px] font-bold text-ink">配件详情 <span className="ml-1 text-[12px] font-medium text-ink-3">{installed.length} 件 · 官方交易行均价</span></h2>
          {installed.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {installed.map((slot) => (
                <li key={slot.slotId} className="flex flex-col gap-1.5 rounded-card border-2 bg-surface p-3" style={{ borderColor: gradeColor(slot.grade) }}>
                  <p className="text-[12px] font-semibold text-[#24527f] dark:text-[#9ec0ff]">{slot.slotName}</p>
                  <div className="grid h-[88px] place-items-center rounded-control border-2 p-2" style={{ background: gradeWell(slot.grade), borderColor: gradeColor(slot.grade) }}>
                    {slot.pic
                      ? <img src={slot.pic} alt={slot.name ?? slot.slotName} width={120} height={72} loading="lazy" fetchPriority="low" decoding="async" className="max-h-[72px] max-w-full object-contain [filter:brightness(1.15)_drop-shadow(0_2px_6px_rgba(0,0,0,0.45))]" />
                      : <span className="text-[12px] text-[#c5ceda]">无图</span>}
                  </div>
                  <p className="min-h-[2.4em] text-[13px] font-bold leading-snug text-ink">{slot.name ?? "未命名配件"}</p>
                  <p className="text-[12px] text-ink-3">单价 <span className="num font-bold text-amber">{money(slot.price)}</span></p>
                  {slot.effects.length ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {slot.effects.map((effect) => (
                        <li key={effect.value} className={`text-[12px] leading-snug ${effect.color === "green" ? "text-ok" : "text-hot"}`}>{effect.value}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">官方方案里没有已安装的配件。</p>
          )}
        </>
      ) : related.length ? (
        <section className="mt-8" aria-labelledby="related-title">
          <h2 id="related-title" className="text-[14px] font-bold text-ink">同枪官方热门方案</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {related.map((item) => {
              const pic = playerhubPic(item.pic);
              return (
                <li key={item.id}>
                  <a href={`/loadouts/${item.id}`} className="block rounded-card border border-line bg-surface p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <span className="flex h-[88px] items-center justify-center rounded-control bg-[radial-gradient(ellipse_at_center,#243044_0%,#10141c_72%)]">
                      {pic ? <img src={pic} alt="" width={160} height={72} loading="lazy" decoding="async" className="max-h-[72px] max-w-full object-contain" /> : <span className="text-[12px] text-[#c5ceda]">暂无官方图</span>}
                    </span>
                    <span className="mt-2 block truncate text-[14px] font-semibold text-ink">{item.name || "改枪方案"}</span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-[12px]">
                      {item.source ? <span className={`rounded-mark px-1.5 py-0.5 font-semibold ${item.source === "官方热门" ? "bg-ok-soft text-ok-ink" : "border border-line text-ink-2"}`}>{item.source}</span> : <span />}
                      <span className="num font-bold text-amber">{item.totalText ?? "—"}</span>
                    </span>
                    {item.popularityText ? <span className="mt-1 block text-[12px] text-ink-3">{item.popularityText}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-control bg-accent px-4 py-2.5 text-[14px] font-bold text-accent-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={() => {
        void copyText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "已复制" : "复制改枪码"}
    </button>
  );
}

function Radar({ origin, change }: { origin: Stats; change: Stats | null }) {
  const rings = [0.25, 0.5, 0.75, 1];
  const after = change
    ? (Object.fromEntries(RADAR.map((row) => [row.key, origin[row.key] + change[row.key]])) as Stats)
    : null;
  return (
    <figure>
      <svg viewBox="0 0 200 200" role="img" aria-labelledby="radar-title" className="mx-auto w-full max-w-[220px]">
        <title id="radar-title">改装前后的枪械属性雷达图。虚线是改装前，实心品牌色是改装后。射速按 1200 发/分折到外圈，其余属性按 100。</title>
        {rings.map((ring) => (
          <polygon key={ring} points={polygon({ meatHarm: 100 * ring, armorHarm: 100 * ring, shootDistance: 100 * ring, recoil: 100 * ring, control: 100 * ring, stable: 100 * ring, hipShot: 100 * ring, fireSpeed: 1200 * ring }, 68)} fill="none" stroke="var(--line-strong)" />
        ))}
        {RADAR.map((axis, index) => {
          const [x, y] = point(index, axis.scale, axis.scale, 68);
          const [lx, ly] = point(index, axis.scale, axis.scale, 84);
          return (
            <g key={axis.key}>
              <line x1="100" y1="100" x2={x} y2={y} stroke="var(--line)" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="var(--ink-3)" fontSize="10">{axis.label}</text>
            </g>
          );
        })}
        <polygon points={polygon(origin, 68)} fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeDasharray="4 3" />
        {after ? <polygon points={polygon(after, 68)} fill="color-mix(in srgb, var(--accent) 28%, transparent)" stroke="var(--accent)" strokeWidth="2.2" /> : null}
      </svg>
      <figcaption className="mt-1 flex justify-center gap-4 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--ink-3)" strokeWidth="1.6" strokeDasharray="4 3" /></svg>改装前</span>
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--accent)" strokeWidth="2.2" /></svg>改装后</span>
      </figcaption>
    </figure>
  );
}

function AttributeBars({ properties }: { properties: NonNullable<Payload["detail"]>["properties"] }) {
  if (!properties) return <p className="text-[13px] text-ink-3">还没有这把枪的属性。</p>;
  const extra = [
    properties.fireMode ? `射击模式 ${properties.fireMode}` : null,
    properties.capacity != null ? `弹匣容量 ${properties.capacity}` : null,
    properties.muzzleVelocity != null ? `初速 ${properties.muzzleVelocity}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5">
      {BARS.map((row) => {
        const before = properties.origin[row.key];
        const delta = properties.change ? properties.change[row.key] : 0;
        const after = before + delta;
        const base = pct(before, row.scale);
        const next = pct(after, row.scale);
        const label = `${row.label}，改装后 ${after}${delta ? `，${signed(delta)}` : ""}`;
        return (
          <div key={row.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2" role="group" aria-label={label}>
            <span className="text-[12px] text-ink-3">{row.label}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-bg-muted" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[#8a93a8]/80" style={{ width: `${base}%` }} />
              {delta > 0 ? <span className="absolute inset-y-0 rounded-full bg-accent" style={{ left: `${base}%`, width: `${Math.max(0, next - base)}%` }} /> : null}
              {delta < 0 ? <span className="absolute inset-y-0 rounded-full bg-hot" style={{ left: `${next}%`, width: `${Math.max(0, base - next)}%` }} /> : null}
            </span>
            <span className="num text-right text-[13px] font-bold text-ink">
              {after}
              {delta > 0 ? <span className="ml-1 text-accent">{signed(delta)}</span> : null}
              {delta < 0 ? <span className="ml-1 text-hot">{signed(delta)}</span> : null}
            </span>
          </div>
        );
      })}
      {extra.length ? <p className="border-t border-line pt-2 text-[12px] text-ink-3">{extra.join(" · ")}</p> : null}
    </div>
  );
}
