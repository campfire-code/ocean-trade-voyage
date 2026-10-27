import { describe, expect, it } from 'vitest';
import { generateMap, idx, isWater } from './mapgen';
import {
  COND_MAX, COND_NAME, COND_RULES, SEA_EVENTS, SEA_EVENT_BY_ID, SEA_EVENT_CHANCE, applyEffects, condAt, condMult, isBlockaded, makeScene, maybeSpawnCond,
  rollSeaEvent, type Effect,
} from './events';
import { FOE_BY_ID } from './foes';
import { chooseScene, clone, dockAt, newGame, sailStep, tryDock, undock, waitDay } from './turn';
import { currentMid, rumorLines } from './trade';
import { dayNumber, type GameState } from './state';
import { GOOD_BY_ID } from './world';

const map = generateMap();
const sea = (seed = 1): GameState => undock(newGame(map, seed, '测试')).state;
const withScene = (id: string, seed = 1): GameState => {
  const s = sea(seed);
  s.scene = makeScene(SEA_EVENT_BY_ID[id]);
  return s;
};

const walk = (e: Effect, f: (x: Effect) => void) => {
  f(e);
  if (e.t === 'chance') [...e.yes, ...e.no].forEach((x) => walk(x, f));
};

describe('事件数据表', () => {
  it('至少 6 种海上事件，编号唯一，每个都有可选项和文字', () => {
    expect(SEA_EVENTS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SEA_EVENTS.map((e) => e.id)).size).toBe(SEA_EVENTS.length);
    for (const e of SEA_EVENTS) {
      expect(e.title.length).toBeGreaterThan(1);
      expect(e.text.length).toBeGreaterThan(10);
      expect(e.choices.length).toBeGreaterThanOrEqual(2);
      for (const c of e.choices) expect(c.effects.length).toBeGreaterThan(0);
    }
  });
  it('效果里引用的敌船、概率、商品都是有效的', () => {
    for (const e of SEA_EVENTS) for (const c of e.choices) for (const ef of c.effects) walk(ef, (x) => {
      if (x.t === 'combat') expect(FOE_BY_ID[x.foe]).toBeDefined();
      if (x.t === 'chance') { expect(x.p).toBeGreaterThan(0); expect(x.p).toBeLessThan(1); }
      if (x.t === 'goods' && x.good) expect(GOOD_BY_ID[x.good]).toBeDefined();
    });
  });
  it('既有伤船的风暴，也有会引出海战的圈套', () => {
    expect(SEA_EVENT_BY_ID['storm-drift']).toBeDefined();
    let hasCombat = false;
    for (const e of SEA_EVENTS) for (const c of e.choices) for (const ef of c.effects) walk(ef, (x) => { if (x.t === 'combat') hasCombat = true; });
    expect(hasCombat).toBe(true);
  });
  it('场景的选项文字与数据表一一对应', () => {
    for (const e of SEA_EVENTS) expect(makeScene(e).choices).toEqual(e.choices.map((c) => c.label));
  });
});

describe('随机事件触发', () => {
  it('同样的种子同一天结果相同', () => {
    for (let d = 1; d < 100; d++) expect(rollSeaEvent(sea(5), d)).toEqual(rollSeaEvent(sea(5), d));
  });
  it('触发频率接近设定值', () => {
    let n = 0;
    for (let d = 1; d <= 3000; d++) if (rollSeaEvent(sea(2), d)) n += 1;
    expect(n / 3000).toBeGreaterThan(SEA_EVENT_CHANCE * 0.5);
    expect(n / 3000).toBeLessThan(SEA_EVENT_CHANCE * 1.6);
  });
  it('已经有场景或战斗时不再触发新事件', () => {
    const s = withScene('fog');
    for (let d = 1; d < 500; d++) expect(rollSeaEvent(s, d)).toBeNull();
  });
  it('第一天不会有事件（事件有最早出现的日子）', () => {
    expect(rollSeaEvent(sea(), 1)).toBeNull();
  });
  it('一年海上航行能遇到多种不同的事件', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 720; d++) { const sc = rollSeaEvent(sea(11), d); if (sc) seen.add(sc.id); }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
  it('有场景待决时不能继续航行', () => {
    const r = sailStep(map, withScene('fog'), 1, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/决定/);
  });
});

