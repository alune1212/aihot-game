import { useState } from "react";
import { useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { apiGet } from "@aihot/web/lib/api.server";
import { copyText } from "@aihot/web/lib/clipboard";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "loadouts", name: "改枪" };

interface LoadoutCode {
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  postedOn: string | null;
  featured: boolean;
  stale: boolean;
}

interface Payload {
  game: { id: string; name: string };
  categories: Array<{ key: string; label: string; note: string; weapons: Array<{ name: string; codes: LoadoutCode[] }> }>;
  note: string;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const data = await apiGet<Payload>("/api/loadouts", { signal: request.signal });
  const category = url.searchParams.get("category");
  const known = data.categories.some((item) => item.key === category);
  return { ...data, category: known ? category : null };
}

export function meta({ data }: { data?: Payload }) {
  const name = data?.game.name ?? "三角洲行动";
  return pageMeta({
    title: `${name}改枪码 · ${SITE.name}`,
    description: `按${name}的枪种和枪名查看改枪码，带来源和作者。导入前请回游戏里核对。`,
    path: "/loadouts",
  });
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

export default function LoadoutsPage() {
  const { game, categories, note, category } = useLoaderData<typeof loader>();
  const current = categories.find((item) => item.key === category) ?? null;
  const total = categories.reduce((sum, item) => sum + item.weapons.reduce((n, weapon) => n + weapon.codes.length, 0), 0);
  return (
    <div className="pb-10">
      <PhoneBar title="改枪码" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">{game.name}改枪码</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          先选枪种，再选枪。目前收录 <span className="num">{total}</span> 条。{note}
        </p>
      </header>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="枪种">
        <a href="/loadouts" className={`rounded-full border px-3 py-1.5 text-[13px] ${current ? "border-line text-ink-3" : "border-accent text-accent"}`}>全部枪种</a>
        {categories.map((item) => {
          const count = item.weapons.reduce((n, weapon) => n + weapon.codes.length, 0);
          const on = item.key === current?.key;
          return (
            <a key={item.key} href={`/loadouts?category=${item.key}`} className={`rounded-full border px-3 py-1.5 text-[13px] ${on ? "border-accent text-accent" : "border-line text-ink-3"}`}>
              {item.label}
              <span className="num ml-1 text-[12px]">{count}</span>
            </a>
          );
        })}
      </nav>
      <div className="mt-6 space-y-8">
        {(current ? [current] : categories).map((item) => (
          <section key={item.key} aria-labelledby={`guns-${item.key}`}>
            <h2 id={`guns-${item.key}`} className="text-[15px] font-bold text-ink">{item.label}</h2>
            {item.note ? <p className="mt-1 text-[12px] text-ink-4">{item.note}</p> : null}
            <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-card border border-line bg-surface">
              {item.weapons.map((weapon) => (
                <li key={weapon.name} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[14.5px] font-semibold text-ink">{weapon.name}</h3>
                    <span className="text-[12px] text-ink-4">{weapon.codes.length ? `${weapon.codes.length} 条` : "暂无"}</span>
                  </div>
                  {weapon.codes.length ? (
                    <ul className="mt-2 space-y-2">
                      {weapon.codes.map((code) => (
                        <li key={code.code} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`break-all font-mono text-[13px] ${code.stale ? "text-ink-4" : "text-ink"}`}>{code.code}</p>
                            <p className="mt-0.5 text-[12px] text-ink-4">
                              {[code.mode, code.priceText, code.author, code.source, code.postedOn].filter(Boolean).join(" · ") || "未注明模式"}
                              {code.featured ? " · 主播" : ""}
                              {code.stale ? " · 过季" : ""}
                              {code.sourceUrl ? <> · <a href={code.sourceUrl} className="text-accent hover:underline">来源</a></> : null}
                            </p>
                          </div>
                          <CopyCode code={code.code} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-4">还没有这把枪的改枪码。</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
