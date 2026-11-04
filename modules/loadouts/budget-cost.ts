// 推荐预算用的花费。只认覆盖率 100 的整枪总价，缺一件就不拿部分合计去卡预算。
// 交易行目录的采集在另一处：它写入 loadout_item_prices（官方行优先）并提供 costsForLoadouts。
// 这里先按物品 id 读最新价。那份函数进来以后，把 loadBudgetCosts 换成它，覆盖率不满 100 时 spendable 仍是 null。
import type { Db } from "@aihot/backend/db";

export interface BudgetPart {
  objectId: number | null;
  name: string | null;
}

export interface BudgetCost {
  /** 枪身和每个已装配件都有价时的合计。覆盖率不满就是 null。 */
  spendable: number | null;
  /** 0 到 100。没有可计价的部件时是 0。 */
  coverage: number;
  missing: string[];
}

/** 和交易行成本同一套覆盖率：已装的枪身和配件才算，空槽不算。 */
export function budgetCost(parts: readonly BudgetPart[], quotes: ReadonlyMap<number, number>): BudgetCost {
  const installed = parts.filter((part) => part.objectId);
  const missing: string[] = [];
  let total = 0;
  for (const part of installed) {
    const price = quotes.get(part.objectId!);
    if (price == null || price <= 0) {
      missing.push(part.name ?? String(part.objectId));
      continue;
    }
    total += price;
  }
  const known = installed.length - missing.length;
  const coverage = installed.length ? Math.round((known / installed.length) * 100) : 0;
  return {
    spendable: coverage === 100 && known > 0 ? total : null,
    coverage,
    missing,
  };
}

export async function loadBudgetCosts(db: Db, codes: ReadonlyMap<number, readonly BudgetPart[]>): Promise<Map<number, BudgetCost>> {
  const out = new Map<number, BudgetCost>();
  const objectIds = new Set<number>();
  for (const parts of codes.values()) {
    for (const part of parts) if (part.objectId) objectIds.add(part.objectId);
  }
  const quotes = new Map<number, number>();
  if (objectIds.size) {
    const rows = await db<{ object_id: number; price: number }[]>`
      SELECT object_id, price FROM loadout_item_prices WHERE object_id IN ${db([...objectIds])}`;
    for (const row of rows) quotes.set(Number(row.object_id), row.price);
  }
  for (const [id, parts] of codes) out.set(id, budgetCost(parts, quotes));
  return out;
}
