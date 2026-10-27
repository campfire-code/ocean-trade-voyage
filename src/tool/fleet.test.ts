import { describe, expect, it } from 'vitest';
import { generateMap } from './mapgen';
import { GUARD_PER_SHIP, MAX_FLEET, dangerAt, effGuns, fleetPace, fleetStepDays, guardCap, makeShip, normalizeFleet, removeCrew } from './fleet';
import {
  buyArmor, buyConsort, buyGood, buyGun, buyShip, buySupply, dismissGuards, hireGuards, nextArmorPrice, recruit, repairNeed, repairShip, sellConsort, sellGun,
} from './trade';
import { advance, clone, newGame, undock, settleWages } from './turn';
import { cargoFree, fleetCargoCap, fleetCrewMax, fleetSupplyCap, people, totalCrew, type GameState } from './state';
import { dailySupply, windAt } from './sailing';
import { SHIPS } from './world';

const map = generateMap();
const rich = (): GameState => {
  const s = newGame(map, 1, '测试');
  s.gold = 100000;
  s.rep = 30;
  return s;
};
const fleet3 = (): GameState => {
  let s = rich();
  s = buyConsort(s, 'swallow').state;
  s = buyConsort(s, 'lark').state;
  return s;
};

describe('船队编成', () => {
  it('最多 3 艘，满了再买被拒', () => {
    const s = fleet3();
    expect(s.consorts).toHaveLength(MAX_FLEET - 1);
    const r = buyConsort(s, 'lark');
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/最多/);
  });
  it('买僚船：扣船价加最低船员工资，船名不重复', () => {
    const s = rich();
    const r = buyConsort(s, 'swallow');
    expect(r.ok).toBe(true);
    const sw = SHIPS.find((x) => x.id === 'swallow')!;
    expect(r.state.gold).toBeLessThan(s.gold - sw.price + 1);
    expect(r.state.consorts[0].crew).toBe(sw.crewMin);
    const s3 = buyConsort(r.state, 'lark').state;
    expect(new Set([s3.ship.name, ...s3.consorts.map((c) => c.name)]).size).toBe(3);
  });
  it('钱不够、声望不够、需要在港里，都会被拒', () => {
    const poor = newGame(map, 1);
    expect(buyConsort(poor, 'swallow').ok).toBe(false);
    const lowRep = rich(); lowRep.rep = 0;
    expect(buyConsort(lowRep, 'swallow').msg).toMatch(/声望/);
    expect(buyConsort(undock(rich()).state, 'lark').ok).toBe(false);
  });
  it('载货与补给容量是全队之和', () => {
    const s = fleet3();
    expect(fleetCargoCap(s)).toBe(40 + 90 + 40);
    expect(fleetSupplyCap(s)).toBe(70 + 150 + 70);
    expect(fleetCrewMax(s)).toBe(10 + 22 + 10);
  });
  it('货舱按全队容量买货，补给按全队容量补', () => {
    let s = fleet3();
    s = buyGood(s, 'fish', 999).state;
    expect(s.cargo.fish.qty).toBe(170);
    expect(cargoFree(s)).toBe(0);
    s = buySupply(s, 'food', 9999).state;
    expect(s.ship.food).toBe(290);
  });
  it('食物和水的消耗按全队人数（船员加护卫）', () => {
    const s = fleet3();
    s.guards = 4;
    expect(people(s)).toBe(totalCrew(s) + 4);
    s.ship.food = 200; s.ship.water = 200;
    const t = undock(s).state;
    advance(t, 1, true, true);
    expect(200 - t.ship.food).toBe(dailySupply(people(s)));
  });
  it('工资按全队船员加护卫（护卫每天 1 金币）', () => {
    const s = fleet3();
    s.guards = 2;
    s.wageDue = 0;
    advance(s, 1, false);
    expect(s.wageDue).toBeCloseTo(totalCrew(s) * 0.5 + 2, 5);
    const before = s.gold;
    settleWages(s);
    expect(s.gold).toBe(before - Math.ceil(totalCrew(s) * 0.5 + 2));
  });
  it('卖僚船：回收折价款，货舱装不下时不让卖', () => {
    let s = fleet3();
    const g0 = s.gold;
    const r = sellConsort(s, 0);
    expect(r.ok).toBe(true);
    expect(r.state.consorts).toHaveLength(1);
    expect(r.state.gold).toBeGreaterThan(g0);
    s = buyGood(s, 'salt', 999).state;
    expect(sellConsort(s, 0).ok).toBe(false);
    expect(sellConsort(rich(), 0).ok).toBe(false);
  });
  it('换旗舰：补差价，炮超出炮位的折价回收，补给截断到新容量', () => {
    let s = rich();
    s = buyShip(s, 'swallow').state;
    expect(s.ship.type).toBe('swallow');
    expect(s.ship.guns).toBe(2);
    expect(s.gold).toBeLessThan(100000);
    // 双桅燕有 5 个炮位，换回 3 个炮位的雀鹞艇时，多出的炮折价回收
    s.ship.guns = 5;
    const back = buyShip(s, 'lark');
    expect(back.ok).toBe(true);
    expect(back.state.ship.guns).toBe(3);
    expect(back.msg).toMatch(/多出的 2 门炮/);
  });
});

