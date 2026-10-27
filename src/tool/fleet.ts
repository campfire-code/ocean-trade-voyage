// 船队：最多 3 艘船编队航行，载货与补给合并，航速取最慢的一艘；船员伤亡、沉没与脱队的处理。
import { clamp, round2 } from './rng';
import { DIRS, crewFactor, hullFactor, windFactor, type Wind } from './sailing';
import { GOOD_BY_ID, PORTS, SHIP_BY_ID, type PortDef } from './world';
import { cargoUsed, fleetCargoCap, fleetShips, fleetSupplyCap, pushLog, typeOf, type GameState, type Ship } from './state';

export const MAX_FLEET = 3;
export const GUN_PRICE = 90;
export const ARMOR_MAX = 2;
export const GUARD_PRICE = 40;
export const GUARD_PER_SHIP = 4;

export const armorPrice = (ship: Ship, level: number) => 200 * typeOf(ship).tier * level;
export const guardCap = (s: GameState) => GUARD_PER_SHIP * fleetShips(s).length;

export function makeShip(typeId: string, name: string, crew: number, guns = 0): Ship {
  const t = SHIP_BY_ID[typeId];
  return { type: t.id, name, hull: t.hull, crew, food: 0, water: 0, guns, armor: 0 };
}

/** 一艘船此刻的有效航速（格/天，不含风） */
export function baseSpeed(ship: Ship): number {
  const t = typeOf(ship);
  return t.speed * crewFactor(ship.crew, t) * hullFactor(ship.hull, t);
}

/** 整支船队走一步要多少天：每艘船各算一遍，取最慢的 */
export function fleetStepDays(s: GameState, heading: number, wind: Wind, shallow: boolean): number {
  const d = DIRS[heading];
  const dist = d[0] !== 0 && d[1] !== 0 ? Math.SQRT2 : 1;
  let v = Infinity;
  for (const sh of fleetShips(s)) {
    const t = typeOf(sh);
    v = Math.min(v, baseSpeed(sh) * windFactor(heading, wind, t.upwind) * (shallow ? 0.85 : 1));
  }
  return dist / Math.max(v, 0.2);
}

/** 整支船队的相对航速（1 = 雀鹞艇满员无风），海战里用来比追逃 */
export function fleetPace(s: GameState): number {
  return Math.min(...fleetShips(s).map(baseSpeed)) / SHIP_BY_ID.lark.speed;
}

/** 一艘船真正能开火的炮数：每 2 个船员操作 1 门 */
export const effGuns = (ship: Ship) => Math.min(ship.guns, Math.floor(ship.crew / 2));
export const fleetGuns = (s: GameState) => fleetShips(s).reduce((a, x) => a + effGuns(x), 0);
export const fleetGunCount = (s: GameState) => fleetShips(s).reduce((a, x) => a + x.guns, 0);
/** 登船肉搏的战力：船员 1，护卫 2.5 */
export const meleePower = (s: GameState, crew = fleetShips(s).reduce((a, x) => a + x.crew, 0)) => crew + s.guards * 2.5;

/** 扣船员：每次从人最多的船上扣，每艘船至少留 1 人。返回实际扣了几个。 */
export function removeCrew(s: GameState, n: number): number {
  let done = 0;
  const ships = fleetShips(s);
  while (done < n) {
    const top = [...ships].sort((a, b) => b.crew - a.crew)[0];
    if (!top || top.crew <= 1) break;
    top.crew -= 1;
    done += 1;
  }
  return done;
}

/** 货舱装不下时按价值从低到高丢货 */
function trimCargo(s: GameState): string | null {
  const cap = fleetCargoCap(s);
  if (cargoUsed(s) <= cap) return null;
  const ids = Object.keys(s.cargo).sort((a, b) => GOOD_BY_ID[a].base - GOOD_BY_ID[b].base);
  let lost = 0;
  for (const id of ids) {
    while (s.cargo[id] && cargoUsed(s) > cap) {
      s.cargo[id].qty -= 1;
      lost += 1;
      if (s.cargo[id].qty <= 0) delete s.cargo[id];
    }
    if (cargoUsed(s) <= cap) break;
  }
  return `货舱缩小，丢掉了 ${lost} 件货物`;
}

export interface NormalizeResult { wiped: boolean }

/**
 * 每次伤亡后调用：船体归零或人手不足的僚船脱队，旗舰失去战斗力时由僚船接任；
 * 补给与货物按新的容量截断。整支船队都没了（旗舰也不行且没有僚船）返回 wiped，由调用方做救援。
 */
export function normalizeFleet(s: GameState): NormalizeResult {
  const bad = (x: Ship) => x.hull <= 0 || x.crew < typeOf(x).crewMin;
  const kept = s.consorts.filter((c) => {
    if (!bad(c)) return true;
    pushLog(s, c.hull <= 0 ? `僚船「${c.name}」沉没了` : `僚船「${c.name}」人手不足，脱离了船队`);
    return false;
  });
  s.consorts = kept;
  if (bad(s.ship)) {
    if (!s.consorts.length) return { wiped: true };
    const old = s.ship;
    const next = s.consorts.shift()!;
    next.food = old.food;
    next.water = old.water;
    s.ship = next;
    pushLog(s, old.hull <= 0 ? `旗舰「${old.name}」沉没，「${next.name}」接任旗舰` : `旗舰「${old.name}」人手不足脱队，「${next.name}」接任旗舰`);
  }
  const sup = fleetSupplyCap(s);
  s.ship.food = Math.min(s.ship.food, sup);
  s.ship.water = Math.min(s.ship.water, sup);
  const cap = fleetCargoCap(s);
  s.guards = Math.min(s.guards, guardCap(s));
  const msg = cargoUsed(s) > cap ? trimCargo(s) : null;
  if (msg) pushLog(s, msg);
  return { wiped: false };
}

// ---------------- 危险度 ----------------

const REGION_DANGER: Record<string, number> = { mist: 0.5, frost: 0.9, jade: 0.9, sand: 1.1 };

/** 海上某位置的危险度：离港越远越险，赤沙海岸一带海盗最多 */
export function dangerAt(pos: [number, number]): number {
  let best: PortDef = PORTS[0];
  let bd = Infinity;
  for (const p of PORTS) {
    const d = Math.hypot(p.x - pos[0], p.y - pos[1]);
    if (d < bd) { bd = d; best = p; }
  }
  return round2(REGION_DANGER[best.region] * (1 + clamp(bd - 4, 0, 10) / 10));
}

export const cargoValue = (s: GameState) => Object.values(s.cargo).reduce((a, c) => a + c.qty * c.cost, 0);
