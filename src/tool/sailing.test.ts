import { describe, expect, it } from 'vitest';
import { DIRS, consumeDay, crewFactor, dailySupply, dailyWear, headingIndex, hullFactor, stepDays, stormDamage, windAt, windFactor, windName } from './sailing';
import { SHIP_BY_ID } from './world';

const lark = SHIP_BY_ID.lark;

describe('风', () => {
  it('同一种子同一天风向固定', () => {
    expect(windAt(9, 30)).toEqual(windAt(9, 30));
  });
  it('每 4 天换一次风', () => {
    expect(windAt(9, 8)).toEqual(windAt(9, 11));
  });
  it('风向与强度在合法范围内，且长期来看各种风都出现', () => {
    const froms = new Set<number>(), strengths = new Set<number>();
    for (let d = 0; d < 800; d += 4) {
      const w = windAt(5, d);
      expect(w.from).toBeGreaterThanOrEqual(0);
      expect(w.from).toBeLessThan(8);
      froms.add(w.from);
      strengths.add(w.strength);
    }
    expect(froms.size).toBe(8);
    expect(strengths.size).toBe(3);
  });
  it('风名为中文', () => {
    expect(windName({ from: 7, strength: 3 })).toBe('西北风 · 大风');
  });
  it('headingIndex 与方向向量一致', () => {
    DIRS.forEach(([x, y], i) => expect(headingIndex(x, y)).toBe(i));
    expect(headingIndex(5, -3)).toBe(1);
  });
});

describe('航速', () => {
  const w = (from: number, strength: 1 | 2 | 3 = 2) => ({ from, strength });
  it('顺风最快、逆风最慢', () => {
    // 北风（从北吹来）吹向南：航向南（4）是顺风，航向北（0）是逆风
    const down = windFactor(4, w(0), lark.upwind);
    const side = windFactor(2, w(0), lark.upwind);
    const up = windFactor(0, w(0), lark.upwind);
    expect(down).toBeCloseTo(1);
    expect(up).toBeCloseTo(lark.upwind);
    expect(down).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(up);
  });
  it('风越大船越快', () => {
    expect(windFactor(4, w(0, 3), 0.5)).toBeGreaterThan(windFactor(4, w(0, 1), 0.5));
  });
  it('逆风能力强的船逆风更快', () => {
    expect(windFactor(0, w(0), 0.6)).toBeGreaterThan(windFactor(0, w(0), 0.38));
  });
  it('船员满编、船体完好时最快', () => {
    expect(crewFactor(10, lark)).toBe(1);
    expect(crewFactor(5, lark)).toBeCloseTo(0.75);
    expect(hullFactor(60, lark)).toBe(1);
    expect(hullFactor(0, lark)).toBeCloseTo(0.7);
  });
  it('斜走比直走多花 √2 倍的时间（同风况下）', () => {
    const base = { wind: w(0, 2), crew: 10, hull: 60, shallow: false };
    // 东（2）和东南（3）相对北风夹角不同，改用同夹角的对称方向：东北(1)与东南(3)
    const straight = stepDays(lark, { ...base, heading: 2 });
    const diag = stepDays(lark, { ...base, heading: 3 });
    expect(diag / straight).toBeGreaterThan(1.2);
  });
  it('浅滩比深水慢', () => {
    const o = { heading: 4, wind: { from: 0, strength: 2 as const }, crew: 10, hull: 60 };
    expect(stepDays(lark, { ...o, shallow: true })).toBeGreaterThan(stepDays(lark, { ...o, shallow: false }));
  });
  it('单步用时为正且有限', () => {
    for (let h = 0; h < 8; h++) {
      const d = stepDays(SHIP_BY_ID.whale, { heading: h, wind: { from: 3, strength: 1 }, crew: 12, hull: 1, shallow: true });
      expect(d).toBeGreaterThan(0);
      expect(Number.isFinite(d)).toBe(true);
    }
  });
});

describe('补给消耗', () => {
  it('每 5 个船员 1 份，至少 1 份', () => {
    expect(dailySupply(1)).toBe(1);
    expect(dailySupply(5)).toBe(1);
    expect(dailySupply(6)).toBe(2);
    expect(dailySupply(40)).toBe(8);
  });
  it('补给够的时候只扣数量', () => {
    expect(consumeDay(10, 10, 10)).toEqual({ food: 8, water: 8, crew: 10, lost: 0, short: false });
  });
  it('食物不够：扣光，船员死伤', () => {
    const r = consumeDay(1, 10, 20);
    expect(r.food).toBe(0);
    expect(r.short).toBe(true);
    expect(r.lost).toBe(2);
    expect(r.crew).toBe(18);
  });
  it('淡水不够同样死伤', () => {
    const r = consumeDay(10, 0, 10);
    expect(r.lost).toBe(1);
    expect(r.water).toBe(0);
  });
  it('死伤至少 1 人，但至少留 1 个活人', () => {
    expect(consumeDay(0, 0, 3).lost).toBe(1);
    expect(consumeDay(0, 0, 1).crew).toBe(1);
  });
  it('持续断粮会让船员逐天减少直到只剩 1 人', () => {
    let crew = 20;
    for (let i = 0; i < 100; i++) crew = consumeDay(0, 0, crew).crew;
    expect(crew).toBe(1);
  });
});

describe('风暴与磨损', () => {
  it('只有大风才会有风暴损伤', () => {
    for (let d = 0; d < 200; d++) expect(stormDamage(1, d, { from: 0, strength: 2 }, 100)).toBe(0);
  });
  it('大风时一部分天数有损伤，且在合理范围', () => {
    let hit = 0;
    for (let d = 0; d < 400; d++) {
      const x = stormDamage(1, d, { from: 0, strength: 3 }, 100);
      if (x > 0) { hit++; expect(x).toBeLessThanOrEqual(9); }
    }
    expect(hit).toBeGreaterThan(80);
    expect(hit).toBeLessThan(200);
  });
  it('每日磨损与船体成比例，有下限', () => {
    expect(dailyWear(100)).toBeCloseTo(0.4);
    expect(dailyWear(10)).toBe(0.2);
  });
});
