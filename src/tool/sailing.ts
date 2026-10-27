// 航行规则：风向与航速、补给消耗、断粮损失船员。全部是纯函数。
import { clamp, rand01 } from './rng';
import type { ShipType } from './world';

/** 8 个方位，下标 0 = 北，顺时针；向量是屏幕坐标（y 向下） */
export const DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const DIR_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export interface Wind {
  /** 风从哪个方位吹来（0～7） */
  from: number;
  /** 强度 1 微风、2 和风、3 大风 */
  strength: 1 | 2 | 3;
}

export const WIND_BLOCK_DAYS = 4;
export const STRENGTH_MULT = { 1: 0.8, 2: 1.0, 3: 1.15 } as const;
export const STRENGTH_NAMES = { 1: '微风', 2: '和风', 3: '大风' } as const;

/** 某一天的风：每 4 天换一次，由种子决定，所以存档读回来风不变 */
export function windAt(seed: number, day: number): Wind {
  const block = Math.floor(day / WIND_BLOCK_DAYS);
  const prev = rand01(seed, 'wd', block - 1);
  const from = rand01(seed, 'wd', block) < 0.5 ? Math.floor(prev * 8) : Math.floor(rand01(seed, 'wf', block) * 8);
  const r = rand01(seed, 'ws', block);
  return { from, strength: r < 0.3 ? 1 : r < 0.85 ? 2 : 3 };
}

export const windName = (w: Wind) => `${DIR_NAMES[w.from]}风 · ${STRENGTH_NAMES[w.strength]}`;

export function headingIndex(dx: number, dy: number): number {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  return DIRS.findIndex(([x, y]) => x === sx && y === sy);
}

/** 航向与风的夹角因子：顺风 1，逆风降到 upwind（该船型逆风能保留的比例） */
export function windFactor(heading: number, wind: Wind, upwind: number): number {
  const to = (wind.from + 4) % 8; // 风吹向的方位
  let d = Math.abs(heading - to) % 8;
  if (d > 4) d = 8 - d;
  const cos = Math.cos((d * Math.PI) / 4);
  return (upwind + (1 - upwind) * (1 + cos) / 2) * STRENGTH_MULT[wind.strength];
}

export const crewFactor = (crew: number, type: ShipType) => 0.5 + 0.5 * clamp(crew / type.crewMax, 0, 1);
export const hullFactor = (hull: number, type: ShipType) => 0.7 + 0.3 * clamp(hull / type.hull, 0, 1);

/** 走一步花多少天。diagonal：斜走距离 √2；shallow：浅滩减速 15% */
export function stepDays(type: ShipType, opts: { heading: number; wind: Wind; crew: number; hull: number; shallow: boolean }): number {
  const dx = DIRS[opts.heading];
  const dist = dx[0] !== 0 && dx[1] !== 0 ? Math.SQRT2 : 1;
  const v = type.speed * windFactor(opts.heading, opts.wind, type.upwind) * crewFactor(opts.crew, type) * hullFactor(opts.hull, type) * (opts.shallow ? 0.85 : 1);
  return dist / Math.max(v, 0.2);
}

/** 每天消耗的食物 / 淡水（各自）：每 5 个船员 1 份 */
export const dailySupply = (crew: number) => Math.max(1, Math.ceil(crew / 5));

export interface SupplyResult { food: number; water: number; crew: number; lost: number; short: boolean }

/** 过一天的补给结算：不够就先扣光，缺口让船员死伤（每天 10%，至少 1 人，最少剩 1 人） */
export function consumeDay(food: number, water: number, crew: number): SupplyResult {
  const need = dailySupply(crew);
  const f = Math.max(0, food - need);
  const w = Math.max(0, water - need);
  const short = food < need || water < need;
  let lost = 0;
  if (short) lost = Math.min(crew - 1, Math.max(1, Math.round(crew * 0.1)));
  return { food: f, water: w, crew: crew - lost, lost, short };
}

/** 大风天的风暴损伤：返回船体损失点数（0 表示平安） */
export function stormDamage(seed: number, day: number, wind: Wind, maxHull: number): number {
  if (wind.strength < 3) return 0;
  if (rand01(seed, 'storm', day) > 0.35) return 0;
  return Math.max(1, Math.round(maxHull * (0.03 + rand01(seed, 'stormd', day) * 0.05)));
}

/** 每天的船体磨损 */
export const dailyWear = (maxHull: number) => Math.max(0.2, maxHull * 0.004);

