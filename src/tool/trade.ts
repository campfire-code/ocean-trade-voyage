// 港口里的各项交易：买卖货物、补给、修船、招人、买船、酒馆消息。
// 每个函数返回 { ok, state, msg }；失败时 state 原样返回。
import { askPrice, bidPrice, eventMult, maxBuyByGold, midPrice, quoteBuy, quoteSell } from './pricing';
import { pick, rand01, round2 } from './rng';
import {
  REL_MIN, cargoFree, cargoUsed, clone, dayNumber, fleetCargoCap, fleetShips, fleetSupplyCap, pushLog, shipType, tradePartners, typeOf,
  type GameState, type Ship,
} from './state';
import { latchGoals } from './quest';
import { condMult, COND_NAME } from './events';
import { ARMOR_MAX, GUARD_PRICE, GUN_PRICE, MAX_FLEET, armorPrice, guardCap, makeShip, normalizeFleet } from './fleet';
import { FOES } from './foes';
import { GOOD_BY_ID, PORT_BY_ID, REGIONS, SHIP_BY_ID, type GoodId } from './world';

export interface TradeResult { ok: boolean; state: GameState; msg: string }
const no = (state: GameState, msg: string): TradeResult => ({ ok: false, state, msg });

const REP_PER_GOLD = 1 / 2500;

function needDock(s: GameState): string | null {
  return s.docked;
}

/** 当前港口某商品的中间价 */
export const marketMult = (s: GameState, portId: string, good: GoodId): number =>
  eventMult(s.events, portId, good, dayNumber(s)) * condMult(s.conds, portId, good, dayNumber(s));
