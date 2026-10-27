// 海战：回合制。距离（1 贴舷～4 远）、上风位置、炮击、接舷、撤退、交买路钱。
// 全部是纯函数：combatAct 返回新状态；随机数由 combat.seq 驱动，存档读回来结果不变。
import { FOES, FOE_BY_ID, type FoeDef } from './foes';
import { cargoValue, dangerAt, fleetGuns, fleetPace, meleePower, normalizeFleet, removeCrew } from './fleet';
import { clamp, hash32, rand01, round2 } from './rng';
import { windAt } from './sailing';
import { cargoFree, clone, dayNumber, fleetShips, pushLog, totalCrew, type Combat, type Foe, type GameState } from './state';
import { GOODS, GOOD_BY_ID, SHIP_BY_ID } from './world';

export type CombatAction = 'fire' | 'close' | 'open' | 'gauge' | 'board' | 'flee' | 'pay';
export const ACTION_NAMES: Record<CombatAction, string> = { fire: '炮击', close: '逼近', open: '拉开', gauge: '抢上风', board: '接舷', flee: '撤退', pay: '交买路钱' };
export const DIST_NAMES = ['', '贴舷', '近', '中', '远'];

export const ACC: Record<number, number> = { 1: 0.78, 2: 0.62, 3: 0.45, 4: 0 };
export const HIT_DMG = 4;
export const ROUND_CAP = 25;
export const GRACE_DAYS = 12;
export const ENCOUNTER_BASE = 0.03;

const draw = (c: Combat, tag: string) => rand01(c.rseed, tag, c.seq++);

// ---------------- 开战 ----------------

/** 当前的威胁等级 1～5：随时间、船队规模与船型上升 */
export function threatLevel(s: GameState): number {
  const tier = Math.max(...fleetShips(s).map((x) => (x.type === 'lark' ? 1 : x.type === 'swallow' ? 2 : x.type === 'hawk' ? 3 : 3)));
  return clamp(1 + Math.floor(dayNumber(s) / 90) + (s.consorts.length >= 1 ? 1 : 0) + (tier >= 3 ? 1 : 0), 1, 5);
}

export function pickFoeDef(s: GameState, day: number): FoeDef {
  const lvl = threatLevel(s);
  const pool = FOES.filter((f) => lvl >= f.levels[0] && lvl <= f.levels[1]);
  const total = pool.reduce((a, f) => a + f.weight, 0);
  let r = rand01(s.seed, 'foe', day) * total;
  for (const f of pool) { r -= f.weight; if (r < 0) return f; }
  return pool[0];
}

export function makeFoe(def: FoeDef, rv: number): Foe {
  const k = 0.92 + rv * 0.16;
  return { def: def.id, name: def.name, hull: Math.round(def.hull * k), hullMax: Math.round(def.hull * k), crew: def.crew, crewMax: def.crew, guns: def.guns };
}

/** 在状态上开一场海战（直接修改传入的状态） */
export function startCombat(s: GameState, defId: string, day = dayNumber(s)): void {
  const def = FOE_BY_ID[defId];
  const rseed = hash32(s.seed, 'cb', day);
  const foe = makeFoe(def, rand01(rseed, 'k'));
  s.combat = {
    foe, dist: rand01(rseed, 'd') < 0.5 ? 3 : 4, gauge: rand01(rseed, 'g') < 0.5, round: 0, seq: 0, rseed,
    log: [`海平线上出现了${def.faction}的「${foe.name}」！${def.blurb}。`], done: null,
  };
  pushLog(s, `遭遇${def.faction}的「${foe.name}」`);
}

/** 每天结算：这一天海上有没有撞上敌船 */
export function encounterChance(s: GameState): number {
  const danger = dangerAt(s.pos);
  const cv = clamp(cargoValue(s) / 3000, 0, 1);
  const deter = clamp(0.04 * fleetGuns(s) + 0.02 * s.guards, 0, 0.4);
  return ENCOUNTER_BASE * danger * (0.5 + cv) * (1 - deter);
}

export function maybeEncounter(s: GameState, day: number): boolean {
  if (s.combat || s.scene || day < GRACE_DAYS) return false;
  if (rand01(s.seed, 'enc', day) >= encounterChance(s)) return false;
  startCombat(s, pickFoeDef(s, day).id, day);
  return true;
}

// ---------------- 选项 ----------------

export const ransomPrice = (s: GameState): number => Math.max(40, Math.round(s.gold * 0.1 + cargoValue(s) * 0.1));

export interface Option { action: CombatAction; label: string; enabled: boolean; why?: string; hint: string }

