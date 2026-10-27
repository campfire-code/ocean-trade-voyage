// 存档的序列化与校验。存档是 JSON 文本，读回来时逐项检查，坏档不会让游戏崩溃。
import { dateText, type CargoItem, type Combat, type GameState, type Goal, type GoalKind, type PortCond, type Scene, type Ship } from './state';
import { FOE_BY_ID } from './foes';
import { COND_NAME } from './events';
import { CHAPTERS } from './story';
import { ARMOR_MAX, GUARD_PER_SHIP, MAX_FLEET } from './fleet';
import { GOOD_BY_ID, PORT_BY_ID, SHIP_BY_ID } from './world';
import type { EventKind, MarketEvent } from './pricing';
import { MAP_H, MAP_W } from './world';
import { quarterName } from './quest';

export const SAVE_VERSION = 2;
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

/**
 * 把旧版存档升级到当前格式（返回新对象，不改传入的）。
 * v1（0.1.x）→ v2：旗舰补上 2 门火炮、无装甲，没有僚船和护卫，港口状态为空，主线从第 1 章开始，战斗统计清零。
 */
export function migrateState(raw: unknown): unknown {
  if (!isObj(raw) || raw.v !== 1) return raw;
  const o = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (isObj(o.ship)) o.ship = { guns: 2, armor: 0, ...o.ship };
  const st = isObj(o.stats) ? o.stats : {};
  o.stats = { battlesWon: 0, battlesLost: 0, fled: 0, paid: 0, reliefDay: 0, ...st };
  o.consorts = [];
  o.guards = 0;
  o.conds = [];
  o.story = { chapter: 0, started: false, step: 0, base: 0, done: false };
  o.scene = null;
  o.combat = null;
  o.v = 2;
  return o;
}

function readShip(v: unknown, what: string, main: boolean): Ship {
  if (!isObj(v)) throw new Error(`存档损坏：${what}不合法`);
  const type = SHIP_BY_ID[str(v.type, '船型')];
  if (!type) throw new Error('存档损坏：未知船型');
  const guns = num(v.guns, '火炮数', 0, type.gunSlots), armor = num(v.armor, '装甲', 0, ARMOR_MAX);
  if (!Number.isInteger(guns) || !Number.isInteger(armor)) throw new Error('存档损坏：装备不是整数');
  const crew = num(v.crew, '船员', 1, type.crewMax);
  if (!Number.isInteger(crew)) throw new Error('存档损坏：船员不是整数');
  return {
    type: type.id, name: str(v.name, '船名').slice(0, 20), hull: num(v.hull, '船体', 0, type.hull), crew,
    food: main ? num(v.food, '食物', 0, 100000) : 0, water: main ? num(v.water, '淡水', 0, 100000) : 0, guns, armor,
  };
}

function readCombat(v: unknown): Combat | null {
  if (v === null) return null;
  if (!isObj(v) || !isObj(v.foe)) throw new Error('存档损坏：战斗不合法');
  const f = v.foe;
  const def = FOE_BY_ID[str(f.def, '敌船类型')];
  if (!def) throw new Error('存档损坏：未知敌船');
  const dist = num(v.dist, '距离', 1, 4);
  if (!Number.isInteger(dist)) throw new Error('存档损坏：距离不是整数');
  let done: Combat['done'] = null;
  if (v.done !== null && v.done !== undefined) {
    if (!isObj(v.done)) throw new Error('存档损坏：战斗结果不合法');
    const oc = str(v.done.outcome, '战斗结果');
    if (!['won-sunk', 'won-boarded', 'foe-fled', 'fled', 'paid', 'lost-boarded', 'sunk', 'standoff'].includes(oc)) throw new Error('存档损坏：战斗结果未知');
    done = { outcome: oc as NonNullable<Combat['done']>['outcome'], text: str(v.done.text, '战斗结果文字'), gold: num(v.done.gold, '战利品') };
  }
  return {
    foe: {
      def: def.id, name: str(f.name, '敌船名'), hull: num(f.hull, '敌船体', 0), hullMax: num(f.hullMax, '敌船体上限', 1),
      crew: num(f.crew, '敌船员', 0), crewMax: num(f.crewMax, '敌船员上限', 1), guns: num(f.guns, '敌火炮', 0),
    },
    dist: dist as Combat['dist'], gauge: v.gauge === true, round: num(v.round, '回合', 0), seq: num(v.seq, '随机计数', 0), rseed: num(v.rseed, '战斗种子'),
    log: Array.isArray(v.log) ? v.log.filter((l): l is string => typeof l === 'string').slice(-30) : [], done,
  };
}

