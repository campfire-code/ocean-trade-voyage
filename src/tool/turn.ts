// 回合推进：新游戏、航行一步、过一天、靠港与脱险。所有函数返回新状态，不改传入的对象。
import { canStep, idx, T_SHALLOW, type SeaMap } from './mapgen';
import { relaxStock, initialStock, type MarketEvent } from './pricing';
import { makeQuest, closeQuarter, latchGoals } from './quest';
import { pick, rand01, round2 } from './rng';
import { consumeDay, dailyWear, headingIndex, stepDays, stormDamage, windAt } from './sailing';
import { START_GOLD, START_PORT, WAGE, pushLog, shipType, type GameState } from './state';
import { DAYS_PER_QUARTER, GOODS, PORTS, PORT_BY_ID, SHIP_BY_ID } from './world';

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function newGame(map: SeaMap, seed = 1027, captain = '新船长'): GameState {
  const type = SHIP_BY_ID.lark;
  const site = map.sites.find((x) => x.id === START_PORT)!;
  const stock: GameState['stock'] = {};
  for (const p of PORTS) {
    stock[p.id] = {};
    for (const g of GOODS) stock[p.id][g.id] = initialStock(seed, p.id, g.id);
  }
  const s: GameState = {
    v: 1, seed, captain, t: 0, pos: [site.dock[0], site.dock[1]], docked: START_PORT,
    gold: START_GOLD, rep: 0,
    ship: { type: type.id, name: '晨星号', hull: type.hull, crew: 6, food: Math.round(type.supply * 0.6), water: Math.round(type.supply * 0.6) },
    cargo: {}, stock, events: [], relations: {}, wageDue: 0,
    quest: makeQuest(0, 0, 0),
    stats: { traded: 0, profit: 0, sailedDays: 0, questsWon: 0, questsMissed: 0, rescued: 0 },
    log: [],
  };
  pushLog(s, `${captain}接手了「${s.ship.name}」，在${PORT_BY_ID[START_PORT].name}起步，目标是这个季度的两项指标。`);
  return s;
}

// ---------------- 市场事件 ----------------

export const EVENT_CHANCE = 0.07;
export const EVENT_MAX = 8;

function maybeSpawnEvent(s: GameState, d: number) {
  if (s.events.length >= EVENT_MAX || rand01(s.seed, 'ev', d) >= EVENT_CHANCE) return;
  const port = pick(PORTS, s.seed, 'evp', d);
  const good = pick(GOODS, s.seed, 'evg', d);
  const r = rand01(s.seed, 'evk', d);
  const kind = r < 0.45 ? 'shortage' : r < 0.75 ? 'glut' : good.base >= 50 ? 'festival' : 'shortage';
  const ev: MarketEvent = { id: `${d}-${port.id}-${good.id}`, port: port.id, good: good.id, kind, mult: 1, until: d, text: '' };
  if (kind === 'shortage') {
    Object.assign(ev, { mult: 1.6, until: d + 14, text: `${port.name}的${good.name}告急，价格被抬高` });
    s.stock[port.id][good.id] = round2(Math.max(1, s.stock[port.id][good.id] * 0.5));
  } else if (kind === 'glut') {
    Object.assign(ev, { mult: 0.7, until: d + 10, text: `${port.name}的${good.name}堆满了仓，价格走低` });
    s.stock[port.id][good.id] = round2(s.stock[port.id][good.id] * 1.8);
  } else {
    Object.assign(ev, { mult: 1.35, until: d + 8, text: `${port.name}办起了庆典，${good.name}很抢手` });
  }
  if (s.events.some((e) => e.port === port.id && e.good === good.id)) return;
  s.events.push(ev);
}

// ---------------- 时间推进 ----------------

function dayTick(s: GameState, d: number, atSea: boolean) {
  for (const p of PORTS) for (const g of GOODS) s.stock[p.id][g.id] = relaxStock(s.seed, d, p.id, g.id, s.stock[p.id][g.id]);
  s.events = s.events.filter((e) => e.until >= d);
  maybeSpawnEvent(s, d);
  s.wageDue = round2(s.wageDue + s.ship.crew * WAGE);
  if (atSea) {
    const type = shipType(s);
    s.stats.sailedDays += 1;
    s.ship.hull = round2(Math.max(0, s.ship.hull - dailyWear(type.hull)));
    const wind = windAt(s.seed, d);
    const dmg = stormDamage(s.seed, d, wind, type.hull);
    if (dmg > 0) {
      s.ship.hull = round2(Math.max(0, s.ship.hull - dmg));
      pushLog(s, `遇上大风浪，船体受损 ${dmg} 点`);
    }
    const r = consumeDay(s.ship.food, s.ship.water, s.ship.crew);
    s.ship.food = r.food;
    s.ship.water = r.water;
    s.ship.crew = r.crew;
    if (r.short) pushLog(s, `补给耗尽，${r.lost} 名船员倒下了`);
  }
  if (d > 0 && d % DAYS_PER_QUARTER === 0) closeQuarter(s);
}

/** 时间前进 dt 天：每跨过一个整天，结算一次 */
export function advance(s: GameState, dt: number, atSea: boolean) {
  const t0 = s.t;
  s.t = Math.round((t0 + dt) * 10000) / 10000;
  for (let d = Math.floor(t0) + 1; d <= Math.floor(s.t); d++) dayTick(s, d, atSea);
}

// ---------------- 工资与靠港 ----------------

