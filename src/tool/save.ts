// 存档的序列化与校验。存档是 JSON 文本，读回来时逐项检查，坏档不会让游戏崩溃。
import { dateText, type CargoItem, type GameState, type Goal, type GoalKind } from './state';
import { GOOD_BY_ID, PORT_BY_ID, SHIP_BY_ID } from './world';
import type { EventKind, MarketEvent } from './pricing';
import { MAP_H, MAP_W } from './world';
import { quarterName } from './quest';

export const SAVE_VERSION = 1;
export const SLOT_COUNT = 5;
const APP = 'x01-ocean-trade';

export interface SaveSummary { captain: string; shipName: string; gold: number; rep: number; date: string; quarter: string; savedAt: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string, lo = -Infinity, hi = Infinity): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`存档损坏：${what} 不合法`);
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`存档损坏：${what} 不合法`);
  return v;
};

export function validateState(raw: unknown): GameState {
  if (!isObj(raw)) throw new Error('存档损坏：内容不是对象');
  if (raw.v !== SAVE_VERSION) throw new Error(`存档版本不支持（${String(raw.v)}）`);
  const ship = raw.ship;
  if (!isObj(ship)) throw new Error('存档损坏：缺少船只');
  const type = SHIP_BY_ID[str(ship.type, '船型')];
  if (!type) throw new Error('存档损坏：未知船型');
  const pos = raw.pos;
  if (!Array.isArray(pos) || pos.length !== 2) throw new Error('存档损坏：位置不合法');
  const x = num(pos[0], '位置 x', 0, MAP_W - 1), y = num(pos[1], '位置 y', 0, MAP_H - 1);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('存档损坏：位置不是整数格');
  const docked = raw.docked === null ? null : str(raw.docked, '停靠港');
  if (docked !== null && !PORT_BY_ID[docked]) throw new Error('存档损坏：未知港口');

  const cargo: Record<string, CargoItem> = {};
  if (!isObj(raw.cargo)) throw new Error('存档损坏：缺少货物');
  for (const [id, c] of Object.entries(raw.cargo)) {
    if (!GOOD_BY_ID[id] || !isObj(c)) throw new Error('存档损坏：未知货物');
    const qty = num(c.qty, '货物数量', 0);
    if (!Number.isInteger(qty)) throw new Error('存档损坏：货物数量不是整数');
    if (qty > 0) cargo[id] = { qty, cost: num(c.cost, '货物成本', 0) };
  }
  const used = Object.entries(cargo).reduce((a, [id, c]) => a + c.qty * GOOD_BY_ID[id].size, 0);
  if (used > type.cargo) throw new Error('存档损坏：货物超出货舱');

  if (!isObj(raw.stock)) throw new Error('存档损坏：缺少行情');
  const stock: GameState['stock'] = {};
  for (const pid of Object.keys(PORT_BY_ID)) {
    const row = (raw.stock as Record<string, unknown>)[pid];
    if (!isObj(row)) throw new Error(`存档损坏：缺少 ${pid} 的行情`);
    stock[pid] = {};
    for (const gid of Object.keys(GOOD_BY_ID)) stock[pid][gid] = num(row[gid], `${pid}/${gid} 库存`, 0);
  }

  const events: MarketEvent[] = [];
  if (!Array.isArray(raw.events)) throw new Error('存档损坏：缺少事件');
  for (const e of raw.events) {
    if (!isObj(e) || !PORT_BY_ID[str(e.port, '事件港口')] || !GOOD_BY_ID[str(e.good, '事件商品')]) throw new Error('存档损坏：事件不合法');
    if (!['shortage', 'glut', 'festival'].includes(str(e.kind, '事件类型'))) throw new Error('存档损坏：事件类型不合法');
    events.push({ id: str(e.id, '事件编号'), port: e.port as string, good: e.good as MarketEvent['good'], kind: e.kind as EventKind, mult: num(e.mult, '事件系数', 0.1, 10), until: num(e.until, '事件期限'), text: str(e.text, '事件文字') });
  }

  const relations: Record<string, number> = {};
  if (!isObj(raw.relations)) throw new Error('存档损坏：缺少贸易关系');
  for (const [k, v] of Object.entries(raw.relations)) if (PORT_BY_ID[k]) relations[k] = num(v, '贸易关系', 0);

  const q = raw.quest;
  if (!isObj(q) || !Array.isArray(q.goals)) throw new Error('存档损坏：缺少季度目标');
  const goals: Goal[] = q.goals.map((g) => {
    if (!isObj(g) || !['gold', 'ports', 'profit', 'rep'].includes(str(g.kind, '目标类型'))) throw new Error('存档损坏：目标不合法');
    return { id: str(g.id, '目标编号'), kind: g.kind as GoalKind, target: num(g.target, '目标值', 0), done: g.done === true };
  });
  const st = isObj(raw.stats) ? raw.stats : {};
  const logArr = Array.isArray(raw.log) ? raw.log.filter((l): l is string => typeof l === 'string').slice(-40) : [];

  return {
    v: 1,
    seed: num(raw.seed, '种子'),
    captain: str(raw.captain, '船长名').slice(0, 20),
    t: num(raw.t, '时间', 0),
    pos: [x, y],
    docked,
    gold: num(raw.gold, '资金'),
    rep: num(raw.rep, '声望', 0),
    ship: {
      type: type.id,
      name: str(ship.name, '船名').slice(0, 20),
      hull: num(ship.hull, '船体', 0, type.hull),
      crew: num(ship.crew, '船员', 1, type.crewMax),
      food: num(ship.food, '食物', 0, type.supply),
      water: num(ship.water, '淡水', 0, type.supply),
    },
    cargo, stock, events, relations,
    wageDue: num(raw.wageDue, '待发工资', 0),
    quest: { index: num(q.index, '季度序号', 0), startT: num(q.startT, '季度起点', 0), goals, profitBase: num(q.profitBase, '利润基线') },
    stats: {
      traded: num(st.traded ?? 0, '成交额', 0), profit: num(st.profit ?? 0, '利润'), sailedDays: num(st.sailedDays ?? 0, '航行天数', 0),
      questsWon: num(st.questsWon ?? 0, '达成目标数', 0), questsMissed: num(st.questsMissed ?? 0, '未达成数', 0), rescued: num(st.rescued ?? 0, '被救次数', 0),
    },
    log: logArr,
  };
}

