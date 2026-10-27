// 第一期（0.1.x）存档升级到第二期格式：迁移函数与校验。
import { describe, expect, it } from 'vitest';
import { findRoute, generateMap } from './mapgen';
import { AUTO_KEY, SAVE_VERSION, migrateState, parseSave, readAuto, readSlot, serializeSave, summarize, validateState } from './save';
import { advance, beginBattle, clone, newGame, sailStep, undock } from './turn';
import { buyConsort, buyGood } from './trade';
import { startCombat } from './combat';
import { makeScene } from './events';
import { SEA_EVENT_BY_ID } from './events';

const map = generateMap();

/** 还原一份第一期存档里的状态：去掉第二期新增的全部字段 */
function toV1(s: ReturnType<typeof newGame>): Record<string, unknown> {
  const o = clone(s) as unknown as Record<string, unknown>;
  for (const k of ['consorts', 'guards', 'conds', 'story', 'scene', 'combat']) delete o[k];
  o.v = 1;
  const ship = o.ship as Record<string, unknown>;
  delete ship.guns; delete ship.armor;
  const st = o.stats as Record<string, unknown>;
  for (const k of ['battlesWon', 'battlesLost', 'fled', 'paid', 'reliefDay']) delete st[k];
  return o;
}
const v1File = (s: ReturnType<typeof newGame>) => JSON.stringify({ app: 'x01-ocean-trade', version: 1, savedAt: '2026-10-20T08:00:00Z', state: toV1(s) });

const played = () => {
  let s = newGame(map, 77, '老船长');
  s = buyGood(s, 'fish', 15).state;
  advance(s, 9, false);
  s.gold = 1234;
  s.rep = 3.5;
  return s;
};

