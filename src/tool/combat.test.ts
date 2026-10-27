import { describe, expect, it } from 'vitest';
import { generateMap } from './mapgen';
import { ACC, GRACE_DAYS, ROUND_CAP, combatAct, combatOptions, encounterChance, maybeEncounter, pickFoeDef, ransomPrice, startCombat, threatLevel } from './combat';
import { FOES, FOE_BY_ID } from './foes';
import { clone, newGame, beginBattle, endCombat, sailStep, tryDock, undock } from './turn';
import { buyConsort } from './trade';
import { parseSave, serializeSave } from './save';
import { fleetGuns } from './fleet';
import type { GameState } from './state';

const map = generateMap();
/** 在海上的新船长，旗舰 2 门炮 6 名船员 */
const sea = (seed = 1): GameState => undock(newGame(map, seed, '测试')).state;
const duel = (foe: string, seed = 1, tweak?: (s: GameState) => void): GameState => {
  const s = beginBattle(sea(seed), foe);
  tweak?.(s);
  return s;
};
const act = (s: GameState, a: Parameters<typeof combatAct>[1]) => {
  const r = combatAct(s, a);
  expect(r.ok).toBe(true);
  return r.state;
};

describe('敌船数据', () => {
  it('每种敌船的数值都合理，区间不倒置', () => {
    for (const f of FOES) {
      expect(f.hull).toBeGreaterThan(0);
      expect(f.crew).toBeGreaterThan(0);
      expect(f.levels[0]).toBeLessThanOrEqual(f.levels[1]);
      expect(f.gold[0]).toBeLessThanOrEqual(f.gold[1]);
      expect(f.goods[0]).toBeLessThanOrEqual(f.goods[1]);
      expect(['pirate', 'hostile']).toContain(f.kind);
    }
  });
  it('编号唯一，既有海盗也有敌对势力的船', () => {
    expect(new Set(FOES.map((f) => f.id)).size).toBe(FOES.length);
    expect(FOES.some((f) => f.kind === 'pirate')).toBe(true);
    expect(FOES.some((f) => f.kind === 'hostile')).toBe(true);
  });
  it('新手开局的威胁等级是 1，只会遇到浅滩贼', () => {
    const s = sea();
    expect(threatLevel(s)).toBe(1);
    for (let d = 1; d < 200; d++) expect(pickFoeDef(s, d).levels[0]).toBe(1);
  });
  it('时间推移和船队扩大会提高威胁等级', () => {
    const s = sea();
    const base = threatLevel(s);
    s.t = 200;
    expect(threatLevel(s)).toBeGreaterThan(base);
    const s2 = sea();
    s2.gold = 9000; s2.docked = 'hui';
    const r = buyConsort(s2, 'lark').state;
    expect(threatLevel(r)).toBe(2);
  });
});

describe('开战', () => {
  it('startCombat 生成敌船与初始距离', () => {
    const s = duel('crow');
    const c = s.combat!;
    expect(c.foe.name).toBe(FOE_BY_ID.crow.name);
    expect([3, 4]).toContain(c.dist);
    expect(c.done).toBeNull();
    expect(c.log.length).toBeGreaterThan(0);
    expect(c.foe.hull).toBe(c.foe.hullMax);
  });
  it('同样的状态开战结果相同', () => {
    expect(duel('tide').combat).toEqual(duel('tide').combat);
  });
  it('宽限期内不会遭遇敌船', () => {
    for (let d = 1; d < GRACE_DAYS; d++) {
      const s = sea(d);
      expect(maybeEncounter(s, d)).toBe(false);
      expect(s.combat).toBeNull();
    }
  });
  it('过了宽限期，一年海上航行总会遇到若干次', () => {
    let hits = 0;
    for (let d = GRACE_DAYS; d < 400; d++) if (maybeEncounter(sea(3), d)) hits += 1;
    expect(hits).toBeGreaterThan(3);
    expect(hits).toBeLessThan(60);
  });
  it('货越值钱越招海盗，船上炮和护卫越多越不敢来', () => {
    const plain = sea();
    const rich = sea();
    rich.cargo = { pearl: { qty: 30, cost: 120 } };
    expect(encounterChance(rich)).toBeGreaterThan(encounterChance(plain));
    const armed = clone(rich);
    armed.guards = 4;
    armed.ship.guns = 3;
    expect(encounterChance(armed)).toBeLessThan(encounterChance(rich));
  });
});

