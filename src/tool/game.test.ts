import { describe, expect, it } from 'vitest';
import { generateMap, findRoute } from './mapgen';
import { advance, clone, dockAt, newGame, rescue, settleWages, sailStep, tryDock, undock, waitDay, nearestDock } from './turn';
import { buyGood, buyShip, buySupply, canBuildHere, currentMid, dismiss, listenRumors, recruit, recruitPrice, repairShip, rumorLines, sellGood, supplyPrice, tradeInValue, repairPrice } from './trade';
import { closeQuarter, goalLabel, goalProgress, latchGoals, makeQuest, quarterName } from './quest';
import { REL_MIN, cargoFree, cargoUsed, dateText, dayNumber, tradePartners } from './state';
import { eventMult } from './pricing';
import { DAYS_PER_QUARTER, GOODS, PORTS } from './world';

const map = generateMap();
const fresh = () => newGame(map, 42, '测试船长');
const site = (id: string) => map.sites.find((s) => s.id === id)!;

/** 沿航线开到某个港口，返回最终状态 */
function sailTo(s0: ReturnType<typeof fresh>, id: string) {
  let s = clone(s0);
  if (s.docked) s = undock(s).state;
  const route = findRoute(map, s.pos, site(id).dock)!;
  for (const [x, y] of route) {
    const r = sailStep(map, s, x - s.pos[0], y - s.pos[1]);
    expect(r.ok).toBe(true);
    s = r.state;
    if (s.docked) break;
  }
  return s;
}

describe('新游戏', () => {
  it('从灰檐港起步，现金 800，停靠中', () => {
    const s = fresh();
    expect(s.docked).toBe('hui');
    expect(s.gold).toBe(800);
    expect(s.ship.type).toBe('lark');
    expect(s.pos).toEqual(site('hui').dock);
  });
  it('每个港口每种商品都有库存', () => {
    const s = fresh();
    for (const p of PORTS) for (const g of GOODS) expect(s.stock[p.id][g.id]).toBeGreaterThan(0);
  });
  it('第一个季度有两个目标', () => {
    expect(fresh().quest.goals.length).toBe(2);
    expect(dayNumber(fresh())).toBe(1);
  });
  it('日期文字按 30 天一个月、12 个月一年', () => {
    expect(dateText(0)).toBe('第 1 年 1 月 1 日');
    expect(dateText(31)).toBe('第 1 年 2 月 2 日');
    expect(dateText(360)).toBe('第 2 年 1 月 1 日');
  });
});

