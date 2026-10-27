// 自动跑单与平衡测算：一个按「利润 / 天数」挑航线的机器人船长，纯函数，不碰界面。
// 用来在测试里跑满一年，检查第一季度目标可达、海战不会让新手开局必死。
import { findRoute, type SeaMap } from './mapgen';
import { quoteBuy, quoteSell } from './pricing';
import { combatAct, ransomPrice, type CombatAction } from './combat';
import { FOE_BY_ID } from './foes';
import { fleetGuns, meleePower } from './fleet';
import {
  REL_MIN, cargoFree, dayNumber, fleetShips, people, typeOf, totalCrew, fleetCrewMax, type GameState,
} from './state';
import { buyGood, buyGun, buyShip, buySupply, buyPriceOf, hireGuards, recruit, repairNeed, repairShip, sellGood, sellPriceOf, canBuildHere, tradeInValue } from './trade';
import { chooseScene, endCombat, newGame, sailStep, tryDock, undock, waitDay } from './turn';
import { SEA_EVENT_BY_ID, isBlockaded } from './events';
import { GOODS, PORTS, SHIPS, type GoodId } from './world';

export interface SimOptions {
  seed: number;
  /** 模拟多少天 */
  days: number;
  /** 钱够了就把炮买到这个数（每艘船） */
  guns?: number;
  /** 钱够了就雇到这个数的护卫 */
  guards?: number;
  /** 钱够了就升级到更大的船 */
  upgrade?: boolean;
  /** 遇敌时遇强敌不肯逃：true = 总是迎战（最坏情形） */
  alwaysFight?: boolean;
  /** 遇敌时从不交买路钱也不撤退 */
  noRetreat?: boolean;
}

export interface QuarterRecord { index: number; won: number; total: number; goldAtEnd: number }
export interface SimResult {
  state: GameState;
  days: number;
  gold: number;
  rep: number;
  quarters: QuarterRecord[];
  battles: { won: number; lost: number; fled: number; paid: number; total: number };
  rescued: number;
  minGold: number;
  trips: number;
  stuck: boolean;
}

// ---------------- 机器人的决定 ----------------

/** 随机事件：选第一个付得起的项（数据表里第一项都是稳妥的） */
export function botChoice(s: GameState): number {
  const sc = s.scene;
  if (!sc) return 0;
  const def = SEA_EVENT_BY_ID[sc.id];
  if (!def) return 0;
  const i = def.choices.findIndex((c) => !c.needGold || s.gold >= c.needGold);
  return i < 0 ? def.choices.length - 1 : i;
}

const foePower = (s: GameState) => {
  const c = s.combat!;
  const def = FOE_BY_ID[c.foe.def];
  return c.foe.hull * 0.3 + Math.min(c.foe.guns, Math.floor(c.foe.crew / 2)) * 8 + c.foe.crew * def.melee * 1.5;
};
const myPower = (s: GameState) => fleetShips(s).reduce((a, x) => a + x.hull * 0.3, 0) + fleetGuns(s) * 8 + meleePower(s) * 1.5;

export function botCombat(s: GameState, opt: { alwaysFight?: boolean; noRetreat?: boolean }, tries: { flee: number }): CombatAction {
  const c = s.combat!;
  const def = FOE_BY_ID[c.foe.def];
  const ratio = myPower(s) / foePower(s);
  const melee0 = meleePower(s) / Math.max(1, c.foe.crew * def.melee);
  // 一心接舷的敌人：我方肉搏没有明显优势就不硬拼
  const strong = (ratio >= 1.2 && (def.style !== 'boarder' || melee0 >= 1.5 || fleetGuns(s) >= 3)) || opt.alwaysFight;
  if (!strong && !opt.noRetreat) {
    if (def.kind === 'pirate' && s.gold >= ransomPrice(s) && ransomPrice(s) <= s.gold * 0.5) return 'pay';
    if (tries.flee < 4) { tries.flee += 1; return 'flee'; }
  }
  const melee = meleePower(s) / Math.max(1, c.foe.crew * def.melee);
  if (c.dist === 1 && melee >= 1.5) return 'board';
  if (fleetGuns(s) > 0 && c.dist <= 3 && !(melee >= 1.8 && c.dist > 1)) return 'fire';
  if (c.dist > 1) return 'close';
  return fleetGuns(s) > 0 ? 'fire' : 'board';
}

