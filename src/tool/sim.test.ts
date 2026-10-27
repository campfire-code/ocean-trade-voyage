// 平衡测算：自动跑单的机器人船长跑满一年，检查第一季度目标可达、海战不会让新手开局必死。
import { describe, expect, it } from 'vitest';
import { generateMap } from './mapgen';
import { botChoice, clearInterrupts, simulate } from './sim';
import { beginBattle, newGame, undock, lifeline, dockAt, advance } from './turn';
import { makeScene, SEA_EVENT_BY_ID } from './events';
import { RELIEF_COOLDOWN, RELIEF_FLOOR } from './turn';

const map = generateMap();

describe('机器人的决定', () => {
  it('随机事件：付得起就选第一项，付不起就选后面的', () => {
    const s = undock(newGame(map, 1)).state;
    s.scene = makeScene(SEA_EVENT_BY_ID.trader);
    expect(botChoice(s)).toBe(0);
    s.gold = 5;
    expect(botChoice(s)).toBe(1);
  });
  it('clearInterrupts 把场景和海战都处理完', () => {
    let s = undock(newGame(map, 2)).state;
    s.scene = makeScene(SEA_EVENT_BY_ID.fog);
    s = clearInterrupts(map, s);
    expect(s.scene).toBeNull();
    s = beginBattle(s, 'crow');
    s = clearInterrupts(map, s);
    expect(s.combat).toBeNull();
  });
  it('没有待决事项时 clearInterrupts 原样返回', () => {
    const s = undock(newGame(map, 2)).state;
    expect(clearInterrupts(map, s)).toBe(s);
  });
});

describe('破产救济', () => {
  const broke = () => {
    const s = newGame(map, 1);
    s.gold = 7;
    return s;
  };
  it('在港里身无分文、货舱空：借给本钱，扣 1 点声望', () => {
    const s = broke();
    s.rep = 3;
    lifeline(s);
    expect(s.gold).toBe(RELIEF_FLOOR);
    expect(s.rep).toBe(2);
    expect(s.log[s.log.length - 1]).toContain('借给你');
  });
  it('声望为 0 时不会变负', () => {
    const s = broke();
    lifeline(s);
    expect(s.rep).toBe(0);
  });
  it('手里有货、或还有钱，都不救济', () => {
    const a = broke();
    a.cargo = { fish: { qty: 1, cost: 5 } };
    lifeline(a);
    expect(a.gold).toBe(7);
    const b = newGame(map, 1);
    lifeline(b);
    expect(b.gold).toBe(800);
  });
  it('20 天内只救济一次', () => {
    const s = broke();
    advance(s, 30, false);
    s.gold = 7;
    lifeline(s);
    expect(s.gold).toBe(RELIEF_FLOOR);
    s.gold = 7;
    lifeline(s);
    expect(s.gold).toBe(7);
    advance(s, RELIEF_COOLDOWN + 1, false);
    s.gold = 7;
    lifeline(s);
    expect(s.gold).toBe(RELIEF_FLOOR);
  });
  it('靠港时自动触发', () => {
    const s = undock(broke()).state;
    dockAt(s, 'wu');
    expect(s.gold).toBeGreaterThanOrEqual(RELIEF_FLOOR - 10);
  });
});

describe('跑满一年', { timeout: 60_000 }, () => {
  const run = (seed: number, extra = {}) => simulate(map, { seed, days: 360, ...extra });

  it('同样的种子，结果完全相同（纯函数）', () => {
    const a = run(4), b = run(4);
    expect(a.gold).toBe(b.gold);
    expect(a.battles).toEqual(b.battles);
    expect(a.state).toEqual(b.state);
  });
  it('跑完 360 天，数值没有 NaN，季度结算 4 次', () => {
    const r = run(1);
    expect(r.days).toBeGreaterThanOrEqual(360);
    expect(Number.isFinite(r.gold)).toBe(true);
    expect(Number.isFinite(r.rep)).toBe(true);
    expect(r.quarters.length).toBeGreaterThanOrEqual(4);
    expect(r.stuck).toBe(false);
    expect(r.trips).toBeGreaterThan(10);
  });
  it('第一季度的两个目标，12 个不同种子的机器人全部达成', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = simulate(map, { seed, days: 100 });
      expect(r.quarters[0].won, `种子 ${seed}`).toBe(2);
    }
  });
  it('第一季度结束时资金远超目标（目标 1500）', () => {
    const r = simulate(map, { seed: 2, days: 100 });
    expect(r.quarters[0].goldAtEnd).toBeGreaterThan(1500);
  });
  it('一年里会遇到海战，但不会每天都在打', () => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) total += run(seed).battles.total;
    expect(total).toBeGreaterThan(10);
    expect(total / 6).toBeLessThan(25);
  });
  it('新手最坏情形（遇敌从不撤退、从不买路、什么装备都不买）前 90 天：胜多负少，没人被救，没人破产', () => {
    let total = 0, won = 0, rescued = 0, min = Infinity;
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulate(map, { seed, days: 90, alwaysFight: true, noRetreat: true });
      total += r.battles.total; won += r.battles.won; rescued += r.rescued; min = Math.min(min, r.gold);
    }
    expect(total).toBeGreaterThan(20);
    expect(won / total).toBeGreaterThan(0.9);
    expect(rescued).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThan(1500);
  });
  it('新手最坏情形整年：不会被打到无法翻身，年末资金仍远超起步资金', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = run(seed, { alwaysFight: true, noRetreat: true });
      expect(r.gold, `种子 ${seed}`).toBeGreaterThan(800);
      expect(r.stuck).toBe(false);
    }
  });
  it('正常打法（打得过才打，打不过买路或撤退）比硬拼挣得多、败得少', () => {
    let careful = 0, reckless = 0, lostC = 0, lostR = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const a = run(seed), b = run(seed, { alwaysFight: true, noRetreat: true });
      careful += a.gold; reckless += b.gold; lostC += a.battles.lost; lostR += b.battles.lost;
    }
    expect(careful).toBeGreaterThan(reckless);
    expect(lostC).toBeLessThan(lostR);
  });
  it('配齐火炮和护卫，海战败仗明显减少', () => {
    let plainLost = 0, armedLost = 0;
    for (let seed = 1; seed <= 8; seed++) {
      plainLost += run(seed, { alwaysFight: true, noRetreat: true }).battles.lost;
      armedLost += run(seed, { alwaysFight: true, noRetreat: true, guns: 3, guards: 3 }).battles.lost;
    }
    expect(armedLost).toBeLessThan(plainLost);
  });
  it('跑单赚到的钱会换成声望，声望随时间累积', () => {
    const r = run(3);
    expect(r.rep).toBeGreaterThan(5);
    expect(r.state.stats.traded).toBeGreaterThan(10000);
  });
  it('每个季度末的资金都不低于起步资金（没有破产）', () => {
    for (let seed = 1; seed <= 6; seed++) for (const q of run(seed).quarters) expect(q.goldAtEnd, `种子 ${seed} 第 ${q.index + 1} 季`).toBeGreaterThan(800);
  });
});