describe('效果套用', () => {
  it('金币、声望增减，金币不会变负', () => {
    const s = sea();
    applyEffects(s, [{ t: 'gold', n: 50 }, { t: 'rep', n: 2 }], 'k');
    expect(s.gold).toBe(850);
    expect(s.rep).toBe(2);
    applyEffects(s, [{ t: 'gold', n: -99999 }], 'k');
    expect(s.gold).toBe(0);
  });
  it('船体按比例受损但不会降到 0，也不会超过上限', () => {
    const s = sea();
    applyEffects(s, [{ t: 'hullPct', n: -0.5 }], 'k');
    expect(s.ship.hull).toBe(30);
    applyEffects(s, [{ t: 'hullPct', n: -5 }], 'k');
    expect(s.ship.hull).toBeGreaterThanOrEqual(1);
    applyEffects(s, [{ t: 'hullPct', n: 5 }], 'k');
    expect(s.ship.hull).toBe(60);
  });
  it('船员增加受船型上限约束，减少最多减到每船剩 1 人', () => {
    const s = sea();
    applyEffects(s, [{ t: 'crew', n: 99 }], 'k');
    expect(s.ship.crew).toBe(10);
    applyEffects(s, [{ t: 'crew', n: -99 }], 'k');
    expect(s.ship.crew).toBe(1);
  });
  it('补给增加不会超过全队容量', () => {
    const s = sea();
    applyEffects(s, [{ t: 'food', n: 999 }, { t: 'water', n: 3 }], 'k');
    expect(s.ship.food).toBe(70);
    expect(s.ship.water).toBe(45);
  });
  it('获得货物放进货舱，成本按半价记，装不下的放弃', () => {
    const s = sea();
    applyEffects(s, [{ t: 'goods', lo: 5, hi: 5, good: 'pearl' }], 'k');
    expect(s.cargo.pearl.qty).toBe(5);
    expect(s.cargo.pearl.cost).toBe(60);
    s.cargo = { salt: { qty: 40, cost: 10 } };
    applyEffects(s, [{ t: 'goods', lo: 5, hi: 5, good: 'pearl' }], 'k');
    expect(s.cargo.pearl).toBeUndefined();
  });
  it('耗时、漂移、开战三类效果交给调用方处理', () => {
    const s = sea();
    const post = applyEffects(s, [{ t: 'days', n: 2 }, { t: 'drift', n: 4 }, { t: 'combat', foe: 'shark' }], 'k');
    expect(post).toEqual({ days: 2, drift: 4, combat: 'shark' });
  });
  it('概率分支由种子和键决定，同样的输入结果相同', () => {
    const e: Effect[] = [{ t: 'chance', p: 0.5, yes: [{ t: 'gold', n: 100 }], no: [{ t: 'gold', n: -100 }] }];
    const a = sea(), b = sea();
    applyEffects(a, e, 'same'); applyEffects(b, e, 'same');
    expect(a.gold).toBe(b.gold);
    let ups = 0;
    for (let i = 0; i < 60; i++) { const x = sea(); applyEffects(x, e, `k${i}`); if (x.gold > 800) ups += 1; }
    expect(ups).toBeGreaterThan(15);
    expect(ups).toBeLessThan(45);
  });
});