/** 一路处理到没有待决事项：选择场景、打完海战、收尾 */
export function clearInterrupts(map: SeaMap, state: GameState, opt: { alwaysFight?: boolean; noRetreat?: boolean } = {}): GameState {
  let s = state;
  const tries = { flee: 0 };
  for (let guard = 0; guard < 400 && (s.scene || s.combat); guard++) {
    if (s.scene) { const r = chooseScene(map, s, botChoice(s)); s = r.state; continue; }
    if (s.combat!.done) { s = endCombat(map, s).state; continue; }
    const a = botCombat(s, opt, tries);
    const r = combatAct(s, a);
    s = r.ok ? r.state : combatAct(s, fleetGuns(s) > 0 && s.combat!.dist <= 3 ? 'fire' : s.combat!.dist > 1 ? 'close' : 'board').state;
  }
  return s;
}

// ---------------- 贸易规划 ----------------

interface Plan { dest: string; loads: [GoodId, number][]; profit: number; days: number; score: number }

function plan(map: SeaMap, s: GameState, from: string, avoid: Set<string>): Plan | null {
  const here = s.docked ?? from;
  const dock = map.sites.find((x) => x.id === here)!.dock;
  let best: Plan | null = null;
  const speed = typeOf(s.ship).speed * 0.78;
  for (const p of PORTS) {
    if (p.id === here || avoid.has(p.id) || isBlockaded(s, p.id, dayNumber(s))) continue;
    const dd = map.sites.find((x) => x.id === p.id)!.dock;
    const route = findRoute(map, dock, dd);
    if (!route) continue;
    const days = route.length / speed;
    let space = cargoFree(s), gold = s.gold - 60;
    const cands = GOODS.map((g) => ({ g, m: sellPriceOf(s, p.id, g.id) - buyPriceOf(s, here, g.id) }))
      .filter((x) => x.m > 0).sort((a, b) => b.m / b.g.size - a.m / a.g.size);
    const loads: [GoodId, number][] = [];
    let profit = 0;
    for (const { g } of cands) {
      const n = Math.min(Math.floor(space / g.size), Math.floor(gold / buyPriceOf(s, here, g.id)), Math.floor(s.stock[here][g.id] * 0.35));
      if (n < 1) continue;
      const buy = quoteBuy(here, g.id, s.stock[here][g.id], n);
      const sell = quoteSell(p.id, g.id, s.stock[p.id][g.id], n);
      const pr = sell.total - buy.total;
      if (pr <= 0) continue;
      loads.push([g.id, n]); profit += pr; space -= n * g.size; gold -= buy.total;
    }
    const cost = days * (totalCrew(s) * 0.5 + s.guards + 3 * Math.ceil(people(s) / 5) * 2.5);
    const net = profit - cost;
    let score = net / (days + 1);
    if ((s.relations[p.id] ?? 0) < REL_MIN) score *= 1.2;
    if (!best || score > best.score) best = { dest: p.id, loads, profit: net, days, score };
  }
  return best;
}

// ---------------- 主循环 ----------------

