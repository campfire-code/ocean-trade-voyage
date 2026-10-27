import { describe, expect, it } from 'vitest';
import { generateMap } from './mapgen';
import { newGame, advance } from './turn';
import { buyGood } from './trade';
import { SLOT_COUNT, dropSlot, parseSave, putAuto, putSlot, readAuto, readSlot, serializeSave, summarize, validateState } from './save';

const map = generateMap();
const play = () => {
  let s = newGame(map, 7, '存档测试');
  s = buyGood(s, 'fish', 12).state;
  advance(s, 5, false);
  return s;
};

describe('存档序列化', () => {
  it('存了再读，状态完全一致', () => {
    const s = play();
    const r = parseSave(serializeSave(s, '2026-10-27T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toEqual(s);
      expect(r.savedAt).toBe('2026-10-27T00:00:00Z');
    }
  });
  it('读回来的状态能继续玩，且结果与不存档一致', () => {
    const s = play();
    const r = parseSave(serializeSave(s));
    const a = JSON.parse(JSON.stringify(s)), b = r.ok ? r.state : null;
    advance(a, 20, false);
    advance(b!, 20, false);
    expect(b).toEqual(a);
  });
  it('不是 JSON 或不是本游戏的存档会被拒绝', () => {
    expect(parseSave('不是json').ok).toBe(false);
    expect(parseSave('{"app":"other"}').ok).toBe(false);
    expect(parseSave('[]').ok).toBe(false);
  });
  it('版本不对被拒绝', () => {
    const o = JSON.parse(serializeSave(play()));
    o.state.v = 2;
    const r = parseSave(JSON.stringify(o));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/版本/);
  });
  it('缺字段、类型错误、数值越界都能识别', () => {
    const base = JSON.parse(serializeSave(play())).state;
    const bad = (mut: (s: any) => void) => {
      const s = JSON.parse(JSON.stringify(base));
      mut(s);
      return () => validateState(s);
    };
    expect(bad((s) => delete s.ship)).toThrow();
    expect(bad((s) => (s.gold = 'abc'))).toThrow();
    expect(bad((s) => (s.gold = null))).toThrow();
    expect(bad((s) => (s.t = -1))).toThrow();
    expect(bad((s) => (s.ship.type = 'ghost'))).toThrow(/船型/);
    expect(bad((s) => (s.docked = 'nowhere'))).toThrow(/港口/);
    expect(bad((s) => (s.pos = [999, 1]))).toThrow();
    expect(bad((s) => (s.pos = [1.5, 1]))).toThrow();
    expect(bad((s) => (s.cargo = { ghost: { qty: 1, cost: 1 } }))).toThrow(/货物/);
    expect(bad((s) => (s.cargo = { salt: { qty: 9999, cost: 1 } }))).toThrow(/货舱/);
    expect(bad((s) => delete s.stock.hui)).toThrow(/行情/);
    expect(bad((s) => (s.stock.hui.salt = -3))).toThrow();
    expect(bad((s) => (s.ship.crew = 0))).toThrow();
    expect(bad((s) => (s.ship.hull = 1e6))).toThrow();
    expect(bad((s) => (s.quest.goals[0].kind = 'x'))).toThrow();
    expect(bad((s) => (s.events = [{ port: 'hui', good: 'tea', kind: 'boom', id: 'a', mult: 1, until: 1, text: '' }]))).toThrow();
  });
  it('数值里的 NaN / Infinity 会被拒绝', () => {
    const s = play();
    s.gold = Number.POSITIVE_INFINITY;
    expect(() => validateState(JSON.parse(JSON.stringify({ ...s, gold: 'x' })))).toThrow();
    expect(parseSave(serializeSave(s)).ok).toBe(false);
  });
  it('旧存档缺少统计字段时用默认值补齐', () => {
    const o = JSON.parse(serializeSave(play()));
    delete o.state.stats;
    const r = parseSave(JSON.stringify(o));
    expect(r.ok && r.state.stats.traded).toBe(0);
  });
});

describe('存档位', () => {
  it('有 5 个存档位，可存可读可删', () => {
    expect(SLOT_COUNT).toBe(5);
    let slots = putSlot({}, 3, play());
    expect(readSlot(slots, 3).ok).toBe(true);
    expect(readSlot(slots, 2).ok).toBe(false);
    slots = dropSlot(slots, 3);
    expect(readSlot(slots, 3).ok).toBe(false);
  });
  it('存档位超出范围报错，覆盖只影响指定的位', () => {
    expect(() => putSlot({}, 0, play())).toThrow();
    expect(() => putSlot({}, 6, play())).toThrow();
    const a = play();
    let slots = putSlot({}, 1, a);
    const b = buyGood(a, 'salt', 3).state;
    slots = putSlot(slots, 2, b);
    const r1 = readSlot(slots, 1), r2 = readSlot(slots, 2);
    expect(r1.ok && r1.state.cargo.salt).toBeUndefined();
    expect(r2.ok && r2.state.cargo.salt.qty).toBe(3);
  });
  it('坏掉的存档位读取时给出错误而不是崩溃', () => {
    const r = readSlot({ '1': '{"app":"x01-ocean-trade","version":1,"state":{"v":1}}' }, 1);
    expect(r.ok).toBe(false);
  });
  it('存档摘要包含船长、船名、资金、日期', () => {
    const sm = summarize(play(), 'T');
    expect(sm.captain).toBe('存档测试');
    expect(sm.shipName).toBe('晨星号');
    expect(sm.date).toBe('第 1 年 1 月 6 日');
    expect(sm.quarter).toBe('第 1 年春季');
  });
});

describe('自动存档', () => {
  it('自动存档单独存放，不占用 1～5 号位', () => {
    const slots = putAuto({}, play());
    expect(Object.keys(slots)).toEqual(['auto']);
    expect(readAuto(slots).ok).toBe(true);
    expect(readSlot(slots, 1).ok).toBe(false);
  });
  it('没有自动存档时读取失败', () => {
    expect(readAuto({}).ok).toBe(false);
  });
});