describe('行动选项', () => {
  it('远距离不能炮击和接舷，近了才行', () => {
    const s = duel('crow', 1, (x) => { x.combat!.dist = 4; });
    const o = (a: string, st = s) => combatOptions(st).find((x) => x.action === a)!;
    expect(o('fire').enabled).toBe(false);
    expect(o('board').enabled).toBe(false);
    expect(o('close').enabled).toBe(true);
    const near = duel('crow', 1, (x) => { x.combat!.dist = 2; });
    expect(o('fire', near).enabled).toBe(true);
    const touch = duel('crow', 1, (x) => { x.combat!.dist = 1; });
    expect(o('board', touch).enabled).toBe(true);
    expect(o('close', touch).enabled).toBe(false);
  });
  it('没有火炮时不能炮击，并说明原因', () => {
    const s = duel('crow', 1, (x) => { x.ship.guns = 0; x.combat!.dist = 2; });
    const f = combatOptions(s).find((x) => x.action === 'fire')!;
    expect(f.enabled).toBe(false);
    expect(f.why).toMatch(/炮/);
  });
  it('炮手不够时有效炮数减少（每 2 名船员 1 门）', () => {
    const s = duel('crow', 1, (x) => { x.ship.guns = 3; x.ship.crew = 4; });
    expect(fleetGuns(s)).toBe(2);
  });
  it('只有海盗肯收买路钱，敌对势力不收', () => {
    expect(combatOptions(duel('crow')).find((x) => x.action === 'pay')!.enabled).toBe(true);
    const h = combatOptions(duel('patrol')).find((x) => x.action === 'pay')!;
    expect(h.enabled).toBe(false);
    expect(h.why).toMatch(/敌对/);
  });
  it('金币不够时不能买路', () => {
    const s = duel('crow', 1, (x) => { x.gold = 5; });
    expect(combatOptions(s).find((o) => o.action === 'pay')!.enabled).toBe(false);
  });
  it('已占上风时不能再抢风；没有战斗时没有选项', () => {
    const s = duel('crow', 1, (x) => { x.combat!.gauge = true; });
    expect(combatOptions(s).find((o) => o.action === 'gauge')!.enabled).toBe(false);
    expect(combatOptions(sea())).toEqual([]);
  });
  it('不能做的行动会被拒绝且状态不变', () => {
    const s = duel('crow', 1, (x) => { x.combat!.dist = 4; });
    const r = combatAct(s, 'board');
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });
});

describe('炮击与移动', () => {
  it('炮击不改传入状态，回合数加一', () => {
    const s = duel('tide', 1, (x) => { x.combat!.dist = 2; });
    const before = JSON.stringify(s);
    const r = act(s, 'fire');
    expect(JSON.stringify(s)).toBe(before);
    expect(r.combat!.round).toBe(1);
  });
  it('同样的状态同样的行动，结果完全一致', () => {
    const s = duel('tide', 4, (x) => { x.combat!.dist = 2; });
    expect(act(s, 'fire')).toEqual(act(s, 'fire'));
  });
  it('贴舷炮击比远距离更准：多次齐射的伤害更大', () => {
    expect(ACC[1]).toBeGreaterThan(ACC[2]);
    expect(ACC[2]).toBeGreaterThan(ACC[3]);
    expect(ACC[4]).toBe(0);
    const total = (dist: 1 | 2 | 3) => {
      let dmg = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = duel('raven', seed, (x) => { x.combat!.dist = dist; x.ship.guns = 3; x.ship.crew = 10; x.combat!.foe.guns = 0; });
        const r = act(s, 'fire');
        dmg += s.combat!.foe.hull - r.combat!.foe.hull;
      }
      return dmg;
    };
    expect(total(1)).toBeGreaterThan(total(3));
  });
  it('多艘船一起参战：炮数是全队之和', () => {
    let s = newGame(map, 1);
    s.gold = 9000; s.rep = 5;
    s = buyConsort(s, 'lark').state;
    s = buyConsort(s, 'swallow').state;
    s.consorts[1].guns = 3; s.consorts[1].crew = 10;
    expect(fleetGuns(s)).toBe(2 + 0 + 3);
  });
  it('逼近只会拉近，不会拉远；多试几次总有成功的', () => {
    let closer = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = duel('crow', seed, (x) => { x.combat!.dist = 3; });
      const r = act(s, 'close');
      const d = r.combat!.dist;
      if (!r.combat!.done) expect(d).toBeLessThanOrEqual(4);
      if (d < 3) closer += 1;
    }
    expect(closer).toBeGreaterThan(5);
  });
  it('装甲能减少挨到的炮击伤害', () => {
    const loss = (armor: number) => {
      let l = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = duel('raven', seed, (x) => { x.combat!.dist = 2; x.combat!.gauge = false; x.ship.armor = armor; x.ship.hull = 60; });
        const r = act(s, 'gauge');
        l += s.ship.hull - (r.ship.hull);
      }
      return l;
    };
    expect(loss(2)).toBeLessThan(loss(0));
  });
});

