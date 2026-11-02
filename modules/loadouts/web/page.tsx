import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "loadouts", name: "改枪" };

const MODES = ["烽火地带", "全面战场", "黑潮爆破"] as const;
const DESKTOP = "(min-width: 1024px)";
const PARTS_SHOWN = 8;

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
  popularityText: string | null;
  likesText: string | null;
  featured: boolean;
  stale: boolean;
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

interface Payload {
  game: { id: string; name: string };
  categories: Category[];
  note: string;
}

interface ShownWeapon extends Weapon {
  categoryKey: string;
  categoryLabel: string;
}

export async function loader({ request }: { request: Request }) {
  return apiGet<Payload>("/api/loadouts", { signal: request.signal });
}

export function meta({ loaderData }: { loaderData?: Payload }) {
  const name = loaderData?.game.name ?? "三角洲行动";
  return pageMeta({
    title: `${name}改枪码`,
    description: `按${name}的枪械查看改枪码。枪图和整枪价来自官方改枪台，导入前请回游戏里核对。`,
    path: "/loadouts",
  });
}

function knownMode(value: string | null): (typeof MODES)[number] | null {
  return MODES.find((mode) => mode === value) ?? null;
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

function schemeTitle(code: LoadoutCode): string {
  return code.name ?? (code.author ? `${code.author}的方案` : "改枪方案");
}

function cardId(name: string): string {
  return `gun-card-${encodeURIComponent(name)}`;
}

export default function LoadoutsPage() {
  const { game, categories, note } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryKey = searchParams.get("category");
  const mode = knownMode(searchParams.get("mode"));
  const gunName = searchParams.get("gun");
  const category = categories.find((item) => item.key === categoryKey) ?? null;
  const weapons: ShownWeapon[] = categories.flatMap((item) => item.weapons.map((weapon) => ({ ...weapon, categoryKey: item.key, categoryLabel: item.label })));
  const inMode = (weapon: ShownWeapon) => weapon.codes.filter((code) => !mode || code.mode === mode);
  const cards = weapons.filter((weapon) => (category ? weapon.categoryKey === category.key : true) && inMode(weapon).length > 0);
  const selected = weapons.find((weapon) => weapon.name === gunName) ?? null;
  const selectedCodes = selected ? inMode(selected) : [];
  const shownCount = cards.reduce((sum, weapon) => sum + inMode(weapon).length, 0);
  const asideClose = useRef<HTMLButtonElement>(null);
  const closeDrawerRef = useRef<() => void>(() => {});

  function patch(next: { category?: string | null; mode?: string | null; gun?: string | null }) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { preventScrollReset: true });
  }

  function closeDrawer() {
    const backTo = selected ? cardId(selected.name) : null;
    patch({ gun: null });
    if (backTo) requestAnimationFrame(() => document.getElementById(backTo)?.focus());
  }
  closeDrawerRef.current = closeDrawer;
  useEffect(() => {
    if (!selected) return;
    const desktop = window.matchMedia(DESKTOP);
    if (desktop.matches) asideClose.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !desktop.matches) return;
      event.preventDefault();
      closeDrawerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected?.name]);

  return (
    <div className="pb-6">
      <PhoneBar title="改枪码" />
      <div className="lg:flex lg:items-start">
        <div className="min-w-0 flex-1" style={{ containerType: "inline-size" }}>
          <header className="pb-2 pt-3 lg:pt-1">
            <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">改枪码</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
              按{game.name}的枪械浏览。当前 <span className="num">{shownCount}</span> 条。枪图和整枪价来自官方改枪台，没有官方价显示 —。
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
          {category?.note ? <p className="mt-3 text-[12px] text-ink-4">{category.note}</p> : null}
          {cards.length ? (
            <div className="armory-grid mt-4">
              {cards.map((weapon, index) => {
                const codes = inMode(weapon);
                const on = weapon.name === selected?.name;
                const pic = playerhubPic(weapon.pic);
                return (
                  // 同一行里有的卡片多一行理论 TTK，网格会把矮的 button 拉高。
                  // 按钮的默认排版会把内容垂直居中，图片区就离开卡片顶，顶上露出卡片底色。
                  <button
                    key={weapon.name}
                    id={cardId(weapon.name)}
                    type="button"
                    aria-pressed={on}
                    className={`flex w-full flex-col overflow-hidden rounded-card border bg-surface text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line"}`}
                    onClick={() => patch({ gun: weapon.name })}
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
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-card border border-line bg-surface px-4 py-10 text-center text-[14px] text-ink-3">这个筛选下还没有改枪码。</p>
          )}
        </div>
        {selected ? (
          <aside id="loadout-drawer" className="sticky top-0 mt-4 hidden h-dvh w-[380px] shrink-0 flex-col border-l border-line bg-surface lg:mt-0 lg:flex" aria-labelledby="loadout-drawer-title">
            <DrawerBody weapon={selected} codes={selectedCodes} onClose={closeDrawer} titleId="loadout-drawer-title" closeRef={asideClose} />
          </aside>
        ) : null}
      </div>
      {selected ? <MobileDrawer weapon={selected} codes={selectedCodes} onClose={closeDrawer} /> : null}
      <style>{`
        .armory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        @container (min-width: 640px) { .armory-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @container (min-width: 920px) { .armory-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        dialog.armory-drawer:modal { overscroll-behavior: contain; }
        dialog.armory-drawer::backdrop { overflow: hidden; overscroll-behavior: contain; background: rgb(0 0 0 / 0.55); }
        dialog.armory-drawer[open] {
          position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
          margin: 0; padding: 0; border: 0; background: var(--surface); color: var(--ink);
        }
      `}</style>
    </div>
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

function DrawerBody({ weapon, codes, onClose, titleId, closeRef }: {
  weapon: ShownWeapon;
  codes: LoadoutCode[];
  onClose: () => void;
  titleId: string;
  closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const pic = playerhubPic(weapon.pic);
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="gun-well grid h-12 w-[72px] shrink-0 place-items-center rounded-control" style={wellStyle(weapon.grade)}>
          {pic ? <img src={pic} alt="" width={72} height={48} className="gun-sprite max-h-12 max-w-[72px] object-contain" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[16px] font-semibold text-ink" aria-live="polite">{weapon.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-3">
            <span>{weapon.categoryLabel} · {codes.length} 个方案</span>
            {weapon.tier ? <span className={`rounded-mark px-1.5 py-0.5 text-[11px] font-semibold ${tierClass(weapon.tier)}`} title={tierTitle(weapon)}>聪聪 {weapon.tier}</span> : null}
          </p>
          {weapon.ttkText ? <p className="mt-0.5 text-[12px] text-ink-3" title={weapon.ttkNote ?? undefined}>{weapon.ttkText}</p> : null}
          {weapon.patchText ? <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-4" title={weapon.patchText}>{weapon.patchText}</p> : null}
        </div>
        <button ref={closeRef} type="button" className="shrink-0 rounded-control border border-line px-2.5 py-1 text-[13px] text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-3">
        {codes.length ? codes.map((code) => <SchemeCard key={code.id} code={code} />) : (
          <p className="px-1 py-6 text-center text-[14px] text-ink-3">这个筛选下还没有这把枪的方案。</p>
        )}
      </div>
    </>
  );
}

function SourceMarks({ code }: { code: Pick<LoadoutCode, "source" | "sourceUrl" | "sources"> }) {
  const marks = code.sources?.length ? code.sources : (code.source ? [{ label: code.source, url: code.sourceUrl }] : []);
  return marks.map((item) => (
    item.url
      ? <a key={item.label} href={item.url} className="rounded-mark border border-line px-1.5 py-0.5 text-ink-2 hover:text-accent">{item.label}</a>
      : <span key={item.label} className={`rounded-mark px-1.5 py-0.5 font-semibold ${item.label === "官方热门" ? "bg-ok-soft text-ok-ink" : "border border-line text-ink-2"}`}>{item.label}</span>
  ));
}

function SchemeCard({ code }: { code: LoadoutCode }) {
  const shown = code.parts.slice(0, PARTS_SHOWN);
  const rest = code.parts.length - shown.length;
  return (
    <article className="rounded-tile border border-line bg-bg-sunk p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-ink">{schemeTitle(code)}</h3>
        <span className="num shrink-0 text-[15px] font-bold text-amber">{code.totalText ?? "—"}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        {code.mode ? <span className="rounded-mark border border-[#31465f] bg-[#172232] px-1.5 py-0.5 text-[#d6e6ff]">{code.mode}</span> : null}
        <span className="text-ink-3"><span className="num">{code.partCount}</span> 个配件</span>
        {code.popularityText ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-2">{code.popularityText}</span> : null}
        {code.likesText ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-2">{code.likesText}</span> : null}
        {code.featured ? <span className="rounded-mark bg-amber-soft px-1.5 py-0.5 font-semibold text-amber-ink">主播</span> : null}
        {code.stale ? <span className="rounded-mark border border-line px-1.5 py-0.5 text-ink-4">过季</span> : null}
        <SourceMarks code={code} />
      </div>
      {code.parts.length ? (
        <ul className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="配件">
          {shown.map((part, index) => {
            const pic = playerhubPic(part.pic);
            return (
              <li key={`${part.name ?? "part"}-${index}`} className="gun-well grid size-10 place-items-center rounded-control border-2 p-0.5" style={{ ...wellStyle(part.grade), borderColor: gradeColor(part.grade) }} title={part.name ?? undefined}>
                {pic ? <img src={pic} alt={part.name ?? "配件"} width={36} height={36} className="gun-sprite max-h-full max-w-full object-contain" loading="lazy" fetchPriority="low" /> : <span className="sr-only">{part.name ?? "配件"}</span>}
              </li>
            );
          })}
          {rest > 0 ? <li className="px-1 text-[12px] text-ink-3">+{rest}</li> : null}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-4">暂无官方详情</p>
      )}
      <p className="mt-2 truncate font-mono text-[12px] text-ink-3" title={code.code}>{code.code}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <a href={`/loadouts/${code.id}`} className="text-[13px] font-medium text-accent hover:underline">配件和属性</a>
        <CopyCode code={code.code} />
      </div>
    </article>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-control bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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

function MobileDrawer({ weapon, codes, onClose }: { weapon: ShownWeapon; codes: LoadoutCode[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const desktop = window.matchMedia(DESKTOP);
    let programmatic = false;
    const notify = () => { if (!programmatic) onCloseRef.current(); };
    el.addEventListener("close", notify);
    const sync = () => {
      if (desktop.matches) {
        if (el.open) {
          programmatic = true;
          el.close();
          programmatic = false;
        }
        return;
      }
      if (!el.open) el.showModal();
      closeRef.current?.focus();
    };
    sync();
    desktop.addEventListener("change", sync);
    let pressedOutside = false;
    const outside = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    const onDown = (event: PointerEvent) => { pressedOutside = outside(event); };
    const onUp = (event: PointerEvent) => {
      if (!("closedBy" in HTMLDialogElement.prototype) && el.open && pressedOutside && outside(event)) el.close();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      desktop.removeEventListener("change", sync);
      el.removeEventListener("close", notify);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      if (el.open) {
        programmatic = true;
        el.close();
      }
    };
  }, [weapon.name]);
  return (
    <dialog ref={dialogRef} className="armory-drawer lg:hidden" aria-labelledby="loadout-drawer-title-mobile" closedby="any">
      <div className="flex h-full min-h-0 flex-col">
        <DrawerBody weapon={weapon} codes={codes} onClose={() => dialogRef.current?.close()} titleId="loadout-drawer-title-mobile" closeRef={closeRef} />
      </div>
    </dialog>
  );
}
