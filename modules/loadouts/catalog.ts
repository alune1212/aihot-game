// 《三角洲行动》枪械名录。名字和枪种对照游戏数据里的物品名（deltaforce.th.gl 的物品表，
// 与标注「数据来源：三角洲行动官方」的物品页一致）：步枪含突击步枪和战斗步枪，
// 精确射手步枪即官网所说的射手步枪，轻机枪含通用机枪。
// 基准价是占位、或只在体验服/官方预告里出现、改枪台还选不到的，不放进下面这份当前名单。
import { beijingDate } from "@aihot/contracts/time";
export interface Weapon {
  /** 页面上的名字，也是归类时用的规范名。 */
  name: string;
  /** 正文里可能出现的写法，长的排在前面匹配。 */
  aliases: string[];
  /**
   * 北京时间的上线日（含当天）。没写就是改枪台里已经能选。
   * 到这一天之前，页面和接口都不列出它；文章里如果已经写了这个名字，仍会先记下来。
   */
  availableFrom?: string;
}

export interface WeaponCategory {
  key: string;
  label: string;
  note: string;
  weapons: Weapon[];
}

export const GAME_ID = "delta-force";
export const GAME_NAME = "三角洲行动";

const w = (name: string, ...extra: string[]): Weapon => ({ name, aliases: [name, ...extra] });
const upcoming = (availableFrom: string, name: string, ...extra: string[]): Weapon => ({ name, aliases: [name, ...extra], availableFrom });

/** 北京时间的日历日，用来判断「这一天起才能在改枪台选到」。 */
export function isWeaponListed(weapon: Weapon, now = new Date()): boolean {
  return !weapon.availableFrom || weapon.availableFrom <= beijingDate(now);
}