describe('航速与危险度', () => {
  it('船队航速取最慢的一艘', () => {
    const solo = rich();
    const f = fleet3();
    const wind = windAt(1, 0);
    const a = fleetStepDays(solo, 2, wind, false);
    const slow = clone(f);
    slow.consorts = [makeShip('whale', '慢船', 40)];
    const b = fleetStepDays(slow, 2, wind, false);
    expect(b).toBeGreaterThan(a);
  });
  it('只有一艘船时航速与单船一致', () => {
    const s = rich();
    expect(fleetPace(s)).toBeGreaterThan(0.6);
    expect(fleetPace(s)).toBeLessThanOrEqual(1);
  });
  it('船员少航速慢：补满船员后更快', () => {
    const s = rich();
    const wind = windAt(1, 0);
    const before = fleetStepDays(s, 2, wind, false);
    const t = recruit(s, 99).state;
    expect(fleetStepDays(t, 2, wind, false)).toBeLessThan(before);
  });
  it('离港越远越危险，赤沙海岸比朝雾群屿危险', () => {
    expect(dangerAt([44, 26])).toBeGreaterThan(dangerAt([8, 7]));
    expect(dangerAt([31, 25])).toBeGreaterThan(dangerAt([9, 8]));
    expect(dangerAt([8, 7])).toBeGreaterThan(0);
  });
});

describe('船员伤亡与脱队', () => {
  it('扣船员从人最多的船开始，每艘船至少留 1 人', () => {
    const s = fleet3();
    s.ship.crew = 6; s.consorts[0].crew = 10; s.consorts[1].crew = 4;
    expect(removeCrew(s, 6)).toBe(6);
    expect([s.ship.crew, s.consorts[0].crew, s.consorts[1].crew]).toEqual([5, 5, 4]);
    expect(removeCrew(s, 999)).toBeGreaterThan(0);
    expect([s.ship.crew, ...s.consorts.map((c) => c.crew)]).toEqual([1, 1, 1]);
    expect(removeCrew(s, 5)).toBe(0);
  });
  it('僚船沉没后脱队，货舱缩小则丢货', () => {
    const s = fleet3();
    s.cargo = { salt: { qty: 150, cost: 10 } };
    s.consorts[0].hull = 0;
    const r = normalizeFleet(s);
    expect(r.wiped).toBe(false);
    expect(s.consorts).toHaveLength(1);
    expect(s.cargo.salt.qty).toBeLessThanOrEqual(80);
    expect(s.log.some((l) => l.includes('沉没'))).toBe(true);
  });
  it('僚船人手不足也会脱队', () => {
    const s = fleet3();
    s.consorts[0].crew = 1;
    normalizeFleet(s);
    expect(s.consorts.map((c) => c.type)).toEqual(['lark']);
  });
  it('旗舰沉没：僚船接任旗舰并继承补给', () => {
    const s = fleet3();
    s.ship.hull = 0;
    s.ship.food = 33; s.ship.water = 22;
    const second = s.consorts[0].name;
    const r = normalizeFleet(s);
    expect(r.wiped).toBe(false);
    expect(s.ship.name).toBe(second);
    expect(s.ship.food).toBe(33);
    expect(s.ship.water).toBe(22);
    expect(s.consorts).toHaveLength(1);
  });
  it('只剩一艘旗舰且不能航行时，判定整队覆没', () => {
    const s = rich();
    s.ship.crew = 2;
    expect(normalizeFleet(s).wiped).toBe(true);
    const t = rich();
    t.ship.hull = 0;
    expect(normalizeFleet(t).wiped).toBe(true);
    expect(normalizeFleet(rich()).wiped).toBe(false);
  });
  it('补给超过新容量会被截断，护卫超过新上限会被遣散', () => {
    const s = fleet3();
    s.ship.food = 290; s.ship.water = 290; s.guards = 12;
    s.consorts[0].hull = 0;
    normalizeFleet(s);
    expect(s.ship.food).toBeLessThanOrEqual(fleetSupplyCap(s));
    expect(s.guards).toBeLessThanOrEqual(guardCap(s));
  });
});