export function validateState(input: unknown): GameState {
  const raw = migrateState(input);
  if (!isObj(raw)) throw new Error('存档损坏：内容不是对象');
  if (raw.v !== SAVE_VERSION) throw new Error(`存档版本不支持（${String(raw.v)}）`);
  const ship = readShip(raw.ship, '旗舰', true);
  const consortsRaw = Array.isArray(raw.consorts) ? raw.consorts : (() => { throw new Error('存档损坏：缺少僚船'); })();
  if (consortsRaw.length > MAX_FLEET - 1) throw new Error('存档损坏：僚船太多');
  const consorts = consortsRaw.map((c) => readShip(c, '僚船', false));
  const fleet = [ship, ...consorts];
  const guards = num(raw.guards, '护卫数', 0, GUARD_PER_SHIP * fleet.length);
  if (!Number.isInteger(guards)) throw new Error('存档损坏：护卫数不是整数');
  const supplyCap = fleet.reduce((a, x) => a + SHIP_BY_ID[x.type].supply, 0);
  if (ship.food > supplyCap || ship.water > supplyCap) throw new Error('存档损坏：补给超出容量');
  const cargoCap = fleet.reduce((a, x) => a + SHIP_BY_ID[x.type].cargo, 0);
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
  if (used > cargoCap) throw new Error('存档损坏：货物超出货舱');

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
  const conds: PortCond[] = [];
  if (!Array.isArray(raw.conds)) throw new Error('存档损坏：缺少港口状态');
  for (const c of raw.conds) {
    if (!isObj(c) || !PORT_BY_ID[str(c.port, '状态港口')] || !(str(c.kind, '状态类型') in COND_NAME)) throw new Error('存档损坏：港口状态不合法');
    conds.push({ id: str(c.id, '状态编号'), port: c.port as string, kind: c.kind as PortCond['kind'], until: num(c.until, '状态期限'), text: str(c.text, '状态文字') });
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
  const sy = raw.story;
  if (!isObj(sy)) throw new Error('存档损坏：缺少主线进度');
  const chapter = num(sy.chapter, '主线章节', 0, CHAPTERS.length - 1);
  const step = num(sy.step, '主线步骤', 0, 5);
  if (!Number.isInteger(chapter) || !Number.isInteger(step)) throw new Error('存档损坏：主线进度不是整数');
  let scene: Scene | null = null;
  if (raw.scene !== null && raw.scene !== undefined) {
    const sc = raw.scene;
    if (!isObj(sc) || !Array.isArray(sc.choices)) throw new Error('存档损坏：场景不合法');
    scene = { id: str(sc.id, '场景编号'), title: str(sc.title, '场景标题'), text: str(sc.text, '场景文字'), choices: sc.choices.map((c) => str(c, '场景选项')) };
  }
  const st = isObj(raw.stats) ? raw.stats : {};
  const logArr = Array.isArray(raw.log) ? raw.log.filter((l): l is string => typeof l === 'string').slice(-40) : [];

  return {
    v: 2,
    seed: num(raw.seed, '种子'),
    captain: str(raw.captain, '船长名').slice(0, 20),
    t: num(raw.t, '时间', 0),
    pos: [x, y],
    docked,
    gold: num(raw.gold, '资金'),
    rep: num(raw.rep, '声望', 0),
    ship, consorts, guards,
    cargo, stock, events, conds, relations,
    wageDue: num(raw.wageDue, '待发工资', 0),
    quest: { index: num(q.index, '季度序号', 0), startT: num(q.startT, '季度起点', 0), goals, profitBase: num(q.profitBase, '利润基线') },
    story: { chapter, started: sy.started === true, step, base: num(sy.base ?? 0, '主线基线', 0), done: sy.done === true },
    scene,
    combat: readCombat(raw.combat === undefined ? null : raw.combat),
    stats: {
      traded: num(st.traded ?? 0, '成交额', 0), profit: num(st.profit ?? 0, '利润'), sailedDays: num(st.sailedDays ?? 0, '航行天数', 0),
      questsWon: num(st.questsWon ?? 0, '达成目标数', 0), questsMissed: num(st.questsMissed ?? 0, '未达成数', 0), rescued: num(st.rescued ?? 0, '被救次数', 0),
      battlesWon: num(st.battlesWon ?? 0, '胜仗数', 0), battlesLost: num(st.battlesLost ?? 0, '败仗数', 0), fled: num(st.fled ?? 0, '撤退数', 0), paid: num(st.paid ?? 0, '买路次数', 0), reliefDay: num(st.reliefDay ?? 0, '救济日期', 0),
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