describe('接舷', () => {
  it('护卫多、敌人少：接舷获胜，缴获金币和声望', () => {
    const s = duel('shark', 2, (x) => { x.combat!.dist = 1; x.guards = 4; x.ship.crew = 10; x.combat!.foe.crew = 2; });
    const r = act(s, 'board');
    expect(r.combat!.done!.outcome).toBe('won-boarded');
    expect(r.gold).toBeGreaterThan(s.gold);
    expect(r.rep).toBeGreaterThan(s.rep);
    expect(r.stats.battlesWon).toBe(1);
  });
  it('人手悬殊：接舷失败，被抢走货物和金币，旗舰受伤，但不会全军覆没', () => {
    const s = duel('king', 3, (x) => {
      x.combat!.dist = 1; x.ship.crew = 3; x.cargo = { fish: { qty: 20, cost: 10 } }; x.gold = 1000;
    });
    const r = act(s, 'board');
    expect(r.combat!.done!.outcome).toBe('lost-boarded');
    expect(r.cargo.fish.qty).toBeLessThan(20);
    expect(r.gold).toBe(850);
    expect(r.ship.hull).toBeLessThan(s.ship.hull);
    expect(r.ship.crew).toBeGreaterThanOrEqual(1);
    expect(r.stats.battlesLost).toBe(1);
  });
  it('缴获的货物放得进货舱，不会超载', () => {
    const s = duel('tide', 5, (x) => { x.combat!.dist = 1; x.guards = 4; x.ship.crew = 10; x.combat!.foe.crew = 1; x.cargo = { fish: { qty: 39, cost: 10 } }; });
    const r = act(s, 'board');
    const used = Object.entries(r.cargo).reduce((a, [, c]) => a + c.qty, 0);
    expect(used).toBeLessThanOrEqual(40 + 2);
  });
  it('接舷战中双方都有伤亡', () => {
    const s = duel('crow', 6, (x) => { x.combat!.dist = 1; x.ship.crew = 10; x.combat!.foe.crew = 9; });
    const r = act(s, 'board');
    expect(r.ship.crew).toBeLessThan(10);
    expect(r.combat!.foe.crew).toBeLessThan(9);
  });
});

