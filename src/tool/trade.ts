// 港口里的各项交易：买卖货物、补给、修船、招人、买船、酒馆消息。
// 每个函数返回 { ok, state, msg }；失败时 state 原样返回。
import { askPrice, bidPrice, eventMult, maxBuyByGold, midPrice, quoteBuy, quoteSell } from './pricing';
import { pick, rand01, round2 } from './rng';
import { REL_MIN, cargoFree, dayNumber, pushLog, shipType, tradePartners, type GameState } from './state';
import { clone } from './turn';
import { latchGoals } from './quest';
import { GOOD_BY_ID, PORT_BY_ID, SHIP_BY_ID, type GoodId } from './world';

export interface TradeResult { ok: boolean; state: GameState; msg: string }
const no = (state: GameState, msg: string): TradeResult => ({ ok: false, state, msg });

const REP_PER_GOLD = 1 / 2500;

function needDock(s: GameState): string | null {
  return s.docked;
}

/** 当前港口某商品的中间价 */
export function currentMid(s: GameState, portId: string, good: GoodId): number {
  return midPrice(portId, good, s.stock[portId][good], eventMult(s.events, portId, good, dayNumber(s)));
}
export const buyPriceOf = (s: GameState, portId: string, good: GoodId) => askPrice(currentMid(s, portId, good));
export const sellPriceOf = (s: GameState, portId: string, good: GoodId) => bidPrice(currentMid(s, portId, good));

function recordTrade(s: GameState, portId: string, value: number) {
  s.stats.traded += value;
  s.relations[portId] = (s.relations[portId] ?? 0) + value;
  s.rep = round2(s.rep + value * REP_PER_GOLD);
  latchGoals(s);
}

export function buyGood(state: GameState, good: GoodId, qty: number): TradeResult {
  const port = needDock(state);
  if (!port) return no(state, '要先靠港才能交易');
  qty = Math.floor(qty);
  if (!(qty >= 1)) return no(state, '数量要大于 0');
  const def = GOOD_BY_ID[good];
  const mult = eventMult(state.events, port, good, dayNumber(state));
  const stock = state.stock[port][good];
  const bySpace = Math.floor(cargoFree(state) / def.size);
  if (bySpace < 1) return no(state, '货舱满了');
  const byGold = maxBuyByGold(port, good, stock, state.gold, qty, mult);
  const n = Math.min(qty, bySpace, byGold);
  if (n < 1) return no(state, state.gold < askPrice(midPrice(port, good, stock, mult)) ? '资金不足' : '港里没有存货了');
  const q = quoteBuy(port, good, stock, n, mult);
  const s = clone(state);
  s.gold -= q.total;
  s.stock[port][good] = round2(q.stockAfter);
  const old = s.cargo[good] ?? { qty: 0, cost: 0 };
  const total = old.qty + q.qty;
  s.cargo[good] = { qty: total, cost: round2((old.qty * old.cost + q.total) / total) };
  recordTrade(s, port, q.total);
  return { ok: true, state: s, msg: `买入 ${q.qty} 件${def.name}，花费 ${q.total} 金币` };
}

export function sellGood(state: GameState, good: GoodId, qty: number): TradeResult {
  const port = needDock(state);
  if (!port) return no(state, '要先靠港才能交易');
  const held = state.cargo[good];
  if (!held || held.qty < 1) return no(state, '货舱里没有这种货');
  const n = Math.min(Math.floor(qty), held.qty);
  if (!(n >= 1)) return no(state, '数量要大于 0');
  const mult = eventMult(state.events, port, good, dayNumber(state));
  const q = quoteSell(port, good, state.stock[port][good], n, mult);
  const s = clone(state);
  const profit = q.total - Math.round(held.cost * n);
  s.gold += q.total;
  s.stock[port][good] = round2(q.stockAfter);
  held.qty -= n;
  if (held.qty <= 0) delete s.cargo[good];
  else s.cargo[good] = { qty: held.qty, cost: held.cost };
  s.stats.profit = round2(s.stats.profit + profit);
  recordTrade(s, port, q.total);
  const def = GOOD_BY_ID[good];
  return { ok: true, state: s, msg: `卖出 ${n} 件${def.name}，收入 ${q.total} 金币（${profit >= 0 ? '赚' : '亏'} ${Math.abs(profit)}）` };
}

// ---------------- 补给站 ----------------

export const FOOD_PRICE = 3;
export const WATER_PRICE = 2;
export const supplyPrice = (portId: string, kind: 'food' | 'water') =>
  Math.max(1, Math.round((kind === 'food' ? FOOD_PRICE : WATER_PRICE) * PORT_BY_ID[portId].supply));

export function buySupply(state: GameState, kind: 'food' | 'water', qty: number): TradeResult {
  const port = needDock(state);
  if (!port) return no(state, '要先靠港');
  const cap = shipType(state).supply;
  const have = state.ship[kind];
  const price = supplyPrice(port, kind);
  const n = Math.min(Math.floor(qty), cap - have, Math.floor(state.gold / price));
  if (n < 1) return no(state, cap - have < 1 ? '仓里已经装满了' : '资金不足');
  const s = clone(state);
  s.gold -= n * price;
  s.ship[kind] += n;
  return { ok: true, state: s, msg: `买入${kind === 'food' ? '食物' : '淡水'} ${n} 份，花费 ${n * price} 金币` };
}

// ---------------- 船坞 ----------------

export const repairPrice = (s: GameState) => Math.max(1, Math.round(shipType(s).price * 0.0025));