export function combatOptions(s: GameState): Option[] {
  const c = s.combat;
  if (!c || c.done) return [];
  const def = FOE_BY_ID[c.foe.def];
  const shots = fleetGuns(s);
  const price = ransomPrice(s);
  const o = (action: CombatAction, enabled: boolean, why: string | undefined, hint: string): Option => ({ action, label: ACTION_NAMES[action], enabled, why: enabled ? undefined : why, hint });
  return [
    o('fire', c.dist <= 3 && shots > 0, shots < 1 ? '没有能开火的炮（炮需要每 2 名船员操作 1 门）' : '距离太远', `全船队 ${shots} 门炮齐射，距离越近越准`),
    o('close', c.dist > 1, '已经贴舷', '拉近一格距离，追不追得上看航速'),
    o('open', c.dist < 4, '已经最远', '拉开一格距离'),
    o('gauge', !c.gauge, '已占上风', '抢占上风：命中更高、撤退更易'),
    o('board', c.dist === 1, '要先贴舷才能接舷', `登船肉搏：我方战力 ${meleePower(s).toFixed(0)}，敌方约 ${Math.round(c.foe.crew * def.melee)}`),
    o('flee', true, undefined, '尝试摆脱：越远、占上风、航速越快越容易，失败会挨一轮打'),
    o('pay', def.kind === 'pirate' && s.gold >= price, def.kind !== 'pirate' ? '敌对势力不收买路钱' : '金币不够', `${price} 金币买路，破财免灾`),
  ];
}

// ---------------- 结算工具 ----------------

function windPenalty(s: GameState) { return windAt(s.seed, Math.floor(s.t)).strength === 3 ? 0.9 : 1; }

function say(c: Combat, text: string) { c.log.push(text); if (c.log.length > 30) c.log.splice(0, c.log.length - 30); }

/** 我方炮击 */
function playerFire(s: GameState, c: Combat) {
  const acc = clamp((ACC[c.dist] + (c.gauge ? 0.08 : -0.04)) * windPenalty(s), 0, 0.95);
  const shots = fleetGuns(s);
  let hits = 0, dmg = 0, kills = 0;
  for (let i = 0; i < shots; i++) {
    if (draw(c, 'pf') < acc) {
      hits += 1;
      dmg += HIT_DMG + Math.floor(draw(c, 'pd') * 3);
      if (draw(c, 'pk') < 0.2) kills += 1;
    }
  }
  c.foe.hull = Math.max(0, c.foe.hull - dmg);
  c.foe.crew = Math.max(1, c.foe.crew - kills);
  say(c, hits ? `我方 ${shots} 门炮齐射，命中 ${hits} 发，敌船船体 -${dmg}${kills ? `，击倒 ${kills} 人` : ''}` : `我方 ${shots} 门炮齐射，全部落空`);
}

/** 敌方炮击：每一发随机落在某一艘我方船上 */
function foeFire(s: GameState, c: Combat) {
  const shots = Math.min(c.foe.guns, Math.floor(c.foe.crew / 2));
  if (shots < 1 || c.dist > 3) return;
  const acc = clamp((ACC[c.dist] + (c.gauge ? -0.04 : 0.08)) * windPenalty(s), 0, 0.95);
  const ships = fleetShips(s);
  let hits = 0, dmg = 0, kills = 0;
  for (let i = 0; i < shots; i++) {
    if (draw(c, 'ff') >= acc) continue;
    const tgt = ships[Math.floor(draw(c, 'ft') * ships.length)];
    const d = Math.max(1, Math.round((HIT_DMG + Math.floor(draw(c, 'fd') * 3)) * (1 - 0.15 * tgt.armor)));
    tgt.hull = Math.max(0, round2(tgt.hull - d));
    hits += 1; dmg += d;
    if (draw(c, 'fk') < 0.2 && tgt.crew > 1) { tgt.crew -= 1; kills += 1; }
  }
  say(c, hits ? `敌船 ${shots} 门炮开火，命中 ${hits} 发，我方船体共 -${dmg}${kills ? `，${kills} 名船员倒下` : ''}` : `敌船 ${shots} 门炮开火，打空了`);
}

function tryMove(s: GameState, c: Combat, dir: -1 | 1, mine: boolean) {
  const def = FOE_BY_ID[c.foe.def];
  const diff = mine ? fleetPace(s) - def.speed : def.speed - fleetPace(s);
  const p = clamp(0.6 + 0.4 * diff + (mine && c.gauge ? 0.08 : 0) + (!mine && !c.gauge ? 0.08 : 0), 0.2, 0.95);
  if (draw(c, 'mv') < p) {
    c.dist = clamp(c.dist + dir, 1, 4) as Combat['dist'];
    return true;
  }
  return false;
}