export function settleWages(s: GameState) {
  const due = Math.ceil(s.wageDue);
  s.wageDue = 0;
  if (due <= 0) return;
  if (s.gold >= due) {
    s.gold -= due;
    pushLog(s, `发放工资 ${due} 金币`);
    return;
  }
  const paid = s.gold;
  const frac = (due - paid) / due;
  const left = Math.min(s.ship.crew - 1, Math.floor(s.ship.crew * frac * 0.5));
  s.gold = 0;
  s.ship.crew -= Math.max(0, left);
  pushLog(s, `工资只发了 ${paid} 金币（应发 ${due}），${Math.max(0, left)} 名船员离队`);
}

export function dockAt(s: GameState, portId: string) {
  s.docked = portId;
  pushLog(s, `抵达${PORT_BY_ID[portId].name}`);
  settleWages(s);
  latchGoals(s);
}

// ---------------- 航行 ----------------

export interface StepResult {
  state: GameState;
  ok: boolean;
  /** 需要打断自动航行（靠港、被救、断粮、季度结算等） */
  interrupt: boolean;
  reason?: string;
}

const fail = (state: GameState, reason: string): StepResult => ({ state, ok: false, interrupt: true, reason });

export function nearestDock(map: SeaMap, pos: [number, number]) {
  return [...map.sites].sort((a, b) =>
    Math.hypot(a.dock[0] - pos[0], a.dock[1] - pos[1]) - Math.hypot(b.dock[0] - pos[0], b.dock[1] - pos[1]))[0];
}

/** 船沉了或人不够：被路过的渔船送到最近的港口，丢掉货物，付 15% 的钱 */
export function rescue(s: GameState, map: SeaMap, why: string) {
  const site = nearestDock(map, s.pos);
  const type = shipType(s);
  const fee = Math.round(s.gold * 0.15);
  s.gold -= fee;
  s.cargo = {};
  s.pos = [site.dock[0], site.dock[1]];
  s.ship.crew = Math.max(s.ship.crew, type.crewMin);
  s.ship.hull = Math.max(s.ship.hull, Math.round(type.hull * 0.3));
  s.ship.food = Math.max(s.ship.food, 5);
  s.ship.water = Math.max(s.ship.water, 5);
  s.stats.rescued += 1;
  advance(s, 4, false);
  pushLog(s, `${why}，被渔船拖到${PORT_BY_ID[site.id].name}。货物全损，付了 ${fee} 金币救助费，耽误 4 天`);
  s.docked = site.id;
}

export function sailStep(map: SeaMap, state: GameState, dx: number, dy: number): StepResult {
  if (state.docked) return fail(state, '船还停在港里，先起航');
  const type = shipType(state);
  if (state.ship.crew < type.crewMin) return fail(state, '船员不足，开不动船');
  const [x, y] = state.pos;
  if (!canStep(map, x, y, Math.sign(dx), Math.sign(dy))) return fail(state, '那边是陆地');
  const s = clone(state);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const nx = x + sx, ny = y + sy;
  const wind = windAt(s.seed, Math.floor(s.t));
  const dt = stepDays(type, {
    heading: headingIndex(sx, sy), wind, crew: s.ship.crew, hull: s.ship.hull,
    shallow: map.tiles[idx(nx, ny)] === T_SHALLOW,
  });
  const logBefore = s.log.length;
  const foodBefore = s.ship.food, waterBefore = s.ship.water, crewBefore = s.ship.crew;
  s.pos = [nx, ny];
  advance(s, dt, true);
  let interrupt = s.log.length !== logBefore || s.ship.crew !== crewBefore;
  const rescued = s.ship.hull <= 0 || s.ship.crew < type.crewMin;
  if (rescued) {
    rescue(s, map, s.ship.hull <= 0 ? '船体撑不住沉没了' : '船员折损过半无法航行');
    return { state: s, ok: true, interrupt: true, reason: '被救起' };
  }
  const site = map.sites.find((p) => p.dock[0] === nx && p.dock[1] === ny);
  if (site) {
    dockAt(s, site.id);
    return { state: s, ok: true, interrupt: true, reason: '靠港' };
  }
  const need = Math.max(1, Math.ceil(s.ship.crew / 5));
  if ((foodBefore >= need * 3 && s.ship.food < need * 3) || (waterBefore >= need * 3 && s.ship.water < need * 3)) {
    pushLog(s, '补给只够 3 天了，赶紧找个港口');
    interrupt = true;
  }
  return { state: s, ok: true, interrupt };
}

/** 在港里停一天：等行情恢复，工资照付 */
export function waitDay(state: GameState): StepResult {
  if (!state.docked) return fail(state, '海上不能原地休整');
  const s = clone(state);
  advance(s, 1, false);
  settleWages(s);
  latchGoals(s);
  return { state: s, ok: true, interrupt: true };
}

export function undock(state: GameState): StepResult {
  if (!state.docked) return fail(state, '已经在海上');
  const s = clone(state);
  pushLog(s, `从${PORT_BY_ID[state.docked].name}起航`);
  s.docked = null;
  return { state: s, ok: true, interrupt: true };
}

/** 船停在码头水格但没有靠港时，手动靠港 */
export function tryDock(map: SeaMap, state: GameState): StepResult {
  const site = map.sites.find((p) => p.dock[0] === state.pos[0] && p.dock[1] === state.pos[1]);
  if (state.docked || !site) return fail(state, '这里不是码头');
  const s = clone(state);
  dockAt(s, site.id);
  return { state: s, ok: true, interrupt: true };
}

