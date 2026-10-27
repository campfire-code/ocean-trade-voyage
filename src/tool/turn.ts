// 回合推进：新游戏、航行一步、过一天、靠港与脱险。所有函数返回新状态，不改传入的对象。
import { canStep, idx, T_SHALLOW, type SeaMap } from './mapgen';
import { relaxStock, initialStock, type MarketEvent } from './pricing';
import { makeQuest, closeQuarter, latchGoals } from './quest';
import { pick, rand01, round2 } from './rng';
import { DIRS, consumeDay, dailyWear, headingIndex, stormDamage, windAt } from './sailing';
import {
  dayNumber, START_GOLD, START_PORT, GUARD_WAGE, WAGE, clone, fleetShips, people, pushLog, shipType, totalCrew, typeOf, type GameState,
} from './state';
import { DAYS_PER_QUARTER, GOODS, PORTS, PORT_BY_ID, SHIP_BY_ID } from './world';
import { fleetStepDays, normalizeFleet, removeCrew } from './fleet';
import { maybeEncounter, startCombat } from './combat';
import { SEA_EVENT_BY_ID, applyEffects, condAt, isBlockaded, maybeSpawnCond, rollSeaEvent } from './events';
import { newStory, storyTick } from './story';

export { clone };

export function newGame(map: SeaMap, seed = 1027, captain = '新船长'): GameState {
  const type = SHIP_BY_ID.lark;
  const site = map.sites.find((x) => x.id === START_PORT)!;
  const stock: GameState['stock'] = {};
  for (const p of PORTS) {
    stock[p.id] = {};
    for (const g of GOODS) stock[p.id][g.id] = initialStock(seed, p.id, g.id);
  }
  const s: GameState = {
    v: 2, seed, captain, t: 0, pos: [site.dock[0], site.dock[1]], docked: START_PORT,
    gold: START_GOLD, rep: 0,
    ship: { type: type.id, name: '晨星号', hull: type.hull, crew: 6, food: Math.round(type.supply * 0.6), water: Math.round(type.supply * 0.6), guns: 2, armor: 0 },
    consorts: [], guards: 0,
    cargo: {}, stock, events: [], conds: [], relations: {}, wageDue: 0,
    quest: makeQuest(0, 0, 0),
    story: newStory(), scene: null, combat: null,
    stats: { traded: 0, profit: 0, sailedDays: 0, questsWon: 0, questsMissed: 0, rescued: 0, battlesWon: 0, battlesLost: 0, fled: 0, paid: 0, reliefDay: 0 },
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

function dayTick(s: GameState, d: number, atSea: boolean, quiet: boolean) {
  for (const p of PORTS) for (const g of GOODS) s.stock[p.id][g.id] = relaxStock(s.seed, d, p.id, g.id, s.stock[p.id][g.id]);
  s.events = s.events.filter((e) => e.until >= d);
  s.conds = s.conds.filter((c) => c.until >= d);
  maybeSpawnEvent(s, d);
  maybeSpawnCond(s, d);
  s.wageDue = round2(s.wageDue + totalCrew(s) * WAGE + s.guards * GUARD_WAGE);
  if (atSea) {
    s.stats.sailedDays += 1;
    const wind = windAt(s.seed, d);
    let stormed = 0;
    for (const sh of fleetShips(s)) {
      const type = typeOf(sh);
      sh.hull = round2(Math.max(0, sh.hull - dailyWear(type.hull)));
      const dmg = stormDamage(s.seed, d, wind, type.hull);
      if (dmg > 0) { sh.hull = round2(Math.max(0, sh.hull - dmg)); stormed += dmg; }
    }
    if (stormed > 0) pushLog(s, `遇上大风浪，船队受损 ${stormed} 点`);
    const r = consumeDay(s.ship.food, s.ship.water, people(s));
    s.ship.food = r.food;
    s.ship.water = r.water;
    if (r.short) {
      const dead = removeCrew(s, r.lost);
      const gl = Math.min(s.guards, r.lost - dead);
      s.guards -= gl;
      pushLog(s, `补给耗尽，${dead + gl} 人倒下了`);
    }
    if (!quiet && !maybeEncounter(s, d)) {
      const sc = rollSeaEvent(s, d);
      if (sc) { s.scene = sc; pushLog(s, `海上事件：${sc.title}`); }
    }
  }
  if (d > 0 && d % DAYS_PER_QUARTER === 0) closeQuarter(s);
}

/** 时间前进 dt 天：每跨过一个整天，结算一次。quiet 为真时海上不再触发遭遇与事件。 */
export function advance(s: GameState, dt: number, atSea: boolean, quiet = false) {
  const t0 = s.t;
  s.t = Math.round((t0 + dt) * 10000) / 10000;
  for (let d = Math.floor(t0) + 1; d <= Math.floor(s.t); d++) dayTick(s, d, atSea, quiet);
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

export const RELIEF_FLOOR = 100;
export const RELIEF_COOLDOWN = 20;

/** 港务官救济：在港里身无分文、货舱也空时，借给你一笔本钱让你翻身（扣 1 点声望，20 天内只有一次） */
export function lifeline(s: GameState) {
  if (!s.docked || s.gold >= 50 || Object.keys(s.cargo).length > 0) return;
  if (dayNumber(s) < s.stats.reliefDay + RELIEF_COOLDOWN && s.stats.reliefDay > 0) return;
  const give = RELIEF_FLOOR - Math.floor(s.gold);
  s.gold += give;
  s.rep = Math.max(0, round2(s.rep - 1));
  s.stats.reliefDay = dayNumber(s);
  pushLog(s, `${PORT_BY_ID[s.docked].name}的港务官看你囊空如洗，借给你 ${give} 金币做本钱（声望 -1）`);
}

export function dockAt(s: GameState, portId: string) {
  s.docked = portId;
  pushLog(s, `抵达${PORT_BY_ID[portId].name}`);
  settleWages(s);
  if (condAt(s, portId, 'plague', dayNumber(s))) {
    const k = removeCrew(s, Math.ceil(totalCrew(s) * 0.08));
    if (k > 0) pushLog(s, `${PORT_BY_ID[portId].name}正闹瘟疫，${k} 名船员染病倒下了`);
  }
  latchGoals(s);
  lifeline(s);
  storyTick(s, portId);
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
  s.consorts = [];
  s.guards = Math.min(s.guards, 4);
  s.ship.crew = Math.max(s.ship.crew, type.crewMin);
  s.ship.hull = Math.max(s.ship.hull, Math.round(type.hull * 0.3));
  s.ship.food = Math.max(s.ship.food, 5);
  s.ship.water = Math.max(s.ship.water, 5);
  s.combat = null;
  s.stats.rescued += 1;
  advance(s, 4, false);
  pushLog(s, `${why}，被渔船拖到${PORT_BY_ID[site.id].name}。货物全损，付了 ${fee} 金币救助费，耽误 4 天`);
  s.docked = site.id;
}

/** 整支船队里人手不够开船的那艘（没有则 null） */
function understaffed(state: GameState) {
  return fleetShips(state).find((x) => x.crew < typeOf(x).crewMin) ?? null;
}

export function sailStep(map: SeaMap, state: GameState, dx: number, dy: number): StepResult {
  if (state.docked) return fail(state, '船还停在港里，先起航');
  if (state.combat) return fail(state, '正在交战，先解决眼前的敌人');
  if (state.scene) return fail(state, '有事情等你决定');
  const weak = understaffed(state);
  if (weak) return fail(state, `「${weak.name}」船员不足，开不动船`);
  const [x, y] = state.pos;
  if (!canStep(map, x, y, Math.sign(dx), Math.sign(dy))) return fail(state, '那边是陆地');
  const s = clone(state);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const nx = x + sx, ny = y + sy;
  const wind = windAt(s.seed, Math.floor(s.t));
  const dt = fleetStepDays(s, headingIndex(sx, sy), wind, map.tiles[idx(nx, ny)] === T_SHALLOW);
  const logBefore = s.log.length, lastBefore = s.log[s.log.length - 1];
  const foodBefore = s.ship.food, waterBefore = s.ship.water, crewBefore = totalCrew(s);
  s.pos = [nx, ny];
  advance(s, dt, true);
  let interrupt = s.log.length !== logBefore || s.log[s.log.length - 1] !== lastBefore || totalCrew(s) !== crewBefore || !!s.combat || !!s.scene;
  const why = s.ship.hull <= 0 ? '船体撑不住沉没了' : '船员折损过半无法航行';
  if (normalizeFleet(s).wiped) {
    rescue(s, map, why);
    return { state: s, ok: true, interrupt: true, reason: '被救起' };
  }
  if (s.combat) return { state: s, ok: true, interrupt: true, reason: '遭遇敌船' };
  const site = map.sites.find((p) => p.dock[0] === nx && p.dock[1] === ny);
  if (site) {
    if (isBlockaded(s, site.id, dayNumber(s))) {
      pushLog(s, `${PORT_BY_ID[site.id].name}正在封港，不许进港。过几天再来吧`);
      return { state: s, ok: true, interrupt: true, reason: '封港' };
    }
    dockAt(s, site.id);
    return { state: s, ok: true, interrupt: true, reason: '靠港' };
  }
  storyTick(s, null);
  if (s.scene) interrupt = true;
  const need = Math.max(1, Math.ceil(people(s) / 5));
  if ((foodBefore >= need * 3 && s.ship.food < need * 3) || (waterBefore >= need * 3 && s.ship.water < need * 3)) {
    pushLog(s, '补给只够 3 天了，赶紧找个港口');
    interrupt = true;
  }
  return { state: s, ok: true, interrupt };
}

// ---------------- 海战收尾与事件选择 ----------------

/** 战斗结束后「继续航行」：清掉战斗；整支船队不行了就被救走 */
export function endCombat(map: SeaMap, state: GameState): StepResult {
  if (!state.combat?.done) return fail(state, '战斗还没结束');
  const s = clone(state);
  const outcome = s.combat!.done!.outcome;
  s.combat = null;
  if (normalizeFleet(s).wiped || outcome === 'sunk') {
    rescue(s, map, s.ship.hull <= 0 ? '船队在海战中沉没' : '船队在海战中折损殆尽');
    return { state: s, ok: true, interrupt: true, reason: '被救起' };
  }
  latchGoals(s);
  storyTick(s, null);
  return { state: s, ok: true, interrupt: true };
}

/** 开战（供事件和测试使用） */
export function beginBattle(state: GameState, foeId: string): GameState {
  const s = clone(state);
  startCombat(s, foeId);
  return s;
}

/** 顺风漂移 n 格，遇到陆地即止 */
export function drift(map: SeaMap, s: GameState, n: number) {
  const to = (windAt(s.seed, Math.floor(s.t)).from + 4) % 8;
  const [dx, dy] = DIRS[to];
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = s.pos;
    if (!canStep(map, x, y, dx, dy)) break;
    s.pos = [x + dx, y + dy];
    moved += 1;
  }
  return moved;
}

/** 在弹出的场景里选第 i 项；主线剧情的场景只是「记下了」 */
export function chooseScene(map: SeaMap, state: GameState, i: number): StepResult {
  const sc = state.scene;
  if (!sc) return fail(state, '现在没有需要决定的事');
  const s = clone(state);
  s.scene = null;
  if (sc.id.startsWith('story')) return { state: s, ok: true, interrupt: true };
  const def = SEA_EVENT_BY_ID[sc.id];
  const choice = def?.choices[i];
  if (!choice) return fail(state, '没有这个选项');
  if (choice.needGold && s.gold < choice.needGold) return fail(state, `需要 ${choice.needGold} 金币`);
  const post = applyEffects(s, choice.effects, `${sc.id}.${dayNumber(s)}`);
  if (post.drift) drift(map, s, post.drift);
  if (post.days) advance(s, post.days, true, true);
  if (post.combat) startCombat(s, post.combat);
  if (normalizeFleet(s).wiped) {
    rescue(s, map, '船队在事故中丧失了航行能力');
    return { state: s, ok: true, interrupt: true, reason: '被救起' };
  }
  return { state: s, ok: true, interrupt: true };
}

/** 在港里停一天：等行情恢复，工资照付 */
export function waitDay(state: GameState): StepResult {
  if (!state.docked) return fail(state, '海上不能原地休整');
  const s = clone(state);
  advance(s, 1, false);
  settleWages(s);
  latchGoals(s);
  lifeline(s);
  storyTick(s, s.docked);
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
  if (state.combat || state.scene) return fail(state, '先处理眼前的事');
  if (isBlockaded(state, site.id, dayNumber(state))) return fail(state, `${PORT_BY_ID[site.id].name}正在封港，不许进港`);
  const s = clone(state);
  dockAt(s, site.id);
  return { state: s, ok: true, interrupt: true };
}

