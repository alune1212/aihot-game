// 改装前的基础属性，摘自开源 delta-force-core 的公开枪械表，只在官方 AMS 拿不到方案时使用。
// 字段对应：control→后坐力控制，handling→操控速度，aimStability→据枪稳定性，hipFireAccuracy→腰际射击精度。
// shortcut: 游戏改了面板这里不会跟着变；AMS 正常时页面用官方的 origin/change，不用这份。
export interface GunBase {
  meatHarm: number;
  armorHarm: number;
  shootDistance: number;
  recoil: number;
  control: number;
  stable: number;
  hipShot: number;
  fireSpeed: number;
  muzzleVelocity: number | null;
  capacity: number | null;
  fireMode: string | null;
}

export const WEAPON_BASE: Record<string, GunBase> = {
  "M4A1突击步枪": { meatHarm: 31, armorHarm: 33, shootDistance: 40, recoil: 41, control: 58, stable: 55, hipShot: 55, fireSpeed: 800, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "AKM突击步枪": { meatHarm: 40, armorHarm: 42, shootDistance: 40, recoil: 39, control: 54, stable: 55, hipShot: 53, fireSpeed: 600, muzzleVelocity: 525, capacity: 30, fireMode: "单发/全自动" },
  "QBZ95-1突击步枪": { meatHarm: 28, armorHarm: 42, shootDistance: 55, recoil: 52, control: 55, stable: 58, hipShot: 54, fireSpeed: 679, muzzleVelocity: 575, capacity: 30, fireMode: "单发/全自动" },
  "AKS-74U突击步枪": { meatHarm: 34, armorHarm: 36, shootDistance: 40, recoil: 35, control: 60, stable: 53, hipShot: 52, fireSpeed: 533, muzzleVelocity: 500, capacity: 20, fireMode: "单发/全自动" },
  "ASh-12战斗步枪": { meatHarm: 56, armorHarm: 55, shootDistance: 55, recoil: 24, control: 57, stable: 61, hipShot: 43, fireSpeed: 500, muzzleVelocity: 340, capacity: 20, fireMode: "全自动/单发" },
  "K416突击步枪": { meatHarm: 31, armorHarm: 35, shootDistance: 27, recoil: 44, control: 61, stable: 52, hipShot: 57, fireSpeed: 880, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "M16A4突击步枪": { meatHarm: 33, armorHarm: 39, shootDistance: 55, recoil: 40, control: 56, stable: 57, hipShot: 54, fireSpeed: 508, muzzleVelocity: 575, capacity: 20, fireMode: "连发/单发" },
  "AUG突击步枪": { meatHarm: 32, armorHarm: 35, shootDistance: 55, recoil: 60, control: 54, stable: 59, hipShot: 53, fireSpeed: 679, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "M7战斗步枪": { meatHarm: 37, armorHarm: 40, shootDistance: 50, recoil: 34, control: 51, stable: 58, hipShot: 43, fireSpeed: 649, muzzleVelocity: 630, capacity: 20, fireMode: "全自动/单发" },
  "SG552突击步枪": { meatHarm: 25, armorHarm: 34, shootDistance: 35, recoil: 46, control: 61, stable: 52, hipShot: 53, fireSpeed: 906, muzzleVelocity: 575, capacity: 20, fireMode: "单发/全自动/连发" },
  "AK-12突击步枪": { meatHarm: 30, armorHarm: 42, shootDistance: 40, recoil: 48, control: 57, stable: 56, hipShot: 54, fireSpeed: 735, muzzleVelocity: 575, capacity: 30, fireMode: "单发/连发/全自动" },
  "SCAR-H战斗步枪": { meatHarm: 40, armorHarm: 41, shootDistance: 40, recoil: 40, control: 58, stable: 55, hipShot: 45, fireSpeed: 585, muzzleVelocity: 630, capacity: 20, fireMode: "单发/全自动" },
  "G3战斗步枪": { meatHarm: 39, armorHarm: 42, shootDistance: 55, recoil: 32, control: 51, stable: 62, hipShot: 45, fireSpeed: 533, muzzleVelocity: 630, capacity: 20, fireMode: "单发/全自动" },
  "PTR-32突击步枪": { meatHarm: 36, armorHarm: 37, shootDistance: 40, recoil: 32, control: 56, stable: 57, hipShot: 45, fireSpeed: 632, muzzleVelocity: 630, capacity: 30, fireMode: "单发/全自动" },
  "CAR-15突击步枪": { meatHarm: 27, armorHarm: 32, shootDistance: 40, recoil: 50, control: 58, stable: 55, hipShot: 53, fireSpeed: 632, muzzleVelocity: 575, capacity: 20, fireMode: "全自动/单发" },
  "AS Val突击步枪": { meatHarm: 28, armorHarm: 44, shootDistance: 21, recoil: 43, control: 62, stable: 51, hipShot: 57, fireSpeed: 972, muzzleVelocity: 300, capacity: 15, fireMode: "全自动/单发" },
  "腾龙突击步枪": { meatHarm: 35, armorHarm: 38, shootDistance: 35, recoil: 40, control: 60, stable: 50, hipShot: 56, fireSpeed: 706, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "K437突击步枪": { meatHarm: 36, armorHarm: 32, shootDistance: 35, recoil: 45, control: 48, stable: 53, hipShot: 49, fireSpeed: 780, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "KC17突击步枪": { meatHarm: 31, armorHarm: 48, shootDistance: 55, recoil: 53, control: 53, stable: 48, hipShot: 45, fireSpeed: 740, muzzleVelocity: 575, capacity: 30, fireMode: "全自动/单发" },
  "MK47突击步枪": { meatHarm: 42, armorHarm: 46, shootDistance: 30, recoil: 35, control: 55, stable: 50, hipShot: 53, fireSpeed: 625, muzzleVelocity: 525, capacity: 20, fireMode: "单发/全自动" },
  "MCX LT突击步枪": { meatHarm: 34, armorHarm: 26, shootDistance: 30, recoil: 44, control: 61, stable: 52, hipShot: 57, fireSpeed: 840, muzzleVelocity: 450, capacity: 30, fireMode: "全自动/单发" },
  "AR57突击步枪": { meatHarm: 30, armorHarm: 31, shootDistance: 35, recoil: 41, control: 58, stable: 40, hipShot: 60, fireSpeed: 900, muzzleVelocity: 525, capacity: 50, fireMode: "全自动/单发" },
  "RM277突击步枪": { meatHarm: 41, armorHarm: 42, shootDistance: 55, recoil: 48, control: 50, stable: 59, hipShot: 44, fireSpeed: 550, muzzleVelocity: 650, capacity: 30, fireMode: "全自动/单发" },
  "MDR突击步枪": { meatHarm: 41, armorHarm: 43, shootDistance: 35, recoil: 40, control: 58, stable: 48, hipShot: 54, fireSpeed: 650, muzzleVelocity: 630, capacity: 20, fireMode: "全自动/单发" },
  "Vector冲锋枪": { meatHarm: 32, armorHarm: 28, shootDistance: 20, recoil: 38, control: 69, stable: 42, hipShot: 52, fireSpeed: 1091, muzzleVelocity: 500, capacity: 17, fireMode: "全自动/单发/连发" },
  "MP5冲锋枪": { meatHarm: 30, armorHarm: 32, shootDistance: 20, recoil: 53, control: 66, stable: 45, hipShot: 68, fireSpeed: 820, muzzleVelocity: 450, capacity: 30, fireMode: "全自动/单发/连发" },
  "MP7冲锋枪": { meatHarm: 32, armorHarm: 28, shootDistance: 20, recoil: 55, control: 67, stable: 44, hipShot: 68, fireSpeed: 950, muzzleVelocity: 450, capacity: 20, fireMode: "全自动/单发" },
  "P90冲锋枪": { meatHarm: 32, armorHarm: 35, shootDistance: 20, recoil: 48, control: 56, stable: 45, hipShot: 60, fireSpeed: 898, muzzleVelocity: 450, capacity: 50, fireMode: "单发/全自动" },
  "UZI冲锋枪": { meatHarm: 28, armorHarm: 35, shootDistance: 20, recoil: 50, control: 68, stable: 43, hipShot: 66, fireSpeed: 780, muzzleVelocity: 450, capacity: 25, fireMode: "全自动/单发" },
  "野牛冲锋枪": { meatHarm: 32, armorHarm: 35, shootDistance: 20, recoil: 43, control: 62, stable: 49, hipShot: 63, fireSpeed: 659, muzzleVelocity: 500, capacity: 32, fireMode: "全自动/单发" },
  "勇士冲锋枪": { meatHarm: 36, armorHarm: 35, shootDistance: 20, recoil: 40, control: 63, stable: 48, hipShot: 48, fireSpeed: 700, muzzleVelocity: 500, capacity: 30, fireMode: "单发/全自动" },
  "SMG-45冲锋枪": { meatHarm: 35, armorHarm: 40, shootDistance: 27, recoil: 52, control: 70, stable: 41, hipShot: 65, fireSpeed: 605, muzzleVelocity: 500, capacity: 25, fireMode: "全自动/单发" },
  "SR-3M紧凑突击步枪": { meatHarm: 36, armorHarm: 48, shootDistance: 15, recoil: 45, control: 63, stable: 43, hipShot: 68, fireSpeed: 747, muzzleVelocity: 330, capacity: 15, fireMode: "全自动/单发" },
  "QCQ171冲锋枪": { meatHarm: 36, armorHarm: 33, shootDistance: 20, recoil: 47, control: 60, stable: 46, hipShot: 58, fireSpeed: 763, muzzleVelocity: 450, capacity: 30, fireMode: "全自动/单发" },
  "MK4冲锋枪": { meatHarm: 34, armorHarm: 30, shootDistance: 20, recoil: 46, control: 60, stable: 51, hipShot: 50, fireSpeed: 793, muzzleVelocity: 475, capacity: 24, fireMode: "单发/连发" },
  "汤姆逊冲锋枪": { meatHarm: 34, armorHarm: 36, shootDistance: 18, recoil: 40, control: 67, stable: 48, hipShot: 60, fireSpeed: 900, muzzleVelocity: 500, capacity: 20, fireMode: "单发/全自动" },
  "SR-25射手步枪": { meatHarm: 50, armorHarm: 55, shootDistance: 60, recoil: 56, control: 56, stable: 59, hipShot: 40, fireSpeed: 364, muzzleVelocity: 550, capacity: 10, fireMode: "单发" },
  "SVD狙击步枪": { meatHarm: 56, armorHarm: 56, shootDistance: 70, recoil: 42, control: 48, stable: 67, hipShot: 34, fireSpeed: 300, muzzleVelocity: 500, capacity: 10, fireMode: "单发" },
  "SKS射手步枪": { meatHarm: 48, armorHarm: 49, shootDistance: 55, recoil: 30, control: 55, stable: 60, hipShot: 38, fireSpeed: 510, muzzleVelocity: 575, capacity: 10, fireMode: "单发" },
  "M14射手步枪": { meatHarm: 39, armorHarm: 41, shootDistance: 40, recoil: 26, control: 52, stable: 55, hipShot: 48, fireSpeed: 727, muzzleVelocity: 575, capacity: 10, fireMode: "全自动/单发" },
  "Mini-14射手步枪": { meatHarm: 34, armorHarm: 38, shootDistance: 90, recoil: 60, control: 52, stable: 63, hipShot: 37, fireSpeed: 590, muzzleVelocity: 650, capacity: 10, fireMode: "单发" },
  "PSG-1射手步枪": { meatHarm: 50, armorHarm: 55, shootDistance: 90, recoil: 60, control: 49, stable: 66, hipShot: 34, fireSpeed: 300, muzzleVelocity: 550, capacity: 10, fireMode: "单发" },
  "SR9射手步枪": { meatHarm: 50, armorHarm: 55, shootDistance: 90, recoil: 45, control: 43, stable: 57, hipShot: 31, fireSpeed: 261, muzzleVelocity: 550, capacity: 10, fireMode: "单发" },
  "VSS射手步枪": { meatHarm: 40, armorHarm: 48, shootDistance: 120, recoil: 46, control: 54, stable: 61, hipShot: 38, fireSpeed: 480, muzzleVelocity: 330, capacity: 15, fireMode: "单发/全自动" },
  "SVCH精确射手步枪": { meatHarm: 47, armorHarm: 46, shootDistance: 65, recoil: 40, control: 42, stable: 50, hipShot: 35, fireSpeed: 600, muzzleVelocity: 680, capacity: 10, fireMode: "单发" },
  "杠杆式步枪": { meatHarm: 70, armorHarm: 25, shootDistance: 30, recoil: 47, control: 55, stable: 49, hipShot: 43, fireSpeed: 100, muzzleVelocity: 750, capacity: 10, fireMode: "单发" },
  "AWM狙击步枪": { meatHarm: 100, armorHarm: 10, shootDistance: 200, recoil: 20, control: 44, stable: 74, hipShot: 23, fireSpeed: 35, muzzleVelocity: 750, capacity: 5, fireMode: "单发" },
  "R93狙击步枪": { meatHarm: 61, armorHarm: 58, shootDistance: 150, recoil: 55, control: 57, stable: 66, hipShot: 28, fireSpeed: 56, muzzleVelocity: 550, capacity: 10, fireMode: "单发" },
  "M700狙击步枪": { meatHarm: 61, armorHarm: 58, shootDistance: 150, recoil: 24, control: 48, stable: 70, hipShot: 27, fireSpeed: 48, muzzleVelocity: 650, capacity: 5, fireMode: "单发" },
  "SV-98狙击步枪": { meatHarm: 60, armorHarm: 58, shootDistance: 150, recoil: 55, control: 49, stable: 74, hipShot: 26, fireSpeed: 44, muzzleVelocity: 650, capacity: 7, fireMode: "单发" },
  "M82狙击步枪": { meatHarm: 100, armorHarm: 20, shootDistance: 200, recoil: 10, control: 20, stable: 66, hipShot: 15, fireSpeed: 100, muzzleVelocity: 525, capacity: 5, fireMode: "单发" },
  "PKM通用机枪": { meatHarm: 45, armorHarm: 42, shootDistance: 40, recoil: 36, control: 42, stable: 59, hipShot: 45, fireSpeed: 669, muzzleVelocity: 630, capacity: 75, fireMode: "全自动" },
  "M249轻机枪": { meatHarm: 30, armorHarm: 38, shootDistance: 40, recoil: 44, control: 47, stable: 55, hipShot: 48, fireSpeed: 858, muzzleVelocity: 575, capacity: 100, fireMode: "全自动" },
  "M250通用机枪": { meatHarm: 55, armorHarm: 53, shootDistance: 40, recoil: 40, control: 38, stable: 50, hipShot: 45, fireSpeed: 550, muzzleVelocity: 630, capacity: 125, fireMode: "全自动/单发" },
  "QJB201轻机枪": { meatHarm: 32, armorHarm: 38, shootDistance: 40, recoil: 52, control: 50, stable: 56, hipShot: 50, fireSpeed: 785, muzzleVelocity: 575, capacity: 125, fireMode: "全自动" },
  "M870霰弹枪": { meatHarm: 17, armorHarm: 16, shootDistance: 12, recoil: 26, control: 57, stable: 41, hipShot: 49, fireSpeed: 74, muzzleVelocity: 400, capacity: 6, fireMode: "单发" },
  "M1014霰弹枪": { meatHarm: 14, armorHarm: 16, shootDistance: 12, recoil: 28, control: 53, stable: 45, hipShot: 52, fireSpeed: 261, muzzleVelocity: 450, capacity: 7, fireMode: "单发" },
  "S12K霰弹枪": { meatHarm: 13, armorHarm: 16, shootDistance: 10, recoil: 36, control: 55, stable: 49, hipShot: 48, fireSpeed: 300, muzzleVelocity: 300, capacity: 5, fireMode: "单发" },
  "725双管霰弹枪": { meatHarm: 17, armorHarm: 18, shootDistance: 15, recoil: 25, control: 50, stable: 48, hipShot: 47, fireSpeed: 375, muzzleVelocity: 400, capacity: 2, fireMode: "单发" },
  "FS-12霰弹枪": { meatHarm: 14, armorHarm: 16, shootDistance: 12, recoil: 30, control: 52, stable: 47, hipShot: 51, fireSpeed: 300, muzzleVelocity: 450, capacity: 6, fireMode: "单发/泵动" },
  "QSZ92G": { meatHarm: 34, armorHarm: 32, shootDistance: 27, recoil: 55, control: 64, stable: 41, hipShot: 77, fireSpeed: 375, muzzleVelocity: 400, capacity: 15, fireMode: "单发" },
  ".357左轮": { meatHarm: 56, armorHarm: 39, shootDistance: 35, recoil: 34, control: 62, stable: 43, hipShot: 65, fireSpeed: 182, muzzleVelocity: 340, capacity: 6, fireMode: "单发" },
  "沙漠之鹰": { meatHarm: 56, armorHarm: 53, shootDistance: 15, recoil: 40, control: 66, stable: 39, hipShot: 71, fireSpeed: 207, muzzleVelocity: 340, capacity: 7, fireMode: "单发" },
  "G18": { meatHarm: 23, armorHarm: 16, shootDistance: 10, recoil: 30, control: 62, stable: 43, hipShot: 67, fireSpeed: 1172, muzzleVelocity: 400, capacity: 17, fireMode: "全自动" },
  "93R": { meatHarm: 34, armorHarm: 32, shootDistance: 22, recoil: 44, control: 67, stable: 38, hipShot: 78, fireSpeed: 508, muzzleVelocity: 400, capacity: 12, fireMode: "连发" },
  "G17": { meatHarm: 27, armorHarm: 25, shootDistance: 27, recoil: 42, control: 70, stable: 35, hipShot: 75, fireSpeed: 462, muzzleVelocity: 400, capacity: 17, fireMode: "单发" },
  "M1911": { meatHarm: 40, armorHarm: 30, shootDistance: 15, recoil: 39, control: 65, stable: 40, hipShot: 67, fireSpeed: 373, muzzleVelocity: 400, capacity: 7, fireMode: "单发" },
  "复合弓": { meatHarm: 90, armorHarm: 65, shootDistance: 65, recoil: 32, control: 66, stable: 55, hipShot: 57, fireSpeed: 182, muzzleVelocity: 300, capacity: 1, fireMode: "单发" },
};

export function weaponBase(name: string): GunBase | null {
  return WEAPON_BASE[name] ?? null;
}