describe('选择场景', () => {
  it('没有场景时选择失败', () => {
    expect(chooseScene(map, sea(), 0).ok).toBe(false);
  });
  it('选项不存在时失败，场景保留', () => {
    const s = withScene('fog');
    const r = chooseScene(map, s, 9);
    expect(r.ok).toBe(false);
    expect(r.state.scene).not.toBeNull();
  });
  it('金币不够的选项不能选', () => {
    const s = withScene('trader');
    s.gold = 10;
    const r = chooseScene(map, s, 0);
    expect(r.ok).toBe(false);
    expect(r.reason ?? '').toBeDefined();
    expect(r.state.scene).not.toBeNull();
  });
  it('买补给：花钱、补给增加、场景清除', () => {
    const s = withScene('trader');
    s.ship.food = 10; s.ship.water = 10;
    const r = chooseScene(map, s, 0);
    expect(r.ok).toBe(true);
    expect(r.state.scene).toBeNull();
    expect(r.state.gold).toBe(770);
    expect(r.state.ship.food).toBe(18);
  });
  it('等雾散：耽搁 1 天，且耽搁期间不会再冒出新事件', () => {
    const s = withScene('fog');
    const r = chooseScene(map, s, 0);
    expect(r.state.t).toBeCloseTo(s.t + 1, 5);
    expect(r.state.scene).toBeNull();
    expect(r.state.combat).toBeNull();
  });
  it('风暴漂流：被吹到别处，仍然在水面上', () => {
    let moved = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = withScene('storm-drift', seed);
      s.pos = [30, 28];
      const r = chooseScene(map, s, 0);
      const [x, y] = r.state.pos;
      expect(isWater(map.tiles[idx(x, y)])).toBe(true);
      if (x !== 30 || y !== 28) moved += 1;
      expect(r.state.t).toBeGreaterThan(s.t + 1.9);
    }
    expect(moved).toBeGreaterThan(8);
  });
  it('求救信号的圈套会引出海战', () => {
    let fights = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = chooseScene(map, withScene('false-flare', seed), 0);
      if (r.state.combat) { fights += 1; expect(r.state.combat.foe.def).toBe('shark'); }
    }
    expect(fights).toBeGreaterThan(8);
    expect(fights).toBeLessThan(32);
  });
  it('遇难船打捞：耽搁一天，可能拿到货也可能擦伤船底', () => {
    const r = chooseScene(map, withScene('wreck', 4), 1);
    expect(r.state.t).toBeGreaterThan(0.99);
    expect(r.state.scene).toBeNull();
  });
  it('选择不改传入状态', () => {
    const s = withScene('fog');
    const before = JSON.stringify(s);
    chooseScene(map, s, 0);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('港口状态：庆典、封港、瘟疫', () => {
  const cond = (s: GameState, port: string, kind: 'festival' | 'blockade' | 'plague', until = 30) => {
    s.conds.push({ id: `${port}-${kind}`, port, kind, until, text: '测试' });
  };
  it('三种状态都有规则，名称齐全', () => {
    expect(COND_RULES.map((r) => r.kind).sort()).toEqual(['blockade', 'festival', 'plague']);
    for (const r of COND_RULES) { expect(COND_NAME[r.kind].length).toBeGreaterThan(0); expect(r.text('某港')).toContain('某港'); }
  });
  it('庆典让奢侈品涨价，瘟疫让粮食涨价，过期失效', () => {
    const s = newGame(map, 1);
    const base = currentMid(s, 'hui', 'pearl');
    cond(s, 'hui', 'festival');
    expect(currentMid(s, 'hui', 'pearl')).toBeGreaterThan(base * 1.2);
    expect(condMult(s.conds, 'hui', 'pearl', 99)).toBe(1);
    expect(condMult(s.conds, 'wu', 'pearl', 1)).toBe(1);
    const p = newGame(map, 1);
    const rice = currentMid(p, 'hui', 'rice');
    cond(p, 'hui', 'plague');
    expect(currentMid(p, 'hui', 'rice')).toBeGreaterThan(rice * 1.3);
    expect(condMult(p.conds, 'hui', 'pearl', 1)).toBeCloseTo(1.1, 5);
  });
  it('封港：开到港口不让进，停在码头外，手动靠港也被拒', () => {
    const s = sea();
    const site = map.sites.find((x) => x.id === 'wu')!;
    s.pos = [site.dock[0] - 1, site.dock[1]];
    cond(s, 'wu', 'blockade');
    expect(isBlockaded(s, 'wu', 1)).toBe(true);
    const r = sailStep(map, s, 1, 0);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('封港');
    expect(r.state.docked).toBeNull();
    expect(tryDock(map, r.state).ok).toBe(false);
  });
  it('封港结束后可以正常靠港', () => {
    const s = sea();
    const site = map.sites.find((x) => x.id === 'wu')!;
    s.pos = [site.dock[0] - 1, site.dock[1]];
    cond(s, 'wu', 'blockade', 0);
    const r = sailStep(map, s, 1, 0);
    expect(r.state.docked).toBe('wu');
  });
  it('瘟疫港口：靠港时有船员染病', () => {
    const s = sea();
    s.ship.crew = 10;
    cond(s, 'wu', 'plague');
    dockAt(s, 'wu');
    expect(s.ship.crew).toBeLessThan(10);
    expect(s.log.some((l) => l.includes('瘟疫'))).toBe(true);
  });
  it('没有瘟疫的港口靠港不掉人', () => {
    const s = sea();
    s.ship.crew = 10;
    dockAt(s, 'wu');
    expect(s.ship.crew).toBe(10);
  });
  it('在港里待够久，会出现各种港口状态，同时存在的不超过上限', () => {
    let s = newGame(map, 3);
    s.gold = 1e6;
    const kinds = new Set<string>();
    for (let i = 0; i < 400; i++) {
      s = waitDay(s).state;
      expect(s.conds.length).toBeLessThanOrEqual(COND_MAX);
      for (const c of s.conds) kinds.add(c.kind);
    }
    expect(kinds.size).toBe(3);
  });
  it('不会封你正停靠的港口，开局前 40 天也不封灰檐港', () => {
    for (let d = 1; d < 40; d++) {
      const s = newGame(map, 8);
      maybeSpawnCond(s, d);
      expect(condAt(s, 'hui', 'blockade', d)).toBeUndefined();
    }
    for (let seed = 1; seed < 400; seed++) {
      const s = newGame(map, seed);
      s.docked = 'jing';
      for (let d = 41; d < 60; d++) maybeSpawnCond(s, d);
      expect(condAt(s, 'jing', 'blockade', 50)).toBeUndefined();
    }
  });
  it('酒馆消息会提到别处的港口状态', () => {
    const s = newGame(map, 2);
    s.conds.push({ id: 'x', port: 'tie', kind: 'blockade', until: 20, text: '铁锚镇被封港了' });
    expect(rumorLines(s, 'hui').some((l) => l.includes('铁锚镇被封港了'))).toBe(true);
  });
  it('状态到期会被清掉', () => {
    let s = newGame(map, 1);
    s.conds.push({ id: 'x', port: 'tie', kind: 'festival', until: 3, text: 't' });
    s = clone(s);
    for (let i = 0; i < 5; i++) s = waitDay(s).state;
    expect(s.conds.find((c) => c.id === 'x')).toBeUndefined();
    expect(dayNumber(s)).toBe(6);
  });
});