export function repairShip(state: GameState, points: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const type = shipType(state);
  const missing = Math.ceil(type.hull - state.ship.hull);
  const price = repairPrice(state);
  const n = Math.min(Math.floor(points), missing, Math.floor(state.gold / price));
  if (missing < 1) return no(state, '船体完好');
  if (n < 1) return no(state, '资金不足');
  const s = clone(state);
  s.gold -= n * price;
  s.ship.hull = Math.min(type.hull, round2(s.ship.hull + n));
  return { ok: true, state: s, msg: `修复船体 ${n} 点，花费 ${n * price} 金币` };
}

export function tradeInValue(state: GameState): number {
  const t = shipType(state);
  return Math.round(t.price * 0.6 * (0.5 + 0.5 * (state.ship.hull / t.hull)));
}

export function canBuildHere(state: GameState, typeId: string): string | null {
  const port = state.docked;
  if (!port) return '要先靠港';
  const t = SHIP_BY_ID[typeId];
  if (!t) return '没有这种船';
  if (t.tier > PORT_BY_ID[port].yard) return `${PORT_BY_ID[port].name}的船坞造不了这种船`;
  if (state.rep < t.rep) return `声望不足（需要 ${t.rep}）`;
  return null;
}

export function buyShip(state: GameState, typeId: string): TradeResult {
  const why = canBuildHere(state, typeId);
  if (why) return no(state, why);
  if (state.ship.type === typeId) return no(state, '已经是这种船了');
  const t = SHIP_BY_ID[typeId];
  const cost = t.price - tradeInValue(state);
  if (state.gold < cost) return no(state, `资金不足（折价后还需要 ${cost} 金币）`);
  const used = Object.entries(state.cargo).reduce((a, [g, c]) => a + c.qty * GOOD_BY_ID[g].size, 0);
  if (used > t.cargo) return no(state, '新船的货舱装不下现有货物，先卖掉一些');
  const s = clone(state);
  s.gold -= cost;
  s.ship = {
    type: t.id, name: s.ship.name, hull: t.hull,
    crew: Math.min(s.ship.crew, t.crewMax),
    food: Math.min(s.ship.food, t.supply), water: Math.min(s.ship.water, t.supply),
  };
  pushLog(s, `换了新船「${t.name}」，补差价 ${cost} 金币`);
  return { ok: true, state: s, msg: `换乘${t.name}，补差价 ${cost} 金币` };
}

// ---------------- 酒馆 ----------------

export const recruitPrice = (s: GameState) => Math.round(25 * (1 - Math.min(s.rep, 20) * 0.01));
export const ROUND_PRICE = 15;

export function recruit(state: GameState, n: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const t = shipType(state);
  const price = recruitPrice(state);
  const k = Math.min(Math.floor(n), t.crewMax - state.ship.crew, Math.floor(state.gold / price));
  if (t.crewMax - state.ship.crew < 1) return no(state, '船员已满');
  if (k < 1) return no(state, '资金不足');
  const s = clone(state);
  s.gold -= k * price;
  s.ship.crew += k;
  return { ok: true, state: s, msg: `招到 ${k} 名船员，花费 ${k * price} 金币` };
}

export function dismiss(state: GameState, n: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const k = Math.min(Math.floor(n), state.ship.crew - 1);
  if (k < 1) return no(state, '至少要留 1 个人');
  const s = clone(state);
  s.ship.crew -= k;
  return { ok: true, state: s, msg: `遣散 ${k} 名船员` };
}

/** 请全场喝一轮（ROUND_PRICE 金币），听几条消息。同一港口同一天结果固定。 */
export function listenRumors(state: GameState): TradeResult & { lines: string[] } {
  const port = state.docked;
  if (!port) return { ...no(state, '要先靠港'), lines: [] };
  if (state.gold < ROUND_PRICE) return { ...no(state, '请不起这一轮酒'), lines: [] };
  const s = clone(state);
  s.gold -= ROUND_PRICE;
  const lines = rumorLines(s, port);
  return { ok: true, state: s, msg: `请大家喝了一轮，花费 ${ROUND_PRICE} 金币`, lines };
}

export function rumorLines(s: GameState, portId: string): string[] {
  const day = dayNumber(s);
  const lines: string[] = [];
  const live = s.events.filter((e) => e.until >= day && e.port !== portId);
  for (const e of live.slice(0, 3)) {
    const p = PORT_BY_ID[e.port], g = GOOD_BY_ID[e.good];
    if (e.kind === 'shortage') lines.push(`听说${p.name}缺${g.name}，运过去能卖个好价钱。`);
    else if (e.kind === 'glut') lines.push(`${p.name}的${g.name}多得没处放，现在去那里进货最划算。`);
    else lines.push(`${p.name}在办庆典，${g.name}特别好卖。`);
  }
  const other = Object.values(PORT_BY_ID).filter((p) => p.id !== portId);
  const spare = pick(other, s.seed, 'rumor', day, portId);
  const want = pick(spare.wants, s.seed, 'rumor-g', day, portId);
  lines.push(`${spare.name}一直缺${GOOD_BY_ID[want].name}，那边的价格总比别处高。`);
  const maker = pick(other.filter((p) => p.id !== spare.id), s.seed, 'rumor2', day, portId);
  lines.push(`${maker.name}的${GOOD_BY_ID[pick(maker.makes, s.seed, 'rumor2g', day, portId)].name}又多又便宜。`);
  if (rand01(s.seed, 'rumor-s', day, portId) < 0.5) lines.push(`想建立更多贸易关系？目前已有 ${tradePartners(s)} 个港口和你有生意往来（成交额满 ${REL_MIN} 金币算数）。`);
  return lines;
}