export function simulate(map: SeaMap, opt: SimOptions): SimResult {
  let s = newGame(map, opt.seed, '机器人船长');
  const quarters: QuarterRecord[] = [];
  let lastQ = 0, lastWon = 0, lastMissed = 0, minGold = s.gold, trips = 0, stuck = false;
  const noteQuarter = () => {
    while (s.quest.index > lastQ) {
      const won = s.stats.questsWon - lastWon, missed = s.stats.questsMissed - lastMissed;
      quarters.push({ index: lastQ, won, total: won + missed, goldAtEnd: Math.round(s.gold) });
      lastQ += 1; lastWon = s.stats.questsWon; lastMissed = s.stats.questsMissed;
    }
    minGold = Math.min(minGold, s.gold);
  };
  const avoid = new Set<string>();

  for (let iter = 0; iter < 400 && s.t < opt.days; iter++) {
    s = clearInterrupts(map, s, opt);
    noteQuarter();
    if (!s.docked) {
      // 海上漂着（被封港挡在外面等）：原地选最近的未封港口
      const near = PORTS.filter((p) => !isBlockaded(s, p.id, dayNumber(s)))
        .map((p) => ({ p, d: findRoute(map, s.pos, map.sites.find((x) => x.id === p.id)!.dock)?.length ?? 999 }))
        .sort((a, b) => a.d - b.d)[0];
      if (!near) { stuck = true; break; }
      s = sailRoute(map, s, near.p.id, opt, avoid, () => { trips += 1; });
      noteQuarter();
      continue;
    }
    // —— 在港里 ——
    for (const [g] of Object.entries(s.cargo)) s = sellGood(s, g as GoodId, 9999).state;
    if (repairNeed(s).points > 0 && repairNeed(s).points >= 0.15 * fleetShips(s).reduce((a, x) => a + typeOf(x).hull, 0)) s = repairShip(s, 9999).state;
    // 补齐船员（至少 70%）
    const wantCrew = Math.ceil(fleetCrewMax(s) * 0.7);
    if (totalCrew(s) < wantCrew && s.gold > 150) s = recruit(s, wantCrew - totalCrew(s), 0).state;
    // 装备
    if (opt.upgrade) s = maybeUpgrade(s);
    if (s.gold > 500 && opt.guns) {
      for (let guard = 0; guard < 8 && s.ship.guns < Math.min(opt.guns, typeOf(s.ship).gunSlots) && s.gold > 400; guard++) s = buyGun(s, 0).state;
    }
    if (s.gold > 500 && opt.guards && s.guards < opt.guards) s = hireGuards(s, opt.guards - s.guards).state;

    const p = plan(map, s, s.docked as string, avoid);
    if (!p || p.profit < 5) {
      s = waitDay(s).state;
      noteQuarter();
      if (iter % 7 === 6) avoid.clear();
      continue;
    }
    // 补给：够用到目的地再多 8 天
    const need = Math.ceil(people(s) / 5);
    const wantDays = Math.ceil(p.days) + 8;
    const topUp = (kind: 'food' | 'water') => {
      const have = s.ship[kind];
      if (have < need * wantDays) s = buySupply(s, kind, need * wantDays - have).state;
    };
    topUp('food'); topUp('water');
    for (const [g, n] of p.loads) s = buyGood(s, g, n).state;
    s = undock(s).state;
    s = sailRoute(map, s, p.dest, opt, avoid, () => { trips += 1; });
    noteQuarter();
    if (s.docked === p.dest) avoid.clear();
  }
  noteQuarter();
  const b = s.stats;
  return {
    state: s, days: Math.floor(s.t), gold: Math.round(s.gold), rep: Math.round(s.rep * 10) / 10, quarters,
    battles: { won: b.battlesWon, lost: b.battlesLost, fled: b.fled, paid: b.paid, total: b.battlesWon + b.battlesLost + b.fled + b.paid },
    rescued: b.rescued, minGold: Math.round(minGold), trips, stuck,
  };
}

function maybeUpgrade(s: GameState): GameState {
  const cur = typeOf(s.ship).tier;
  const next = SHIPS.filter((t) => t.tier === cur + 1 && t.id !== 'hawk')[0];
  if (!next || canBuildHere(s, next.id)) return s;
  if (s.gold < next.price - tradeInValue(s) + 4000) return s;
  const r = buyShip(s, next.id);
  return r.ok ? r.state : s;
}

/** 航行到目的港。途中遇到的事件和海战按机器人策略处理。 */
function sailRoute(map: SeaMap, state: GameState, dest: string, opt: SimOptions, avoid: Set<string>, onTrip: () => void): GameState {
  let s = state;
  const dd = map.sites.find((x) => x.id === dest)!.dock;
  for (let guard = 0; guard < 3000; guard++) {
    s = clearInterrupts(map, s, opt);
    if (s.docked) return s;
    if (s.pos[0] === dd[0] && s.pos[1] === dd[1]) {
      const r = tryDock(map, s);
      if (r.ok) { onTrip(); return r.state; }
      avoid.add(dest);
      return s;
    }
    const route = findRoute(map, s.pos, dd);
    if (!route || !route.length) return s;
    const [x, y] = route[0];
    const r = sailStep(map, s, x - s.pos[0], y - s.pos[1]);
    if (!r.ok) return r.state;
    s = r.state;
    if (r.reason === '封港') { avoid.add(dest); return s; }
    if (r.reason === '靠港') { onTrip(); return s; }
  }
  return s;
}