describe('航行', () => {
  it('停靠时不能直接航行', () => {
    const r = sailStep(map, fresh(), 1, 0);
    expect(r.ok).toBe(false);
  });
  it('起航后可以走一步，花掉不到一天的时间，原状态不被修改', () => {
    const s0 = undock(fresh()).state;
    const before = JSON.stringify(s0);
    const route = findRoute(map, s0.pos, site('wu').dock)!;
    const r = sailStep(map, s0, route[0][0] - s0.pos[0], route[0][1] - s0.pos[1]);
    expect(r.ok).toBe(true);
    expect(r.state.t).toBeGreaterThan(0);
    expect(r.state.t).toBeLessThan(1);
    expect(JSON.stringify(s0)).toBe(before);
  });
  it('不能开上陆地', () => {
    const s = undock(fresh()).state;
    const land = site('hui').land;
    const dx = land[0] - s.pos[0], dy = land[1] - s.pos[1];
    expect(sailStep(map, s, dx, dy).ok).toBe(false);
  });
  it('开到另一个港口会自动靠港', () => {
    const s = sailTo(fresh(), 'wu');
    expect(s.docked).toBe('wu');
    expect(s.t).toBeGreaterThan(1);
    expect(s.stats.sailedDays).toBeGreaterThan(0);
  });
  it('航行消耗补给', () => {
    const s0 = fresh();
    const s = sailTo(s0, 'wu');
    expect(s.ship.food).toBeLessThan(s0.ship.food);
    expect(s.ship.water).toBeLessThan(s0.ship.water);
  });
  it('航行会让船体磨损', () => {
    const s = sailTo(fresh(), 'wu');
    expect(s.ship.hull).toBeLessThan(60);
  });
  it('靠港会补发工资', () => {
    const s = sailTo(fresh(), 'wu');
    expect(s.gold).toBeLessThan(800);
    expect(s.wageDue).toBe(0);
  });
  it('同样的操作得到同样的结果（确定性）', () => {
    const a = sailTo(fresh(), 'ji');
    const b = sailTo(fresh(), 'ji');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('船员不足时开不动', () => {
    const s = undock(fresh()).state;
    s.ship.crew = 2;
    expect(sailStep(map, s, 1, 0).ok).toBe(false);
  });
  it('起航后可以在码头格手动靠港', () => {
    const s = undock(fresh()).state;
    const r = tryDock(map, s);
    expect(r.ok).toBe(true);
    expect(r.state.docked).toBe('hui');
    expect(tryDock(map, r.state).ok).toBe(false);
  });
  it('海上不能休整，港里可以休整一天', () => {
    expect(waitDay(undock(fresh()).state).ok).toBe(false);
    const r = waitDay(fresh());
    expect(r.ok).toBe(true);
    expect(r.state.t).toBe(1);
  });
});

describe('断粮与脱险', () => {
  it('食物淡水耗尽后船员逐天减少', () => {
    const s = undock(fresh()).state;
    s.ship.food = 0; s.ship.water = 0; s.ship.crew = 10;
    advance(s, 3, true);
    expect(s.ship.crew).toBeLessThan(10);
    expect(s.log.some((l) => l.includes('补给耗尽'))).toBe(true);
  });
  it('补给耗尽到船员不足时被渔船救起：送到最近港口、货物全损、扣 15% 资金', () => {
    const s = undock(fresh()).state;
    s.cargo = { salt: { qty: 5, cost: 10 } };
    s.gold = 1000;
    s.ship.crew = 2;
    rescue(s, map, '测试');
    expect(s.docked).toBe('hui');
    expect(s.cargo).toEqual({});
    expect(s.gold).toBe(850);
    expect(s.ship.crew).toBeGreaterThanOrEqual(3);
    expect(s.stats.rescued).toBe(1);
    expect(s.t).toBe(4);
  });
  it('船体归零时下一步航行触发救援', () => {
    const s = undock(fresh()).state;
    s.ship.hull = 0.1;
    const route = findRoute(map, s.pos, site('wu').dock)!;
    let cur = s, rescued = false;
    for (const [x, y] of route) {
      const r = sailStep(map, cur, x - cur.pos[0], y - cur.pos[1]);
      cur = r.state;
      if (r.reason === '被救起') { rescued = true; break; }
    }
    expect(rescued).toBe(true);
    expect(cur.ship.hull).toBeGreaterThan(0);
  });
  it('nearestDock 找最近的码头', () => {
    expect(nearestDock(map, site('tong').dock).id).toBe('tong');
  });
});

describe('工资', () => {
  it('钱够就全额发', () => {
    const s = fresh();
    s.wageDue = 40;
    settleWages(s);
    expect(s.gold).toBe(760);
  });
  it('钱不够就发光，船员离队但至少留 1 人', () => {
    const s = fresh();
    s.gold = 10; s.ship.crew = 6; s.wageDue = 100;
    settleWages(s);
    expect(s.gold).toBe(0);
    expect(s.ship.crew).toBeLessThan(6);
    expect(s.ship.crew).toBeGreaterThanOrEqual(1);
  });
  it('每天按人头累计待发工资', () => {
    const s = fresh();
    advance(s, 4, false);
    expect(s.wageDue).toBe(12);
  });
});

describe('市场随时间变化', () => {
  it('买空的库存会逐天恢复', () => {
    const s = fresh();
    s.stock.hui.rice = 3;
    advance(s, 30, false);
    expect(s.stock.hui.rice).toBeGreaterThan(15);
  });
  it('事件会出现，也会过期，数量有上限', () => {
    const s = fresh();
    let seen = 0;
    for (let i = 0; i < 300; i++) { advance(s, 1, false); seen = Math.max(seen, s.events.length); expect(s.events.length).toBeLessThanOrEqual(8); }
    expect(seen).toBeGreaterThan(0);
    for (const e of s.events) expect(e.until).toBeGreaterThanOrEqual(Math.floor(s.t));
  });
  it('短缺事件抬高价格，丰收事件压低价格', () => {
    const s = fresh();
    const base = currentMid(s, 'wu', 'salt');
    s.events.push({ id: 'a', port: 'wu', good: 'salt', kind: 'shortage', mult: 1.6, until: 50, text: '' });
    expect(currentMid(s, 'wu', 'salt')).toBeGreaterThan(base);
    s.events = [{ id: 'b', port: 'wu', good: 'salt', kind: 'glut', mult: 0.7, until: 50, text: '' }];
    expect(currentMid(s, 'wu', 'salt')).toBeLessThan(base);
    expect(eventMult(s.events, 'wu', 'salt', dayNumber(s))).toBe(0.7);
  });
});

describe('交易', () => {
  it('买入扣钱、扣库存、占货舱，并记录成本', () => {
    const s0 = fresh();
    const r = buyGood(s0, 'fish', 10);
    expect(r.ok).toBe(true);
    expect(r.state.cargo.fish.qty).toBe(10);
    expect(r.state.gold).toBeLessThan(800);
    expect(r.state.stock.hui.fish).toBe(s0.stock.hui.fish - 10);
    expect(cargoUsed(r.state)).toBe(10);
    expect(r.state.cargo.fish.cost).toBeGreaterThan(0);
    expect(r.state.gold + Math.round(r.state.cargo.fish.cost * 10)).toBeGreaterThan(780);
  });
  it('货舱不够时按剩余空间少买（铜锭占 2 格）', () => {
    const s = fresh();
    s.gold = 100000;
    const r = buyGood(s, 'copper', 100);
    expect(r.ok).toBe(true);
    expect(r.state.cargo.copper.qty).toBe(20);
    expect(cargoFree(r.state)).toBe(0);
    expect(buyGood(r.state, 'salt', 1).ok).toBe(false);
  });
  it('钱不够时按预算少买，一件也买不起则失败', () => {
    const s = fresh();
    s.gold = 50;
    const r = buyGood(s, 'pearl', 5);
    expect(r.ok).toBe(false);
    s.gold = 300;
    const r2 = buyGood(s, 'pearl', 10);
    expect(r2.ok).toBe(true);
    expect(r2.state.cargo.pearl.qty).toBeLessThan(10);
    expect(r2.state.gold).toBeGreaterThanOrEqual(0);
  });
  it('卖出加钱、加库存，并计入利润', () => {
    const b = buyGood(fresh(), 'fish', 10).state;
    const r = sellGood(b, 'fish', 4);
    expect(r.ok).toBe(true);
    expect(r.state.cargo.fish.qty).toBe(6);
    expect(r.state.gold).toBeGreaterThan(b.gold);
    expect(r.state.stats.profit).not.toBe(0);
  });
  it('卖光后货物条目被删除，卖不存在的货失败', () => {
    const b = buyGood(fresh(), 'fish', 3).state;
    const r = sellGood(b, 'fish', 99);
    expect(r.state.cargo.fish).toBeUndefined();
    expect(sellGood(r.state, 'fish', 1).ok).toBe(false);
  });
  it('海上不能交易', () => {
    const s = undock(fresh()).state;
    expect(buyGood(s, 'fish', 1).ok).toBe(false);
    expect(sellGood(s, 'fish', 1).ok).toBe(false);
  });
  it('数量非法时失败', () => {
    expect(buyGood(fresh(), 'fish', 0).ok).toBe(false);
    expect(buyGood(fresh(), 'fish', -3).ok).toBe(false);
    expect(buyGood(fresh(), 'fish', Number.NaN).ok).toBe(false);
  });
  it('成交会累积贸易关系与声望', () => {
    let s = buyGood(fresh(), 'fish', 30).state;
    s = sellGood(s, 'fish', 30).state;
    expect(s.relations.hui).toBeGreaterThan(0);
    expect(s.rep).toBeGreaterThan(0);
    expect(s.stats.traded).toBeGreaterThan(0);
  });
  it('出产地进货、需求地卖出能赚钱', () => {
    // 灰檐港产风干鱼，椰影镇紧缺风干鱼
    let s = fresh();
    s = buyGood(s, 'fish', 20).state;
    s = sailTo(s, 'ye');
    s = sellGood(s, 'fish', 20).state;
    expect(s.stats.profit).toBeGreaterThan(60);
  });
});

describe('补给、修理、招人', () => {
  it('补给按港口系数计价，装满为止', () => {
    expect(supplyPrice('qing', 'food')).toBe(2);
    expect(supplyPrice('bing', 'food')).toBe(4);
    const s = fresh();
    const r = buySupply(s, 'food', 999);
    expect(r.ok).toBe(true);
    expect(r.state.ship.food).toBe(70);
    expect(buySupply(r.state, 'food', 1).ok).toBe(false);
  });
  it('补给买不起时按钱数少买', () => {
    const s = fresh();
    s.gold = 7; s.ship.water = 0;
    const r = buySupply(s, 'water', 100);
    expect(r.state.ship.water).toBe(3);
  });
  it('修船按点数收费，不超过船体上限', () => {
    const s = fresh();
    s.ship.hull = 40;
    const r = repairShip(s, 999);
    expect(r.ok).toBe(true);
    expect(r.state.ship.hull).toBe(60);
    expect(r.state.gold).toBe(800 - 20 * repairPrice(s));
    expect(repairShip(r.state, 1).ok).toBe(false);
  });
  it('招人不超过船员上限，声望给折扣', () => {
    const s = fresh();
    expect(recruitPrice(s)).toBe(25);
    s.rep = 10;
    expect(recruitPrice(s)).toBe(23);
    const r = recruit(s, 99);
    expect(r.state.ship.crew).toBe(10);
    expect(recruit(r.state, 1).ok).toBe(false);
  });
  it('遣散至少留一人', () => {
    const r = dismiss(fresh(), 99);
    expect(r.state.ship.crew).toBe(1);
    expect(dismiss(r.state, 1).ok).toBe(false);
  });
});

describe('船坞', () => {
  it('船坞等级和声望限制可买的船', () => {
    const s = fresh();
    expect(canBuildHere(s, 'swallow')).toMatch(/声望/);
    s.rep = 30;
    expect(canBuildHere(s, 'swallow')).toBeNull();
    expect(canBuildHere(s, 'hawk')).toMatch(/船坞造不了/);
    s.docked = 'tong';
    expect(canBuildHere(s, 'hawk')).toBeNull();
  });
  it('换船：折价旧船补差价，货舱装不下则拒绝', () => {
    const s = fresh();
    s.rep = 30; s.gold = 10000;
    const r = buyShip(s, 'swallow');
    expect(r.ok).toBe(true);
    expect(r.state.ship.type).toBe('swallow');
    expect(r.state.ship.hull).toBe(100);
    expect(r.state.gold).toBe(10000 - (5200 - tradeInValue(s)));
    s.cargo = { salt: { qty: 100, cost: 1 } };
    const small = clone(r.state);
    small.cargo = { salt: { qty: 95, cost: 1 } };
    small.docked = 'tong'; small.rep = 30; small.gold = 99999;
    expect(buyShip(small, 'lark').ok).toBe(false);
  });
  it('折价与船体状况有关', () => {
    const s = fresh();
    const full = tradeInValue(s);
    s.ship.hull = 0;
    expect(tradeInValue(s)).toBeLessThan(full);
    expect(full).toBe(900);
  });
  it('钱不够或已经是该船型时失败', () => {
    const s = fresh();
    s.rep = 30; s.gold = 100;
    expect(buyShip(s, 'swallow').ok).toBe(false);
    expect(buyShip(s, 'lark').ok).toBe(false);
  });
  it('换船后船员、补给不超过新船上限', () => {
    const s = fresh();
    s.rep = 30; s.gold = 1e6; s.docked = 'tong';
    const big = buyShip(s, 'whale').state;
    const back = buyShip({ ...big, docked: 'tong' }, 'hawk');
    expect(back.ok).toBe(true);
    expect(back.state.ship.crew).toBeLessThanOrEqual(30);
  });
});

describe('酒馆消息', () => {
  it('请一轮酒收 15 金币并给出若干条消息', () => {
    const r = listenRumors(fresh());
    expect(r.ok).toBe(true);
    expect(r.state.gold).toBe(785);
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
  });
  it('消息提到真实存在的紧缺事件', () => {
    const s = fresh();
    s.events.push({ id: 'x', port: 'ji', good: 'tea', kind: 'shortage', mult: 1.6, until: 99, text: '' });
    expect(rumorLines(s, 'hui').some((l) => l.includes('极光湾') && l.includes('雾山茶'))).toBe(true);
  });
  it('同一天同一港口的消息固定', () => {
    expect(rumorLines(fresh(), 'hui')).toEqual(rumorLines(fresh(), 'hui'));
  });
  it('没钱不能听，海上不能听', () => {
    const s = fresh();
    s.gold = 5;
    expect(listenRumors(s).ok).toBe(false);
    expect(listenRumors(undock(fresh()).state).ok).toBe(false);
  });
});

describe('季度目标', () => {
  it('目标随季度递增', () => {
    const a = makeQuest(0, 0, 0).goals[0].target;
    const b = makeQuest(3, 0, 0).goals[0].target;
    expect(b).toBeGreaterThan(a * 2);
    expect(makeQuest(0, 0, 0).goals[1].kind).toBe('ports');
    expect(makeQuest(1, 0, 0).goals[1].kind).toBe('profit');
    expect(makeQuest(2, 0, 0).goals[1].kind).toBe('rep');
  });
  it('贸易关系目标最多 12 个', () => {
    expect(makeQuest(30, 0, 0).goals.find((g) => g.kind === 'ports')!.target).toBeLessThanOrEqual(12);
  });
  it('文字与季度名', () => {
    expect(goalLabel(makeQuest(0, 0, 0).goals[0])).toBe('资金达到 1500 金币');
    expect(quarterName(0)).toBe('第 1 年春季');
    expect(quarterName(5)).toBe('第 2 年夏季');
  });
  it('贸易伙伴要成交额达到门槛才算', () => {
    const s = fresh();
    s.relations = { hui: REL_MIN - 1, wu: REL_MIN, ji: 999 };
    expect(tradePartners(s)).toBe(2);
    expect(goalProgress(s, { id: 'a', kind: 'ports', target: 3, done: false })).toBe(2);
  });
  it('达成的目标会被记住，之后花钱也不影响', () => {
    const s = fresh();
    s.gold = 1600;
    latchGoals(s);
    expect(s.quest.goals[0].done).toBe(true);
    s.gold = 0;
    latchGoals(s);
    expect(s.quest.goals[0].done).toBe(true);
  });
  it('季度结算：达成给奖金和声望，未达成扣声望，并开始新季度', () => {
    const s = fresh();
    s.rep = 5;
    s.quest.goals[0].done = true;
    closeQuarter(s);
    expect(s.gold).toBe(900);
    expect(s.rep).toBe(5 + 3 - 1);
    expect(s.quest.index).toBe(1);
    expect(s.quest.startT).toBe(DAYS_PER_QUARTER);
    expect(s.stats.questsWon).toBe(1);
    expect(s.stats.questsMissed).toBe(1);
  });
  it('声望扣到 0 为止', () => {
    const s = fresh();
    closeQuarter(s);
    expect(s.rep).toBe(0);
  });
  it('过了 90 天自动结算季度', () => {
    const s = fresh();
    advance(s, 91, false);
    expect(s.quest.index).toBe(1);
    expect(s.log.some((l) => l.includes('结算'))).toBe(true);
  });
  it('一次跨很多天也不会漏掉季度', () => {
    const s = fresh();
    advance(s, 200, false);
    expect(s.quest.index).toBe(2);
  });
  it('dockAt 会登记达成的目标', () => {
    const s = fresh();
    s.gold = 5000;
    dockAt(s, 'wu');
    expect(s.quest.goals[0].done).toBe(true);
  });
});