export function currentMid(s: GameState, portId: string, good: GoodId): number {
  return midPrice(portId, good, s.stock[portId][good], marketMult(s, portId, good));
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
  const mult = marketMult(state, port, good);
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
  const mult = marketMult(state, port, good);
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
  const cap = fleetSupplyCap(state);
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

export const repairPriceOf = (sh: Ship) => Math.max(1, Math.round(typeOf(sh).price * 0.0025));
export const repairPrice = (s: GameState) => repairPriceOf(s.ship);
/** 全船队还缺的船体点数与全修好的价钱 */
export function repairNeed(s: GameState): { points: number; cost: number } {
  let points = 0, cost = 0;
  for (const sh of fleetShips(s)) {
    const m = Math.max(0, Math.ceil(typeOf(sh).hull - sh.hull));
    points += m; cost += m * repairPriceOf(sh);
  }
  return { points, cost };
}

/** 修船：从旗舰开始，逐艘修到满，直到点数或资金用完 */
export function repairShip(state: GameState, points: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const need = repairNeed(state);
  if (need.points < 1) return no(state, '船体完好');
  const s = clone(state);
  let left = Math.floor(points), spent = 0, fixed = 0;
  for (const sh of fleetShips(s)) {
    const price = repairPriceOf(sh);
    const n = Math.min(left, Math.ceil(typeOf(sh).hull - sh.hull), Math.floor(s.gold / price));
    if (n < 1) continue;
    s.gold -= n * price;
    sh.hull = Math.min(typeOf(sh).hull, round2(sh.hull + n));
    left -= n; spent += n * price; fixed += n;
  }
  if (fixed < 1) return no(state, '资金不足');
  return { ok: true, state: s, msg: `修复船体 ${fixed} 点，花费 ${spent} 金币` };
}

export function tradeInValue(state: GameState, ship: Ship = state.ship): number {
  const t = typeOf(ship);
  return Math.round(t.price * 0.6 * (0.5 + 0.5 * (ship.hull / t.hull)));
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
  const cap = fleetCargoCap(state) - shipType(state).cargo + t.cargo;
  if (cargoUsed(state) > cap) return no(state, '新船的货舱装不下现有货物，先卖掉一些');
  const s = clone(state);
  const oldGuns = s.ship.guns;
  const keep = Math.min(oldGuns, t.gunSlots);
  const refund = (oldGuns - keep) * Math.round(GUN_PRICE / 2);
  s.gold -= cost - refund;
  s.ship = {
    type: t.id, name: s.ship.name, hull: t.hull,
    crew: Math.min(s.ship.crew, t.crewMax),
    food: s.ship.food, water: s.ship.water, guns: keep, armor: 0,
  };
  const sup = fleetSupplyCap(s);
  s.ship.food = Math.min(s.ship.food, sup);
  s.ship.water = Math.min(s.ship.water, sup);
  s.guards = Math.min(s.guards, guardCap(s));
  pushLog(s, `换了新船「${t.name}」，补差价 ${cost - refund} 金币`);
  return { ok: true, state: s, msg: `换乘${t.name}，补差价 ${cost - refund} 金币${oldGuns > keep ? `（多出的 ${oldGuns - keep} 门炮折价 ${refund}）` : ''}` };
}

const CONSORT_NAMES = ['海燕号', '白帆号', '浮光号', '流萤号', '听潮号'];

/** 买一艘僚船编入船队：最多 3 艘；自动配齐最低船员 */
export function buyConsort(state: GameState, typeId: string): TradeResult {
  const why = canBuildHere(state, typeId);
  if (why) return no(state, why);
  if (fleetShips(state).length >= MAX_FLEET) return no(state, `船队最多 ${MAX_FLEET} 艘船`);
  const t = SHIP_BY_ID[typeId];
  const crew = t.crewMin;
  const cost = t.price + crew * recruitPrice(state);
  if (state.gold < cost) return no(state, `资金不足（船价加 ${crew} 名船员共 ${cost} 金币）`);
  const s = clone(state);
  const used = new Set(fleetShips(s).map((x) => x.name));
  const name = CONSORT_NAMES.find((n) => !used.has(n)) ?? `僚船${s.consorts.length + 1}`;
  s.gold -= cost;
  s.consorts.push(makeShip(t.id, name, crew));
  pushLog(s, `买下僚船「${name}」（${t.name}），编入船队`);
  return { ok: true, state: s, msg: `买下僚船「${name}」，连同 ${crew} 名船员共花 ${cost} 金币` };
}

/** 卖掉一艘僚船（旗舰不能卖，要换就用「换乘」） */
export function sellConsort(state: GameState, index: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = state.consorts[index];
  if (!sh) return no(state, '没有这艘僚船');
  if (cargoUsed(state) > fleetCargoCap(state) - typeOf(sh).cargo) return no(state, '卖掉它后货舱装不下现有货物，先卖掉一些');
  const s = clone(state);
  const val = tradeInValue(state, sh);
  s.gold += val;
  s.consorts.splice(index, 1);
  normalizeFleet(s);
  pushLog(s, `卖掉了僚船「${sh.name}」，得 ${val} 金币`);
  return { ok: true, state: s, msg: `卖掉僚船「${sh.name}」，得 ${val} 金币` };
}

// ---------------- 装备：火炮与装甲 ----------------

export function buyGun(state: GameState, index = 0): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = fleetShips(state)[index];
  if (!sh) return no(state, '没有这艘船');
  if (sh.guns >= typeOf(sh).gunSlots) return no(state, `「${sh.name}」的炮位满了（${typeOf(sh).gunSlots} 门）`);
  if (state.gold < GUN_PRICE) return no(state, '资金不足');
  const s = clone(state);
  fleetShips(s)[index].guns += 1;
  s.gold -= GUN_PRICE;
  return { ok: true, state: s, msg: `「${sh.name}」装上 1 门火炮，花费 ${GUN_PRICE} 金币（炮手不够时发挥不出：每 2 名船员操作 1 门）` };
}

export function sellGun(state: GameState, index = 0): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = fleetShips(state)[index];
  if (!sh || sh.guns < 1) return no(state, '船上没有火炮可卖');
  const s = clone(state);
  fleetShips(s)[index].guns -= 1;
  const val = Math.round(GUN_PRICE / 2);
  s.gold += val;
  return { ok: true, state: s, msg: `卸下 1 门火炮，卖得 ${val} 金币` };
}

export function nextArmorPrice(state: GameState, index = 0): number {
  const sh = fleetShips(state)[index];
  return sh ? armorPrice(sh, sh.armor + 1) - (sh.armor ? armorPrice(sh, sh.armor) : 0) : 0;
}