describe('第一期存档升级', () => {
  it('存档版本号升到 2', () => {
    expect(SAVE_VERSION).toBe(2);
    expect(JSON.parse(serializeSave(newGame(map, 1))).version).toBe(2);
  });
  it('第一期存档能读，自动升级到第二期格式', () => {
    const s = played();
    const r = parseSave(v1File(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.v).toBe(2);
    expect(r.savedAt).toBe('2026-10-20T08:00:00Z');
  });
  it('原有进度一项不丢：资金、声望、日期、货物、行情、目标、统计', () => {
    const s = played();
    const r = parseSave(v1File(s));
    if (!r.ok) throw new Error(r.error);
    const m = r.state;
    expect(m.gold).toBe(1234);
    expect(m.rep).toBe(3.5);
    expect(m.t).toBe(s.t);
    expect(m.captain).toBe('老船长');
    expect(m.cargo).toEqual(s.cargo);
    expect(m.stock).toEqual(s.stock);
    expect(m.quest).toEqual(s.quest);
    expect(m.relations).toEqual(s.relations);
    expect(m.stats.traded).toBe(s.stats.traded);
    expect(m.pos).toEqual(s.pos);
    expect(m.docked).toBe(s.docked);
    expect(m.ship.name).toBe(s.ship.name);
    expect(m.ship.crew).toBe(s.ship.crew);
  });
  it('新字段补上默认值：旗舰 2 门炮无装甲，没有僚船和护卫，主线从头，战斗统计清零', () => {
    const r = parseSave(v1File(played()));
    if (!r.ok) throw new Error(r.error);
    const m = r.state;
    expect(m.ship.guns).toBe(2);
    expect(m.ship.armor).toBe(0);
    expect(m.consorts).toEqual([]);
    expect(m.guards).toBe(0);
    expect(m.conds).toEqual([]);
    expect(m.story).toEqual({ chapter: 0, started: false, step: 0, base: 0, done: false });
    expect(m.scene).toBeNull();
    expect(m.combat).toBeNull();
    expect(m.stats).toMatchObject({ battlesWon: 0, battlesLost: 0, fled: 0, paid: 0, reliefDay: 0 });
  });
  it('升级后的存档可以继续玩：起航、航行、过日子', () => {
    const r = parseSave(v1File(played()));
    if (!r.ok) throw new Error(r.error);
    const s = undock(r.state).state;
    const route = findRoute(map, s.pos, map.sites.find((x) => x.id === 'wu')!.dock)!;
    const step = sailStep(map, s, route[0][0] - s.pos[0], route[0][1] - s.pos[1]);
    expect(step.ok).toBe(true);
    expect(step.state.t).toBeGreaterThan(s.t);
    advance(step.state, 5, true, true);
    expect(step.state.t).toBeGreaterThan(14);
  });
  it('升级后再存档、再读档，内容一致', () => {
    const r = parseSave(v1File(played()));
    if (!r.ok) throw new Error(r.error);
    const again = parseSave(serializeSave(r.state));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.state).toEqual(r.state);
  });
  it('migrateState 不修改传入的对象，对第二期状态原样返回', () => {
    const v1 = toV1(played());
    const before = JSON.stringify(v1);
    const out = migrateState(v1) as Record<string, unknown>;
    expect(JSON.stringify(v1)).toBe(before);
    expect(out.v).toBe(2);
    const v2 = newGame(map, 1);
    expect(migrateState(v2)).toBe(v2);
    expect(migrateState('不是对象')).toBe('不是对象');
  });
  it('第一期存档位和自动存档都能读', () => {
    const text = v1File(played());
    const slots = { '2': text, [AUTO_KEY]: text };
    expect(readSlot(slots, 2).ok).toBe(true);
    expect(readAuto(slots).ok).toBe(true);
  });
  it('升级后的摘要可以显示', () => {
    const r = parseSave(v1File(played()));
    if (!r.ok) throw new Error(r.error);
    const sm = summarize(r.state, r.savedAt);
    expect(sm.captain).toBe('老船长');
    expect(sm.gold).toBe(1234);
  });
  it('第一期存档里炮的字段缺失也不会报错；已有字段（例如手工加的）保留', () => {
    const o = toV1(played());
    (o.ship as Record<string, unknown>).guns = 3;
    const r = validateState(o);
    expect(r.ship.guns).toBe(3);
  });
  it('损坏的第一期存档仍然被拒绝，并说明原因', () => {
    const o = toV1(played());
    (o.ship as Record<string, unknown>).hull = 'x';
    const r = parseSave(JSON.stringify({ app: 'x01-ocean-trade', version: 1, state: o }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/存档损坏/);
  });
  it('第一期存档在海上、位置在中途也能升级', () => {
    let s = undock(played()).state;
    const route = findRoute(map, s.pos, map.sites.find((x) => x.id === 'wu')!.dock)!;
    s = sailStep(map, s, route[0][0] - s.pos[0], route[0][1] - s.pos[1]).state;
    const r = parseSave(v1File(s));
    expect(r.ok).toBe(true);
  });
});

describe('第二期存档校验', () => {
  const base = () => JSON.parse(JSON.stringify(newGame(map, 1)));
  const bad = (edit: (o: any) => void, pattern: RegExp) => {
    const o = base();
    edit(o);
    expect(() => validateState(o)).toThrow(pattern);
  };
  it('完整的船队、战斗、场景、港口状态存了再读一致', () => {
    let s = newGame(map, 3);
    s.gold = 50000; s.rep = 20;
    s = buyConsort(s, 'swallow').state;
    s.guards = 3;
    s.conds.push({ id: 'c1', port: 'wu', kind: 'plague', until: 20, text: '瘟疫' });
    s.scene = makeScene(SEA_EVENT_BY_ID.fog);
    s = undock(s).state;
    startCombat(s, 'tide');
    const r = parseSave(serializeSave(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(s);
  });
  it('僚船超过 2 艘被拒', () => bad((o) => { o.consorts = [o.ship, o.ship, o.ship]; }, /僚船太多/));
  it('护卫超过上限被拒', () => bad((o) => { o.guards = 5; }, /护卫数/));
  it('火炮超过炮位被拒', () => bad((o) => { o.ship.guns = 9; }, /火炮数/));
  it('装甲等级超范围被拒', () => bad((o) => { o.ship.armor = 3; }, /装甲/));
  it('补给超过全队容量被拒', () => bad((o) => { o.ship.food = 999; }, /补给超出/));
  it('货物超过全队货舱被拒', () => bad((o) => { o.cargo = { salt: { qty: 41, cost: 1 } }; }, /超出货舱/));
  it('未知敌船被拒', () => bad((o) => { o.combat = { foe: { def: 'ghost' } }; }, /未知敌船/));
  it('战斗距离超范围被拒', () => {
    const s = beginBattle(undock(newGame(map, 1)).state, 'crow');
    const o = JSON.parse(JSON.stringify(s));
    o.combat.dist = 7;
    expect(() => validateState(o)).toThrow(/距离/);
  });
  it('港口状态类型未知被拒', () => bad((o) => { o.conds = [{ id: 'x', port: 'wu', kind: 'flood', until: 3, text: '' }]; }, /港口状态/));
  it('主线章节超范围被拒', () => bad((o) => { o.story.chapter = 9; }, /主线章节/));
  it('场景缺选项被拒', () => bad((o) => { o.scene = { id: 'x', title: 't', text: 't' }; }, /场景/));
  it('缺少第二期必需的字段被拒（既不是第一期也不完整）', () => bad((o) => { delete o.consorts; }, /僚船/));
  it('不认识的版本被拒', () => bad((o) => { o.v = 3; }, /版本/));
});