export function serializeSave(state: GameState, savedAt = new Date().toISOString()): string {
  return JSON.stringify({ app: APP, version: SAVE_VERSION, savedAt, state });
}

export type ParseResult = { ok: true; state: GameState; savedAt: string } | { ok: false; error: string };

export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '存档不是有效的 JSON' };
  }
  if (!isObj(raw) || raw.app !== APP) return { ok: false, error: '这不是本游戏的存档' };
  try {
    return { ok: true, state: validateState(raw.state), savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function summarize(state: GameState, savedAt: string): SaveSummary {
  return {
    captain: state.captain, shipName: state.ship.name, gold: Math.round(state.gold), rep: Math.floor(state.rep),
    date: dateText(state.t), quarter: quarterName(state.quest.index), savedAt,
  };
}

/** 存档位：slot 1～SLOT_COUNT，值是存档文本 */
export type Slots = Record<string, string>;

export function putSlot(slots: Slots, slot: number, state: GameState, savedAt?: string): Slots {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) throw new Error(`存档位只有 1～${SLOT_COUNT}`);
  return { ...slots, [String(slot)]: serializeSave(state, savedAt) };
}
export function dropSlot(slots: Slots, slot: number): Slots {
  const next = { ...slots };
  delete next[String(slot)];
  return next;
}
export function readSlot(slots: Slots, slot: number): ParseResult {
  const t = slots[String(slot)];
  return t ? parseSave(t) : { ok: false, error: '这个存档位是空的' };
}

/** 自动存档单独占一格（键 auto），不占用 1～5 号存档位 */
export const AUTO_KEY = 'auto';
export const putAuto = (slots: Slots, state: GameState, savedAt?: string): Slots => ({ ...slots, [AUTO_KEY]: serializeSave(state, savedAt) });
export const readAuto = (slots: Slots): ParseResult => (slots[AUTO_KEY] ? parseSave(slots[AUTO_KEY]) : { ok: false, error: '没有自动存档' });