describe('装备、护卫与修理', () => {
  it('火炮：买到炮位满为止，也能卖回半价', () => {
    let s = rich();
    s = buyGun(s, 0).state;
    expect(s.ship.guns).toBe(3);
    const full = buyGun(s, 0);
    expect(full.ok).toBe(false);
    expect(full.msg).toMatch(/炮位/);
    const r = sellGun(s, 0);
    expect(r.state.ship.guns).toBe(2);
    expect(r.state.gold).toBe(s.gold + 45);
    expect(sellGun({ ...s, ship: { ...s.ship, guns: 0 } }, 0).ok).toBe(false);
  });
  it('可以给僚船买炮，编号越界被拒', () => {
    let s = fleet3();
    s = buyGun(s, 1).state;
    expect(s.consorts[0].guns).toBe(1);
    expect(buyGun(s, 7).ok).toBe(false);
  });
  it('炮手不够，多买的炮发挥不出（每 2 人 1 门）', () => {
    const s = rich();
    s.ship.guns = 3;
    s.ship.crew = 3;
    expect(effGuns(s.ship)).toBe(1);
    s.ship.crew = 8;
    expect(effGuns(s.ship)).toBe(3);
  });
  it('装甲：分两级、越贵，最高 2 级，钱不够被拒', () => {
    let s = rich();
    const p1 = nextArmorPrice(s, 0);
    s = buyArmor(s, 0).state;
    expect(s.ship.armor).toBe(1);
    expect(nextArmorPrice(s, 0)).toBeGreaterThan(0);
    s = buyArmor(s, 0).state;
    expect(s.ship.armor).toBe(2);
    expect(buyArmor(s, 0).ok).toBe(false);
    expect(p1).toBe(200);
    const poor = newGame(map, 1); poor.gold = 10;
    expect(buyArmor(poor, 0).ok).toBe(false);
  });
  it('护卫：每艘船最多 4 名，随船数增加上限', () => {
    let s = rich();
    expect(guardCap(s)).toBe(GUARD_PER_SHIP);
    s = hireGuards(s, 99).state;
    expect(s.guards).toBe(4);
    expect(hireGuards(s, 1).ok).toBe(false);
    s = buyConsort(s, 'lark').state;
    expect(guardCap(s)).toBe(8);
    s = dismissGuards(s, 3).state;
    expect(s.guards).toBe(1);
    expect(dismissGuards(newGame(map, 1), 1).ok).toBe(false);
  });
  it('护卫要钱，钱不够就少雇', () => {
    const s = newGame(map, 1);
    s.gold = 90;
    const r = hireGuards(s, 4);
    expect(r.state.guards).toBe(2);
    expect(r.state.gold).toBe(10);
  });
  it('招募可指定船；遣散至少留 1 人', () => {
    const s = fleet3();
    const r = recruit(s, 3, 1);
    expect(r.state.consorts[0].crew).toBe(s.consorts[0].crew + 3);
    expect(recruit(s, 1, 9).ok).toBe(false);
  });
  it('修船覆盖全队，按各船价格结算', () => {
    const s = fleet3();
    s.ship.hull = 40; s.consorts[0].hull = 50; s.consorts[1].hull = 30;
    const need = repairNeed(s);
    expect(need.points).toBe(20 + 50 + 30);
    const r = repairShip(s, 9999);
    expect(r.state.ship.hull).toBe(60);
    expect(r.state.consorts[0].hull).toBe(100);
    expect(r.state.gold).toBe(s.gold - need.cost);
    expect(repairShip(r.state, 10).ok).toBe(false);
  });
});
