import { describe, expect, it } from 'vitest';
import {
  MAX_RATIO, MIN_RATIO, askPrice, bidPrice, eventMult, initialStock, maxBuyByGold, midPrice, priceTier,
  quoteBuy, quoteSell, refStock, relaxStock, targetStock, affinity, type MarketEvent,
} from './pricing';
import { GOODS, PORTS, GOOD_BY_ID } from './world';

describe('世界数据', () => {
  it('15 种商品、12 个港口、4 个文化区', () => {
    expect(GOODS.length).toBe(15);
    expect(PORTS.length).toBe(12);
    expect(new Set(PORTS.map((p) => p.region)).size).toBe(4);
  });
  it('每种商品至少有一个产地和一个需求地', () => {
    for (const g of GOODS) {
      expect(PORTS.some((p) => p.makes.includes(g.id)), g.id).toBe(true);
      expect(PORTS.some((p) => p.wants.includes(g.id)), g.id).toBe(true);
    }
  });
  it('同一港口的产出与紧缺不重叠', () => {
    for (const p of PORTS) for (const g of p.makes) expect(p.wants).not.toContain(g);
  });
  it('港口编号与名字都不重复', () => {
    expect(new Set(PORTS.map((p) => p.id)).size).toBe(12);
    expect(new Set(PORTS.map((p) => p.name)).size).toBe(12);
  });
});

describe('价格模型', () => {
  const port = 'hui';
  it('库存等于基准库存时价格等于基准价', () => {
    expect(midPrice(port, 'salt', refStock(port))).toBe(12);
    expect(midPrice(port, 'pearl', refStock(port))).toBe(120);
  });
  it('库存越少越贵，越多越便宜', () => {
    const ref = refStock(port);
    expect(midPrice(port, 'rice', ref * 0.5)).toBeGreaterThan(midPrice(port, 'rice', ref));
    expect(midPrice(port, 'rice', ref * 2)).toBeLessThan(midPrice(port, 'rice', ref));
  });
  it('价格被限制在 0.35～3 倍之间', () => {
    expect(midPrice(port, 'pearl', 0.0001)).toBe(Math.round(120 * MAX_RATIO));
    expect(midPrice(port, 'pearl', 1e9)).toBe(Math.round(120 * MIN_RATIO));
  });
  it('事件系数参与计价', () => {
    const ref = refStock(port);
    expect(midPrice(port, 'tea', ref, 1.6)).toBe(Math.round(55 * 1.6));
  });
  it('买价高于中间价，卖价低于中间价', () => {
    expect(askPrice(100)).toBe(105);
    expect(bidPrice(100)).toBe(95);
    expect(askPrice(1)).toBeGreaterThanOrEqual(1);
    expect(bidPrice(1)).toBeGreaterThanOrEqual(1);
  });
  it('出产品目标库存高于紧缺品', () => {
    for (const p of PORTS) {
      const mk = targetStock(p.id, p.makes[0]);
      const wn = targetStock(p.id, p.wants[0]);
      expect(mk).toBeGreaterThan(wn);
    }
  });
  it('出产地的价格低于基准、紧缺地的价格高于基准', () => {
    for (const p of PORTS) {
      for (const g of p.makes) expect(midPrice(p.id, g, targetStock(p.id, g))).toBeLessThan(GOOD_BY_ID[g].base);
      for (const g of p.wants) expect(midPrice(p.id, g, targetStock(p.id, g))).toBeGreaterThan(GOOD_BY_ID[g].base);
    }
  });
  it('affinity 区分产地、需求地和普通', () => {
    expect(affinity('hui', 'fish')).toBe('make');
    expect(affinity('hui', 'rice')).toBe('want');
    expect(affinity('hui', 'salt')).toBe('normal');
  });
  it('priceTier 给出便宜 / 合理 / 贵', () => {
    expect(priceTier(9, 'salt')).toBe('cheap');
    expect(priceTier(12, 'salt')).toBe('fair');
    expect(priceTier(20, 'salt')).toBe('dear');
  });
});

describe('批量成交', () => {
  const stock = refStock('hui');
  it('买得越多均价越高，库存逐件下降', () => {
    const a = quoteBuy('hui', 'rice', stock, 1);
    const b = quoteBuy('hui', 'rice', stock, 30);
    expect(b.avg).toBeGreaterThan(a.avg);
    expect(b.stockAfter).toBe(stock - 30);
    expect(b.qty).toBe(30);
  });
  it('卖得越多均价越低，库存逐件上升', () => {
    const a = quoteSell('hui', 'rice', stock, 1);
    const b = quoteSell('hui', 'rice', stock, 30);
    expect(b.avg).toBeLessThan(a.avg);
    expect(b.stockAfter).toBe(stock + 30);
  });
  it('原地买了再卖一定亏（有买卖差价）', () => {
    const buy = quoteBuy('hui', 'tea', stock, 10);
    const sell = quoteSell('hui', 'tea', buy.stockAfter, 10);
    expect(sell.total).toBeLessThan(buy.total);
  });
  it('库存不足时只能买到库存允许的数量', () => {
    const q = quoteBuy('hui', 'rice', 5.5, 20);
    expect(q.qty).toBe(4);
  });
  it('maxBuyByGold 不超过预算也不超过上限', () => {
    const n = maxBuyByGold('hui', 'rice', stock, 100, 999);
    const q = quoteBuy('hui', 'rice', stock, n);
    expect(q.total).toBeLessThanOrEqual(100);
    expect(quoteBuy('hui', 'rice', stock, n + 1).total).toBeGreaterThan(100);
    expect(maxBuyByGold('hui', 'rice', stock, 1e6, 7)).toBe(7);
    expect(maxBuyByGold('hui', 'rice', stock, 0, 7)).toBe(0);
  });
});

describe('库存回归与事件', () => {
  it('库存会向目标回归', () => {
    const t = targetStock('hui', 'salt');
    let s = 1;
    for (let d = 1; d <= 60; d++) s = relaxStock(1, d, 'hui', 'salt', s);
    expect(Math.abs(s - t)).toBeLessThan(t * 0.25);
  });
  it('同样的输入得到同样的库存（确定性）', () => {
    expect(relaxStock(7, 12, 'wu', 'tea', 50)).toBe(relaxStock(7, 12, 'wu', 'tea', 50));
  });
  it('初始库存在目标的 ±10% 内', () => {
    for (const p of PORTS) for (const g of GOODS) {
      const t = targetStock(p.id, g.id);
      const s = initialStock(3, p.id, g.id);
      expect(s).toBeGreaterThanOrEqual(t * 0.89);
      expect(s).toBeLessThanOrEqual(t * 1.11);
    }
  });
  const ev = (o: Partial<MarketEvent>): MarketEvent => ({ id: 'e', port: 'hui', good: 'tea', kind: 'shortage', mult: 1.6, until: 10, text: '', ...o });
  it('事件在有效期内生效、过期后失效', () => {
    expect(eventMult([ev({})], 'hui', 'tea', 10)).toBe(1.6);
    expect(eventMult([ev({})], 'hui', 'tea', 11)).toBe(1);
  });
  it('事件只影响对应港口和商品', () => {
    expect(eventMult([ev({})], 'wu', 'tea', 5)).toBe(1);
    expect(eventMult([ev({})], 'hui', 'salt', 5)).toBe(1);
  });
  it('同一商品的多个事件系数相乘', () => {
    expect(eventMult([ev({}), ev({ id: 'f', mult: 0.5 })], 'hui', 'tea', 5)).toBeCloseTo(0.8);
  });
});
