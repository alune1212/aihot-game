// 《三角洲行动》枪械名录。分类用游戏内的枪种（官方小程序数据接口的 mtype，
// 以及官网「7 种枪型」的对应关系）：步枪含突击步枪和战斗步枪，精确射手步枪即官网所说的射手步枪，
// 轻机枪含通用机枪。枪名按公开的游戏内名称整理，赛季加枪后要改这份名单。
export interface Weapon {
  /** 页面上的名字，也是归类时用的规范名。 */
  name: string;
  /** 正文里可能出现的写法，长的排在前面匹配。 */
  aliases: string[];
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

export const WEAPON_CATEGORIES: readonly WeaponCategory[] = [
  {
    key: "rifle",
    label: "步枪",
    note: "游戏内的步枪，含突击步枪和战斗步枪。",
    weapons: [
      w("M4A1突击步枪", "M4A1"),
      w("AKM突击步枪", "AKM"),
      w("K416突击步枪", "K416", "HK416"),
      w("AK-12突击步枪", "AK-12", "AK12"),
      w("AUG突击步枪", "AUG"),
      w("QBZ95-1突击步枪", "QBZ95-1", "QBZ-95-1", "95-1"),
      w("AKS-74U突击步枪", "AKS-74U", "AKS74U"),
      w("M7战斗步枪", "M7"),
      w("SCAR-H战斗步枪", "SCAR-H", "SCARH"),
      w("G3战斗步枪", "G3"),
      w("K437突击步枪", "K437"),
      w("PTR-32突击步枪", "PTR-32", "PTR32"),
      w("KC17突击步枪", "KC17"),
      w("MK47突击步枪", "MK47"),
      w("MCX LT突击步枪", "MCX LT", "MCX"),
      w("AR-57突击步枪", "AR-57", "AR57"),
      w("RM277突击步枪", "RM277"),
      w("MDR突击步枪", "MDR"),
      w("AN-94突击步枪", "AN-94", "AN94"),
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
      w("SVCH射手步枪", "SVCH"),
      w("Marlin杠杆步枪", "Marlin"),
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
      w("FS12霰弹枪", "FS12"),
    ],
  },
  {
    key: "pistol",
    label: "手枪",
    note: "",
    weapons: [
      w("G18手枪", "G18"),
      w("G17手枪", "G17"),
      w("QSZ92G手枪", "QSZ92", "QSZ-92"),
      w("沙漠之鹰", "沙鹰"),
      w("93R手枪", "93R"),
      w("357左轮", ".357", "左轮"),
      w("M1911手枪", "M1911"),
    ],
  },
  {
    key: "special",
    label: "特殊武器",
    note: "上线后增加的、不在最初七种枪型里的武器。",
    weapons: [w("复合弓", "复合弓")],
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