interface Melee { pRemain: number; eRemain: number }
function melee(s: GameState, c: Combat, defenderIsMe: boolean): Melee {
  const def = FOE_BY_ID[c.foe.def];
  const P0 = meleePower(s) * (defenderIsMe ? 1.1 : 1);
  const E0 = c.foe.crew * def.melee * (defenderIsMe ? 1 : 1.1);
  let P = P0, E = E0;
  for (let i = 0; i < 4 && P > 0.3 * P0 && E > 0.3 * E0; i++) {
    const rp = 0.85 + 0.3 * draw(c, 'm1'), re = 0.85 + 0.3 * draw(c, 'm2');
    const lp = 0.22 * E * re, le = 0.22 * P * rp;
    P -= lp; E -= le;
  }
  return { pRemain: clamp(P / P0, 0, 1), eRemain: clamp(E / E0, 0, 1) };
}

function applyMeleeLosses(s: GameState, c: Combat, m: Melee) {
  const myLoss = Math.floor(totalCrew(s) * (1 - m.pRemain) * 0.7);
  const guardLoss = Math.floor(s.guards * (1 - m.pRemain) * 0.7);
  const lostCrew = removeCrew(s, myLoss);
  s.guards -= guardLoss;
  const foeLoss = Math.floor(c.foe.crew * (1 - m.eRemain) * 0.8);
  c.foe.crew = Math.max(1, c.foe.crew - foeLoss);
  say(c, `肉搏结束：我方损失 ${lostCrew} 名船员${guardLoss ? `、${guardLoss} 名护卫` : ''}，敌方倒下 ${foeLoss} 人`);
}

function lootOf(s: GameState, c: Combat, full: boolean): { gold: number; text: string } {
  const def = FOE_BY_ID[c.foe.def];
  const rg = draw(c, 'lg');
  let gold = Math.round(def.gold[0] + (def.gold[1] - def.gold[0]) * rg);
  if (!full) gold = Math.round(gold * 0.3);
  s.gold += gold;
  const parts = [`${gold} 金币`];
  if (full) {
    const n = Math.round(def.goods[0] + (def.goods[1] - def.goods[0]) * draw(c, 'ln'));
    const good = GOODS[Math.floor(draw(c, 'lt') * GOODS.length)];
    const room = Math.floor(cargoFree(s) / good.size);
    const q = Math.min(n, room);
    if (q > 0) {
      const old = s.cargo[good.id] ?? { qty: 0, cost: 0 };
      const cost = Math.round(good.base * 0.5);
      s.cargo[good.id] = { qty: old.qty + q, cost: round2((old.qty * old.cost + q * cost) / (old.qty + q)) };
      parts.push(`${q} 件${GOOD_BY_ID[good.id].name}`);
    }
    if (draw(c, 'lc') < 0.3) {
      const slot = fleetShips(s).find((x) => x.guns < slotsOf(x.type));
      if (slot) { slot.guns += 1; parts.push('1 门完好的火炮（已装上船）'); }
    }
  }
  return { gold, text: parts.join('、') };
}
const slotsOf = (type: string) => SHIP_BY_ID[type].gunSlots;

function finish(s: GameState, c: Combat, outcome: NonNullable<Combat['done']>['outcome'], text: string, gold = 0) {
  c.done = { outcome, text, gold };
  say(c, text);
  pushLog(s, text);
  if (outcome === 'won-sunk' || outcome === 'won-boarded' || outcome === 'foe-fled') s.stats.battlesWon += 1;
  else if (outcome === 'lost-boarded' || outcome === 'sunk') s.stats.battlesLost += 1;
  else if (outcome === 'fled') s.stats.fled += 1;
  else if (outcome === 'paid') s.stats.paid += 1;
}

// ---------------- 敌方行动 ----------------

function foeTurn(s: GameState, c: Combat) {
  const def = FOE_BY_ID[c.foe.def];
  const weak = c.foe.hull < 0.3 * c.foe.hullMax || c.foe.crew < 0.3 * c.foe.crewMax;
  if (weak && draw(c, 'fl') < 0.5) {
    const loot = lootOf(s, c, false);
    finish(s, c, 'foe-fled', `敌船「${c.foe.name}」扯起帆逃走了，落下的箱子里有 ${loot.text}`, loot.gold);
    s.rep = round2(s.rep + 0.5);
    return;
  }
  if (def.style === 'boarder') {
    if (c.dist > 1) { say(c, tryMove(s, c, -1, false) ? '敌船全速逼近' : '敌船想靠近，没追上'); foeFire(s, c); return; }
    say(c, '敌船放出钩索，开始接舷！');
    resolveBoarding(s, c, true);
    return;
  }
  // 炮艇：保持中近距离炮击
  if (c.dist <= 1) { say(c, tryMove(s, c, 1, false) ? '敌船拉开了距离' : '敌船想拉开距离，没成功'); }
  else if (c.dist >= 4) { say(c, tryMove(s, c, -1, false) ? '敌船逼近到射程内' : '敌船在远处徘徊'); }
  foeFire(s, c);
  if (c.gauge && draw(c, 'gg') < 0.25) { c.gauge = false; say(c, '敌船抢到了上风'); }
}