describe('撤退、买路与结局', () => {
  it('撤退成功会结束战斗并计入撤退次数', () => {
    let fled = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = combatAct(duel('crow', seed, (x) => { x.combat!.dist = 4; x.combat!.gauge = true; }), 'flee');
      expect(r.ok).toBe(true);
      if (r.state.combat!.done?.outcome === 'fled') { fled += 1; expect(r.state.stats.fled).toBe(1); }
    }
    expect(fled).toBeGreaterThan(3);
  });
  it('撤退失败要挨打：战斗继续', () => {
    let failed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = act(duel('raven', seed, (x) => { x.combat!.dist = 1; x.combat!.gauge = false; x.ship.hull = 55; }), 'flee');
      if (!r.combat!.done) { failed += 1; expect(r.combat!.round).toBe(1); }
    }
    expect(failed).toBeGreaterThan(3);
  });
  it('交买路钱：扣钱、战斗结束，价格随身家增加', () => {
    const s = duel('crow', 1, (x) => { x.gold = 1000; });
    const price = ransomPrice(s);
    expect(price).toBeGreaterThanOrEqual(100);
    const r = act(s, 'pay');
    expect(r.gold).toBe(1000 - price);
    expect(r.combat!.done!.outcome).toBe('paid');
    expect(r.stats.paid).toBe(1);
    const rich = duel('crow', 1, (x) => { x.gold = 5000; });
    expect(ransomPrice(rich)).toBeGreaterThan(price);
  });
  it('把敌船打到残破，它会扯帆逃走，算一场胜仗', () => {
    let fledFoe = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = duel('crow', seed, (x) => { x.combat!.dist = 3; x.combat!.gauge = false; x.combat!.foe.hull = 8; x.ship.guns = 0; });
      const r = act(s, 'gauge');
      if (r.combat!.done?.outcome === 'foe-fled') { fledFoe += 1; expect(r.stats.battlesWon).toBe(1); }
    }
    expect(fledFoe).toBeGreaterThan(3);
  });
  it('打沉敌船：算胜仗，捞到一点金币', () => {
    let won = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = duel('shark', seed, (x) => { x.combat!.dist = 1; x.combat!.foe.hull = 1; x.ship.guns = 3; x.ship.crew = 10; });
      const r = act(s, 'fire');
      if (r.combat!.done?.outcome === 'won-sunk') { won += 1; expect(r.gold).toBeGreaterThan(s.gold); }
    }
    expect(won).toBeGreaterThan(15);
  });
  it('缠斗到回合上限，对方自己撤走', () => {
    const s = duel('tide', 1, (x) => { x.combat!.round = ROUND_CAP - 1; x.combat!.gauge = false; x.combat!.foe.guns = 0; x.combat!.foe.hull = 500; x.combat!.foe.hullMax = 500; });
    const r = act(s, 'gauge');
    expect(r.combat!.done!.outcome).toBe('standoff');
  });
  it('整支船队被打垮：判定沉没，继续航行时被救到港口，货物全损', () => {
    let s = duel('king', 1, (x) => {
      x.combat!.dist = 1; x.combat!.gauge = false; x.ship.hull = 2; x.ship.crew = 3; x.cargo = { fish: { qty: 10, cost: 10 } }; x.gold = 1000;
    });
    s = act(s, 'gauge');
    expect(s.combat!.done).not.toBeNull();
    const r = endCombat(map, s);
    expect(r.ok).toBe(true);
    expect(r.state.combat).toBeNull();
    expect(r.state.docked).not.toBeNull();
    expect(Object.keys(r.state.cargo)).toHaveLength(0);
    expect(r.state.stats.rescued).toBe(1);
    expect(r.state.gold).toBeLessThan(1000);
  });
});

describe('战斗中的限制与存档', () => {
  it('交战时不能航行也不能靠港', () => {
    const s = duel('crow');
    const r = sailStep(map, s, 1, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/交战/);
    expect(tryDock(map, s).ok).toBe(false);
  });
  it('战斗没结束不能收尾', () => {
    expect(endCombat(map, duel('crow')).ok).toBe(false);
  });
  it('战斗结束后收尾：清掉战斗状态', () => {
    const s = act(duel('crow', 1, (x) => { x.gold = 1000; }), 'pay');
    const r = endCombat(map, s);
    expect(r.state.combat).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('战斗中存档再读档，后续结果不变', () => {
    const s = duel('tide', 7, (x) => { x.combat!.dist = 2; });
    const mid = act(s, 'fire');
    const back = parseSave(serializeSave(mid));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state).toEqual(mid);
      expect(act(back.state, 'fire')).toEqual(act(mid, 'fire'));
    }
  });
  it('开战后日志里记着遭遇', () => {
    const s = sea(9);
    startCombat(s, 'shark');
    expect(s.combat!.log.length).toBe(1);
    expect(s.log[s.log.length - 1]).toMatch(/遭遇/);
  });
});
