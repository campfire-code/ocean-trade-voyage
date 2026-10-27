// 价格模型（原创设计）：
//   每个港口、每种商品有一个「基准库存」REF = 60 × 港口规模。
//   出产品的目标库存是 REF 的 2.2 倍（货多价低），紧缺品是 0.45 倍（货少价高），其余等于 REF。
//   价格 = 基准价 × (REF / 当前库存)^0.55 × 事件系数，限制在 0.35～3 倍之间。
//   买走货物库存下降、价格上涨；卖入货物库存上升、价格下跌（批量成交时逐件结算）。
//   库存每天向目标库存回归 6%，再叠加一点随机波动，所以价格会自己恢复，也会有行情起伏。
import { GOOD_BY_ID, PORT_BY_ID, type GoodId } from './world';
import { clamp, rand01, round2 } from './rng';

export const ELASTICITY = 0.55;
export const SPREAD = 0.05; // 买价比中间价高 5%，卖价低 5%
export const RELAX = 0.06;
export const MIN_RATIO = 0.35;
export const MAX_RATIO = 3;
export const MIN_STOCK = 1;

export type EventKind = 'shortage' | 'glut' | 'festival';
export interface MarketEvent {
  id: string;
  port: string;
  good: GoodId;
  kind: EventKind;
  /** 价格额外乘数 */
  mult: number;
  /** 到哪一天（含）结束 */
  until: number;
  text: string;
}

export function refStock(portId: string): number {
  return 60 * PORT_BY_ID[portId].size;
}

export function targetStock(portId: string, good: GoodId): number {
  const p = PORT_BY_ID[portId];
  const ref = refStock(portId);
  if (p.makes.includes(good)) return round2(ref * 2.2);
  if (p.wants.includes(good)) return round2(ref * 0.45);
  return round2(ref);
}

export function affinity(portId: string, good: GoodId): 'make' | 'want' | 'normal' {
  const p = PORT_BY_ID[portId];
  return p.makes.includes(good) ? 'make' : p.wants.includes(good) ? 'want' : 'normal';
}

export function eventMult(events: MarketEvent[], portId: string, good: GoodId, day: number): number {
  let m = 1;
  for (const e of events) if (e.port === portId && e.good === good && day <= e.until) m *= e.mult;
  return m;
}

/** 当前中间价（不含买卖差价），整数金币 */
export function midPrice(portId: string, good: GoodId, stock: number, mult = 1): number {
  const ratio = clamp(Math.pow(refStock(portId) / Math.max(stock, MIN_STOCK), ELASTICITY) * mult, MIN_RATIO, MAX_RATIO);
  return Math.max(1, Math.round(GOOD_BY_ID[good].base * ratio));
}

export const askPrice = (mid: number) => Math.max(1, Math.round(mid * (1 + SPREAD)));
export const bidPrice = (mid: number) => Math.max(1, Math.round(mid * (1 - SPREAD)));

export interface Quote { total: number; avg: number; stockAfter: number; qty: number }

/** 买 qty 件的总价：逐件结算，每买一件库存减 1 */
export function quoteBuy(portId: string, good: GoodId, stock: number, qty: number, mult = 1): Quote {
  let s = stock, total = 0;
  const n = Math.min(qty, Math.floor(stock - MIN_STOCK));
  for (let i = 0; i < n; i++) {
    total += askPrice(midPrice(portId, good, s, mult));
    s -= 1;
  }
  return { total, avg: n ? total / n : 0, stockAfter: s, qty: Math.max(0, n) };
}

/** 卖 qty 件的总收入：逐件结算，每卖一件库存加 1 */
export function quoteSell(portId: string, good: GoodId, stock: number, qty: number, mult = 1): Quote {
  let s = stock, total = 0;
  for (let i = 0; i < qty; i++) {
    total += bidPrice(midPrice(portId, good, s, mult));
    s += 1;
  }
  return { total, avg: qty ? total / qty : 0, stockAfter: s, qty };
}

/** 在预算内最多买几件 */
export function maxBuyByGold(portId: string, good: GoodId, stock: number, gold: number, cap: number, mult = 1): number {
  let s = stock, left = gold, n = 0;
  while (n < cap && s - 1 >= MIN_STOCK) {
    const p = askPrice(midPrice(portId, good, s, mult));
    if (p > left) break;
    left -= p;
    s -= 1;
    n += 1;
  }
  return n;
}

/** 过一天：库存向目标回归，叠加 ±4% 的随机波动 */
export function relaxStock(seed: number, day: number, portId: string, good: GoodId, stock: number): number {
  const target = targetStock(portId, good);
  const noise = (rand01(seed, 'mk', day, portId, good) - 0.5) * 0.08 * refStock(portId);
  return round2(Math.max(MIN_STOCK, stock + (target - stock) * RELAX + noise));
}

export function initialStock(seed: number, portId: string, good: GoodId): number {
  return round2(targetStock(portId, good) * (0.9 + rand01(seed, 'init', portId, good) * 0.2));
}

/** 与基准价相比的档位，用于界面上的「便宜 / 贵」提示 */
export function priceTier(mid: number, good: GoodId): 'cheap' | 'fair' | 'dear' {
  const r = mid / GOOD_BY_ID[good].base;
  return r < 0.82 ? 'cheap' : r > 1.25 ? 'dear' : 'fair';
}