function resolveBoarding(s: GameState, c: Combat, foeBoards: boolean) {
  const m = melee(s, c, foeBoards);
  applyMeleeLosses(s, c, m);
  const iWin = m.pRemain > m.eRemain || (m.pRemain === m.eRemain && foeBoards);
  if (iWin) {
    const loot = lootOf(s, c, true);
    s.rep = round2(s.rep + 1);
    finish(s, c, 'won-boarded', `夺下了「${c.foe.name}」，缴获 ${loot.text}`, loot.gold);
  } else {
    const lostCargo: string[] = [];
    for (const id of Object.keys(s.cargo)) {
      const take = Math.ceil(s.cargo[id].qty * 0.6);
      s.cargo[id].qty -= take;
      lostCargo.push(`${take} 件${GOOD_BY_ID[id].name}`);
      if (s.cargo[id].qty <= 0) delete s.cargo[id];
    }
    const gold = Math.round(s.gold * 0.15);
    s.gold -= gold;
    const f = s.ship;
    f.hull = Math.max(1, round2(f.hull - Math.round(SHIP_BY_ID[f.type].hull * 0.2)));
    finish(s, c, 'lost-boarded', `接舷战失败：被抢走 ${gold} 金币${lostCargo.length ? '和' + lostCargo.join('、') : ''}，旗舰也受了伤`, -gold);
  }
}

// ---------------- 玩家行动 ----------------

export interface ActResult { state: GameState; ok: boolean; msg: string }

export function combatAct(state: GameState, action: CombatAction): ActResult {
  const c0 = state.combat;
  if (!c0 || c0.done) return { state, ok: false, msg: '现在没有战斗' };
  const opt = combatOptions(state).find((o) => o.action === action);
  if (!opt?.enabled) return { state, ok: false, msg: opt?.why ?? '不能这样做' };
  const s = clone(state);
  const c = s.combat!;
  c.round += 1;
  const def = FOE_BY_ID[c.foe.def];
  switch (action) {
    case 'fire': playerFire(s, c); break;
    case 'close': say(c, tryMove(s, c, -1, true) ? '我方逼近了一格' : '想逼近，没追上'); break;
    case 'open': say(c, tryMove(s, c, 1, true) ? '我方拉开了一格' : '想拉开，没甩开'); break;
    case 'gauge': {
      const p = clamp(0.5 + 0.3 * (fleetPace(s) - def.speed), 0.2, 0.9);
      if (draw(c, 'gm') < p) { c.gauge = true; say(c, '抢到了上风位置'); } else say(c, '抢风失败');
      break;
    }
    case 'board': resolveBoarding(s, c, false); break;
    case 'flee': {
      const p = clamp(0.35 + 0.4 * (fleetPace(s) - def.speed) + (c.dist - 1) * 0.12 + (c.gauge ? 0.1 : 0), 0.1, 0.9);
      if (draw(c, 'fe') < p) { finish(s, c, 'fled', '趁机转向脱离了战斗'); }
      else say(c, '撤退失败，被咬住了');
      break;
    }
    case 'pay': {
      const price = ransomPrice(s);
      s.gold -= price;
      finish(s, c, 'paid', `交了 ${price} 金币买路钱，「${c.foe.name}」放你们过去`, -price);
      break;
    }
  }
  if (!c.done && c.foe.hull <= 0) {
    const loot = lootOf(s, c, false);
    s.rep = round2(s.rep + 0.7);
    finish(s, c, 'won-sunk', `击沉了「${c.foe.name}」，从漂浮的残骸里捞到 ${loot.text}`, loot.gold);
  }
  if (!c.done) foeTurn(s, c);
  // 伤亡处理：沉没、脱队
  if (!c.done || c.done.outcome !== 'paid') {
    const n = normalizeFleet(s);
    if (n.wiped && !c.done) finish(s, c, 'sunk', '船队沉的沉、倒的倒，再也撑不住了……');
  }
  if (!c.done && c.round >= ROUND_CAP) finish(s, c, 'standoff', `缠斗太久，「${c.foe.name}」撤走了`);
  return { state: s, ok: true, msg: c.log[c.log.length - 1] };
}
