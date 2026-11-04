import { useState, type CSSProperties } from "react";
import { beijingStamp } from "@aihot/contracts/time";

interface AttachmentItem {
  objectId: number;
  name: string;
  pic: string | null;
  grade: number | null;
  uses: number;
  share: number;
}

interface AttachmentSlot {
  slotId: string;
  slotName: string;
  filled: number;
  items: AttachmentItem[];
}

export interface AttachmentGroup {
  mode: string;
  label: string;
  sample: number;
  slots: AttachmentSlot[];
  consensus: Array<AttachmentItem & { slotId: string; slotName: string }>;
}

export interface AttachmentReport {
  computedAt: string;
  groups: AttachmentGroup[];
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

function percent(share: number): number {
  return Math.round(share * 100);
}

export function AttachmentHeat({
  report,
  pageMode,
  tier,
  tierAsOf,
  ttkText,
  ttkNote,
}: {
  report: AttachmentReport;
  pageMode: string | null;
  tier: string | null;
  tierAsOf: string | null;
  ttkText: string | null;
  ttkNote: string | null;
}) {
  const groups = report.groups;
  const fallback = groups.find((group) => group.mode === (pageMode ?? "")) ?? groups.find((group) => group.mode === "") ?? groups[0];
  const [picked, setPicked] = useState<string | null>(null);
  const active = groups.find((group) => group.mode === (picked ?? fallback?.mode)) ?? fallback;
  if (!active) return null;
  const when = beijingStamp(report.computedAt);
  return (
    <section data-attachment-heat="" aria-labelledby="attachment-heat-title" className="mt-4 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="attachment-heat-title" className="text-[16px] font-semibold text-ink">配件热度</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            基于 <span className="num">{active.sample}</span> 条有官方配件的方案。应用次数越高，这件配件的份额越大。
            {when ? ` 统计于 ${when}（北京时间）。` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tier ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 text-[12px] font-semibold text-amber-ink" title={tierAsOf ? `聪聪梯队，${tierAsOf} 更新` : "聪聪梯队"}>聪聪 {tier}</span> : null}
          {ttkText ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-[12px] text-ink-2" title={ttkNote ?? undefined}>{ttkText}</span> : null}
        </div>
      </div>
      {groups.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2" role="toolbar" aria-label="热度按模式">
          {groups.map((group) => {
            const on = group.mode === active.mode;
            return (
              <button
                key={group.mode || "all"}
                type="button"
                aria-pressed={on}
                className={`rounded-control border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface text-ink-2"}`}
                onClick={() => setPicked(group.mode)}
              >
                {group.label} <span className="num">{group.sample}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <h3 className="mt-4 text-[14px] font-bold text-ink">大众配置</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-3">槽位至少三成方案装了配件，而且第一名的份额不低于 25%，才写进这里。</p>
      {active.consensus.length ? (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {active.consensus.map((part) => {
            const pic = playerhubPic(part.pic);
            return (
              <li key={part.slotId} className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-ink-2">{part.slotName}</p>
                <div className="gun-well mt-1 grid h-[72px] place-items-center rounded-control border-2 p-1" style={{ ...wellStyle(part.grade), borderColor: gradeColor(part.grade) }}>
                  {pic ? <img src={pic} alt="" width={120} height={64} loading="lazy" decoding="async" className="gun-sprite max-h-full max-w-full object-contain" /> : <span className="text-[12px] text-ink-4">无图</span>}
                </div>
                <p className="mt-1 truncate text-[13px] font-semibold text-ink">{part.name}</p>
                <p className="text-[12px] text-ink-3"><span className="num">{part.uses}</span> 条 · <span className="num">{percent(part.share)}%</span></p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">方案比较散，没有哪件配件在同一个槽位上站稳，所以先不标大众配置。</p>
      )}
      {active.slots.length ? (
        <>
          <h3 className="mt-4 text-[14px] font-bold text-ink">槽位份额</h3>
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.slots.map((slot) => (
              <li key={slot.slotId} className="min-w-0">
                <p className="text-[12px] font-semibold text-ink">{slot.slotName}</p>
                <ul className="mt-1 space-y-1">
                  {slot.items.slice(0, 3).map((item) => {
                    const width = Math.max(0, Math.min(100, percent(item.share)));
                    return (
                      <li key={item.objectId}>
                        <p className="flex items-baseline justify-between gap-2 text-[12px] text-ink-2">
                          <span className="truncate">{item.name}</span>
                          <span className="num shrink-0">{width}%</span>
                        </p>
                        <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-bg-muted" aria-hidden="true">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