/** 给船加固铁皮：每级减少 15% 受到的炮击伤害，最高 2 级 */
export function buyArmor(state: GameState, index = 0): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = fleetShips(state)[index];
  if (!sh) return no(state, '没有这艘船');
  if (sh.armor >= ARMOR_MAX) return no(state, '已经加固到最高级');
  const price = nextArmorPrice(state, index);
  if (state.gold < price) return no(state, '资金不足');
  const s = clone(state);
  fleetShips(s)[index].armor += 1;
  s.gold -= price;
  return { ok: true, state: s, msg: `「${sh.name}」加固铁皮到 ${sh.armor + 1} 级，花费 ${price} 金币` };
}

// ---------------- 酒馆 ----------------

export const recruitPrice = (s: GameState) => Math.round(25 * (1 - Math.min(s.rep, 20) * 0.01));
export const ROUND_PRICE = 15;

export function recruit(state: GameState, n: number, index = 0): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = fleetShips(state)[index];
  if (!sh) return no(state, '没有这艘船');
  const t = typeOf(sh);
  const price = recruitPrice(state);
  const k = Math.min(Math.floor(n), t.crewMax - sh.crew, Math.floor(state.gold / price));
  if (t.crewMax - sh.crew < 1) return no(state, '船员已满');
  if (k < 1) return no(state, '资金不足');
  const s = clone(state);
  s.gold -= k * price;
  fleetShips(s)[index].crew += k;
  return { ok: true, state: s, msg: `招到 ${k} 名船员，花费 ${k * price} 金币` };
}

export function dismiss(state: GameState, n: number, index = 0): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const sh = fleetShips(state)[index];
  if (!sh) return no(state, '没有这艘船');
  const k = Math.min(Math.floor(n), sh.crew - 1);
  if (k < 1) return no(state, '至少要留 1 个人');
  const s = clone(state);
  fleetShips(s)[index].crew -= k;
  return { ok: true, state: s, msg: `遣散 ${k} 名船员` };
}

/** 酒馆雇护卫：不占船员名额，肉搏战力是船员的 2.5 倍，每天工资 1 金币，每艘船最多带 4 名 */
export function hireGuards(state: GameState, n: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const room = guardCap(state) - state.guards;
  if (room < 1) return no(state, `护卫已满（每艘船最多 ${4} 名）`);
  const k = Math.min(Math.floor(n), room, Math.floor(state.gold / GUARD_PRICE));
  if (k < 1) return no(state, '资金不足');
  const s = clone(state);
  s.gold -= k * GUARD_PRICE;
  s.guards += k;
  return { ok: true, state: s, msg: `雇了 ${k} 名护卫，花费 ${k * GUARD_PRICE} 金币（每人每天工资 1 金币）` };
}

export function dismissGuards(state: GameState, n: number): TradeResult {
  if (!needDock(state)) return no(state, '要先靠港');
  const k = Math.min(Math.floor(n), state.guards);
  if (k < 1) return no(state, '没有护卫可遣散');
  const s = clone(state);
  s.guards -= k;
  return { ok: true, state: s, msg: `遣散 ${k} 名护卫` };
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
  for (const c of s.conds.filter((x) => x.until >= day && x.port !== portId).slice(0, 2)) lines.push(`听说${c.text}（${COND_NAME[c.kind]}）。`);
  const foe = pick(FOES, s.seed, 'rumor-foe', day, portId);
  const reg = pick(REGIONS, s.seed, 'rumor-reg', day, portId);
  lines.push(`有人说${foe.faction}的「${foe.name}」最近在${reg.name}一带出没，带着贵重货物的船要当心。`);
  const other = Object.values(PORT_BY_ID).filter((p) => p.id !== portId);
  const spare = pick(other, s.seed, 'rumor', day, portId);
  const want = pick(spare.wants, s.seed, 'rumor-g', day, portId);
  lines.push(`${spare.name}一直缺${GOOD_BY_ID[want].name}，那边的价格总比别处高。`);
  const maker = pick(other.filter((p) => p.id !== spare.id), s.seed, 'rumor2', day, portId);
  lines.push(`${maker.name}的${GOOD_BY_ID[pick(maker.makes, s.seed, 'rumor2g', day, portId)].name}又多又便宜。`);
  if (rand01(s.seed, 'rumor-s', day, portId) < 0.5) lines.push(`想建立更多贸易关系？目前已有 ${tradePartners(s)} 个港口和你有生意往来（成交额满 ${REL_MIN} 金币算数）。`);
  return lines;
}

