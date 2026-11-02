// 聪聪强度梯队。只读枪名和梯队，不读这一页上的改枪码（那些是国际服码）。
import { matchWeapon } from "./catalog.ts";

const TIERS = new Set(["S+", "S*", "S", "S-", "A+", "A", "B", "C"]);

export interface TierRow {
  weapon: string;
  tier: string;
}

export function parseTierList(html: string): { asOf: string | null; rows: TierRow[]; unmapped: string[] } {
  const asOf = /梯队表\s*(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? null;
  const rows: TierRow[] = [];
  const unmapped: string[] = [];
  const seen = new Set<string>();
  for (const part of html.split("tier-chip").slice(1)) {
    const tier = />([^<]+)</.exec(part)?.[1]?.trim() ?? "";
    if (!TIERS.has(tier)) continue;
    for (const match of part.matchAll(/href="\/weapon\/[^"]+"[^>]*>([^<]+)</g)) {
      const name = match[1]!.replace(/\s+/g, " ").trim();
      if (!name) continue;
      const mapped = matchWeapon(name);
      if (!mapped) {
        if (!unmapped.includes(name)) unmapped.push(name);
        continue;
      }
      if (seen.has(mapped.weapon)) continue;
      seen.add(mapped.weapon);
      rows.push({ weapon: mapped.weapon, tier });
    }
  }
  return { asOf, rows, unmapped };
}