export const WEAPON_CATEGORIES: readonly WeaponCategory[] = [
  {
    key: "rifle",
    label: "步枪",
    note: "游戏内的步枪，含突击步枪和战斗步枪。",
    weapons: [
      w("M4A1突击步枪", "M4A1"),
      w("AKM突击步枪", "AKM"),
      w("QBZ95-1突击步枪", "QBZ95-1", "QBZ-95-1", "95-1"),
      w("AKS-74U突击步枪", "AKS-74U", "AKS74U"),
      w("ASh-12战斗步枪", "ASh-12", "ASh12", "ASH-12"),
      w("K416突击步枪", "K416", "HK416"),
      w("M16A4突击步枪", "M16A4"),
      w("AUG突击步枪", "AUG"),
      w("M7战斗步枪", "M7"),
      w("SG552突击步枪", "SG552"),
      w("AK-12突击步枪", "AK-12", "AK12"),
      w("SCAR-H战斗步枪", "SCAR-H", "SCARH"),
      w("G3战斗步枪", "G3"),
      w("PTR-32突击步枪", "PTR-32", "PTR32"),
      w("CAR-15突击步枪", "CAR-15", "CAR15"),
      w("AS Val突击步枪", "AS Val", "AS-Val", "ASVal"),
      w("腾龙突击步枪", "腾龙", "CI-19"),
      w("K437突击步枪", "K437"),
      w("KC17突击步枪", "KC17", "KC-17"),
      w("MK47突击步枪", "MK47"),
      w("MCX LT突击步枪", "MCX LT", "MCX-LT", "MCX突击步枪", "MCX"),
      w("AR57突击步枪", "AR57", "AR-57"),
      w("RM277突击步枪", "RM277"),
      w("MDR突击步枪", "MDR"),
      upcoming("2026-11-05", "AN94突击步枪", "AN94", "AN-94"),
    ],
  },
  {
    key: "smg",
    label: "冲锋枪",
    note: "含游戏里归在冲锋枪下的个人防卫武器。",
    weapons: [
      w("Vector冲锋枪", "Vector", "维克托"),
      w("MP5冲锋枪", "MP5"),
      w("MP7冲锋枪", "MP7"),
      w("P90冲锋枪", "P90"),
      w("UZI冲锋枪", "UZI"),
      w("野牛冲锋枪", "野牛"),
      w("勇士冲锋枪", "勇士"),
      w("SMG-45冲锋枪", "SMG-45", "SMG45"),
      w("SR-3M紧凑突击步枪", "SR-3M", "SR3M"),
      w("QCQ171冲锋枪", "QCQ171", "二〇式冲锋枪"),
      w("MK4冲锋枪", "MK4"),
      w("汤姆逊冲锋枪", "汤姆逊"),
    ],
  },
  {
    key: "dmr",
    label: "精确射手步枪",
    note: "官网介绍里也称射手步枪。",
    weapons: [
      w("SR-25射手步枪", "SR-25", "SR25"),
      w("SVD狙击步枪", "SVD"),
      w("SKS射手步枪", "SKS"),
      w("M14射手步枪", "M14"),
      w("Mini-14射手步枪", "Mini-14", "Mini14"),
      w("PSG-1射手步枪", "PSG-1", "PSG1"),
      w("SR9射手步枪", "SR9"),
      w("VSS射手步枪", "VSS"),
      w("SVCH精确射手步枪", "SVCH射手步枪", "SVCH"),
      w("杠杆式步枪", "Marlin射手步枪", "Marlin", "Marlin杠杆步枪"),
    ],
  },
  {
    key: "sniper",
    label: "狙击步枪",
    note: "栓动或反器材狙击步枪。",
    weapons: [
      w("AWM狙击步枪", "AWM"),
      w("R93狙击步枪", "R93"),
      w("M700狙击步枪", "M700"),
      w("SV-98狙击步枪", "SV-98", "SV98"),
      w("M82狙击步枪", "M82"),
    ],
  },
  {
    key: "lmg",
    label: "轻机枪",
    note: "含官网介绍里的通用机枪。",
    weapons: [
      w("PKM通用机枪", "PKM"),
      w("M249轻机枪", "M249"),
      w("M250通用机枪", "M250"),
      w("QJB201轻机枪", "QJB201", "QJB-201", "二〇式轻机枪"),
    ],
  },
  {
    key: "shotgun",
    label: "霰弹枪",
    note: "",
    weapons: [
      w("M870霰弹枪", "M870"),
      w("M1014霰弹枪", "M1014"),
      w("S12K霰弹枪", "S12K"),
      w("725双管霰弹枪", "725", "725双管散弹枪"),
      w("FS-12霰弹枪", "FS-12", "FS12"),
    ],
  },
  {
    key: "pistol",
    label: "手枪",
    note: "",
    weapons: [
      w("QSZ92G", "QSZ92G手枪", "QSZ92", "QSZ-92"),
      w(".357左轮", "357左轮", ".357", "左轮"),
      w("沙漠之鹰", "沙鹰"),
      w("G18", "G18手枪"),
      w("93R", "93R手枪"),
      w("G17", "G17手枪"),
      w("M1911", "M1911手枪"),
    ],
  },
  {
    key: "special",
    label: "特殊武器",
    note: "上线后增加的、不在最初七种枪型里的武器。",
    weapons: [w("复合弓", "复合弓射手步枪")],
  },
];

/** 匹配用：长别名优先，避免 M4 吃掉 M4A1。 */
export const WEAPON_MATCHERS: ReadonlyArray<{ categoryKey: string; categoryLabel: string; weapon: string; alias: string }> =
  WEAPON_CATEGORIES.flatMap((category) =>
    category.weapons.flatMap((weapon) =>
      [...weapon.aliases].sort((a, b) => b.length - a.length).map((alias) => ({
        categoryKey: category.key,
        categoryLabel: category.label,
        weapon: weapon.name,
        alias,
      })),
    ),
  ).sort((a, b) => b.alias.length - a.alias.length);

function boundary(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[A-Za-z0-9]/.test(alias) && /[A-Za-z0-9]$/.test(alias)) return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
  return new RegExp(escaped, "i");
}

/** 一段枪名（或改枪码前缀）对上名录里的哪一把。对不上就返回 null，调用方不要猜。 */
export function matchWeapon(text: string): { categoryKey: string; weapon: string } | null {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) return null;
  for (const item of WEAPON_MATCHERS) {
    if (boundary(item.alias).test(normalized)) return { categoryKey: item.categoryKey, weapon: item.weapon };
  }
  return null;
}
