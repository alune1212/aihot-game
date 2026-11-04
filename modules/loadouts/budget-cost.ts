// 推荐预算用的花费。总价和覆盖率来自 prices.ts 的 costsForLoadouts，不另算一套单价。
// 那份总价在缺件时仍是已有单价的合计。预算只认覆盖率 100 的数，缺一件就不拿部分合计去比。
import type { Db } from "@aihot/backend/db";
import { costsForLoadouts, type CodeCost } from "./prices.ts";

export interface BudgetCost {
  /** 覆盖率 100 时的整枪总价。不满就是 null。 */
  spendable: number | null;
  /** 0 到 100。没有可计价的部件时是 0。 */
  coverage: number;
  missing: string[];
}

export function spendableCost(cost: Pick<CodeCost, "total" | "coverage" | "missing"> | undefined): BudgetCost {
  if (!cost) return { spendable: null, coverage: 0, missing: [] };
  return {
    spendable: cost.coverage === 100 ? cost.total : null,
    coverage: cost.coverage,
    missing: cost.missing,
  };
}

export async function loadBudgetCosts(db: Db, ids: readonly number[]): Promise<Map<number, BudgetCost>> {
  const costs = await costsForLoadouts(db, ids);
  return new Map(ids.map((id) => [id, spendableCost(costs.get(id))]));
}
