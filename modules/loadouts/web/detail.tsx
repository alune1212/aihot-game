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

interface Payload {
  game: { id: string; name: string };
  code: {
    id: number;
    weapon: string;
    code: string;
    mode: string | null;
    author: string | null;
    source: string | null;
    sourceUrl: string | null;
    postedOn: string | null;
    popularityText: string | null;
    featured: boolean;
    stale: boolean;
  };
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
    title: `${weapon}改枪方案`,
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

const TABLE: Array<{ key: StatKey; label: string }> = [
  { key: "meatHarm", label: "基础伤害" },
  { key: "armorHarm", label: "护甲伤害" },
  { key: "fireSpeed", label: "射速" },
  { key: "shootDistance", label: "优势射程" },
  { key: "recoil", label: "后坐力控制" },
  { key: "control", label: "操控速度" },
  { key: "stable", label: "据枪稳定性" },
  { key: "hipShot", label: "腰际射击精度" },
];

function gradeColor(grade: number | null): string {
  switch (grade) {
    case 2: return "var(--ok)";
    case 3: return "#3b82d6";
    case 4: return "#8b5cf6";
    case 5: return "var(--amber)";
    case 6: return "var(--hot)";
    default: return "var(--line)";
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

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink"
      onClick={() => {
        void copyText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function point(index: number, value: number, scale: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + (index / RADAR.length) * Math.PI * 2;
  const length = Math.max(0, Math.min(1, value / scale)) * radius;
  return [160 + Math.cos(angle) * length, 160 + Math.sin(angle) * length];
}

function polygon(stats: Stats, radius: number): string {
  return RADAR.map((axis, index) => point(index, stats[axis.key], axis.scale, radius).join(",")).join(" ");
}

function SeriesKey({ dashed, label }: { dashed: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <svg width="28" height="10" aria-hidden="true">
        <line x1="1" y1="5" x2="27" y2="5" stroke={dashed ? "var(--ink-3)" : "var(--accent)"} strokeWidth={dashed ? 1.75 : 2.75} strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
}

function Radar({ origin, change }: { origin: Stats; change: Stats | null }) {
  const rings = [0.25, 0.5, 0.75, 1];
  const after = change
    ? (Object.fromEntries(TABLE.map((row) => [row.key, origin[row.key] + change[row.key]])) as Stats)
    : null;
  return (
    <figure className="rounded-card border border-line bg-surface p-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="text-ink-3">改装前后</span>
        <span className="flex gap-4">
          <SeriesKey dashed label="改装前" />
          {after ? <SeriesKey dashed={false} label="改装后" /> : null}
        </span>
      </figcaption>
      <svg viewBox="0 0 320 320" role="img" aria-labelledby="radar-title" className="mx-auto mt-1 w-full max-w-[320px]">
        <title id="radar-title">改装前后的枪械属性雷达图。虚线是改装前，实心品牌色是改装后。数值见旁边的表。射速按 1200 发/分折到外圈。</title>
        {rings.map((ring) => (
          <polygon key={ring} points={polygon({ meatHarm: 100 * ring, armorHarm: 100 * ring, shootDistance: 100 * ring, recoil: 100 * ring, control: 100 * ring, stable: 100 * ring, hipShot: 100 * ring, fireSpeed: 1200 * ring }, 104)} fill="none" stroke="var(--line-strong)" />
        ))}
        {RADAR.map((axis, index) => {
          const [x, y] = point(index, axis.scale, axis.scale, 104);
          const [lx, ly] = point(index, axis.scale, axis.scale, 126);
          return (
            <g key={axis.key}>
              <line x1="160" y1="160" x2={x} y2={y} stroke="var(--line-strong)" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="var(--ink-3)" fontSize="11">{axis.label}</text>
            </g>
          );
        })}
        <polygon points={polygon(origin, 104)} fill="none" stroke="var(--ink-3)" strokeWidth="1.75" strokeDasharray="5 4" />
        {after ? <polygon points={polygon(after, 104)} fill="color-mix(in srgb, var(--accent) 32%, transparent)" stroke="var(--accent)" strokeWidth="2.75" /> : null}
      </svg>
      <p className="text-center text-[11px] text-ink-4">虚线是改装前，实心是改装后。射速按 1200 发/分折到外圈，其余属性按 100。增加用品牌色，减少用红色，和右边的表一致。</p>
    </figure>
  );
}

function AttributeTable({ properties }: { properties: NonNullable<Payload["detail"]>["properties"] }) {
  if (!properties) return <p className="rounded-card border border-line bg-surface px-4 py-6 text-[13px] text-ink-4">还没有这把枪的属性。</p>;
  const rows: Array<{ label: string; before: string; after: string; delta: string | null }> = TABLE.map((row) => {
    const before = properties.origin[row.key];
    const delta = properties.change ? properties.change[row.key] : null;
    return {
      label: row.label,
      before: String(before),
      after: delta === null ? "—" : String(before + delta),
      delta: delta === null ? null : signed(delta),
    };
  });
  rows.splice(3, 0, { label: "开火模式", before: properties.fireMode ?? "—", after: "—", delta: null });
  rows.push(
    { label: "枪口初速", before: properties.muzzleVelocity === null ? "—" : String(properties.muzzleVelocity), after: "—", delta: null },
    { label: "弹匣容量", before: properties.capacity === null ? "—" : String(properties.capacity), after: "—", delta: null },
  );
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">改装前后的枪械属性</caption>
        <thead className="text-[12px] text-ink-4">
          <tr className="border-b border-line-soft">
            <th scope="col" className="px-3 py-2 font-medium">属性</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">改装前</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">改装后</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">增减</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line-soft last:border-0">
              <th scope="row" className="px-3 py-2 font-normal text-ink">{row.label}</th>
              <td className="num px-3 py-2 text-right text-ink-3">{row.before}</td>
              <td className={`num px-3 py-2 text-right ${row.after === "—" ? "text-ink-4" : "font-medium text-accent"}`}>{row.after}</td>
              <td className={`num px-3 py-2 text-right font-medium ${row.delta === null || row.delta === "0" ? "font-normal text-ink-4" : row.delta.startsWith("+") ? "text-accent" : "text-hot"}`}>{row.delta ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line-soft px-3 py-2 text-[12px] text-ink-4">改装后用品牌色，增加同样用品牌色，减少用红色。枪口初速和开火模式官方只给了原枪数值，增减看配件效果。</p>
    </div>
  );
}

export default function LoadoutDetailPage() {
  const { code, detail } = useLoaderData<typeof loader>();
  const title = detail?.name || code.weapon;
  const picture = detail?.previewPic || detail?.gun.pic || null;
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/loadouts", label: "改枪码" }} title={title} />
      <p className="hidden pt-1 lg:block"><a href="/loadouts" className="text-[13px] text-ink-3 hover:text-ink">返回改枪码</a></p>
      <header className="grid gap-4 pt-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center lg:pt-4">
        <div className="flex h-36 items-center justify-center overflow-hidden rounded-card border border-line bg-surface">
          {picture
            ? <img src={picture} alt={detail?.gun.name ?? code.weapon} width={280} height={140} fetchPriority="high" decoding="async" className="h-full w-full object-contain" />
            : <span className="text-[13px] text-ink-4">暂无枪图</span>}
        </div>
        <div className="min-w-0">
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-3">{[code.weapon, code.mode, code.author, code.popularityText].filter(Boolean).join(" · ")}{code.featured ? " · 主播" : ""}{code.stale ? " · 过季" : ""}</p>
          <div className="mt-3 flex items-start gap-2">
            <p className="min-w-0 break-all font-mono text-[13px] text-ink">{code.code}</p>
            <CopyCode code={code.code} />
          </div>
          <p className="mt-2 text-[12px] text-ink-4">
            {detail ? <>数据来自{detail.sourceLabel} · 更新于 {beijingStamp(detail.syncedAt)}</> : "暂无官方详情"}
            {code.source ? <> · 码的来源 {code.sourceUrl ? <a href={code.sourceUrl} className="text-accent hover:underline">{code.source}</a> : code.source}</> : null}
            {code.postedOn ? ` · ${code.postedOn}` : ""}
          </p>
        </div>
      </header>
      {detail ? (
        <>
          <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
            {detail.properties ? <Radar origin={detail.properties.origin} change={detail.properties.change} /> : <p className="rounded-card border border-line bg-surface px-4 py-6 text-[13px] text-ink-4">官方方案里没有这把枪的属性。</p>}
            <AttributeTable properties={detail.properties} />
          </div>
          <h2 className="mt-8 text-[15px] font-bold text-ink">配件</h2>
          {detail.slots.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {detail.slots.map((slot) => (
                <li key={slot.slotId} className="rounded-card border bg-surface p-2.5" style={{ borderColor: slot.objectId ? gradeColor(slot.grade) : "var(--line)" }}>
                  <div className="flex h-16 items-center justify-center">
                    {slot.pic ? <img src={slot.pic} alt="" width={64} height={64} loading="lazy" decoding="async" className="h-16 w-16 object-contain" /> : <span className="text-[12px] text-ink-4">{slot.objectId ? "无图" : "空"}</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-4">{slot.slotName}</p>
                  <p className="text-[13px] font-medium leading-snug text-ink">{slot.name ?? "未安装"}</p>
                  <p className="num mt-1 text-[12px] text-ink-3">{slot.objectId ? money(slot.price) : "—"}</p>
                  {slot.effects.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {slot.effects.map((effect) => (
                        <li key={effect.value} className="text-[11px] leading-snug" style={{ color: effect.color === "green" ? "var(--ok)" : "var(--hot)" }}>{effect.value}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-4">官方方案里没有配件。</p>
          )}
          <section className="mt-6 rounded-card border border-line bg-surface px-4 py-3 text-[13px]" aria-label="价格">
            <dl className="grid grid-cols-3 gap-3">
              <div>
                <dt className="text-[12px] text-ink-4">配件合计</dt>
                <dd className="num mt-0.5 text-[18px] font-semibold text-ink">{money(detail.prices.parts)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-4">枪身</dt>
                <dd className="num mt-0.5 text-[18px] font-semibold text-ink">{money(detail.prices.gun)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-4">整枪总价</dt>
                <dd className="num mt-0.5 text-[18px] font-semibold text-ink">{money(detail.prices.total)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
              {detail.prices.pricedAt ? `价格更新于 ${beijingStamp(detail.prices.pricedAt)}。` : "价格还没刷新。"}
              {detail.prices.complete ? "" : "有的配件还没有价格，总价先不算。"}
              以游戏内交易行为准。
            </p>
          </section>
        </>
      ) : (
        <p className="mt-6 rounded-card border border-dashed border-line-strong px-4 py-8 text-[13px] leading-relaxed text-ink-3">
          暂无官方详情。官方改枪台还没对上这条码；查到之前这里留空。上次已经成功的方案会继续显示当时的数据和更新时间。
        </p>
      )}
    </div>
  );
}
