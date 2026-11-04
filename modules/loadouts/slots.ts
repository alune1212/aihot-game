// 官方改枪台槽位号。名称来自 2026-11-04 匿名接口 dfm/config.list 的 gunSlotMap。
// 22 仍用原来的「独特组件」；官方表写的是「独特」。
// 9、12 在官方表里，当天的枪械目录和方案列表都没有。21 在 CAR-15 的槽位表里，方案列表还没出现。
// 官方表没有的号：配件名里如果带有已知槽位名（例如「增强弓弦」），就用那个名字。这是推断。对不上则显示「其他配件」。
export const SLOT_NAME: Record<string, string> = {
  "1": "后握把",
  "2": "枪管",
  "3": "枪托",
  "4": "护木",
  "5": "弹匣",
  "6": "枪口",
  "8": "前握把",
  "9": "照门",
  "10": "脚架",
  "11": "瞄准镜",
  "12": "前瞄准镜",
  "14": "战术设备",
  "17": "上导轨",
  "18": "下导轨",
  "19": "左导轨",
  "20": "右导轨",
  "21": "镜座",
  "22": "独特组件",
  "28": "枪托垫",
  "29": "托腮板",
  "30": "后握贴片",
  "31": "侧副瞄具",
  "32": "上贴片",
  "34": "左贴片",
  "35": "右贴片",
  "36": "枪管脚架",
  "37": "护木套件",
  "38": "枪托套件",
  "40": "上副瞄具",
  "41": "增高座瞄具",
  "43": "握把座",
  "44": "弹匣座",
  "45": "遮光罩",
  "46": "上护木",
  "47": "导气",
  "48": "击锤",
  "49": "扳机",
  "50": "增高座瞄具",
  "51": "隔热网",
  "52": "枪机",
  "54": "拉机柄帽",
  "55": "弓弦",
  "56": "握把片",
  "57": "弓臂",
  "58": "弓瞄具",
  "59": "箭台",
  "60": "稳定杆",
  "62": "杠杆",
};

const KNOWN_LABELS = [...new Set(Object.values(SLOT_NAME))].sort((a, b) => b.length - a.length);

export function slotName(id: string, partName?: string | null): string {
  const known = SLOT_NAME[id];
  if (known) return known;
  const name = typeof partName === "string" ? partName.replace(/\s+/g, "") : "";
  const inferred = name ? KNOWN_LABELS.find((label) => name.includes(label)) : undefined;
  return inferred ?? "其他配件";
}
