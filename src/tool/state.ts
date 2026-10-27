// 游戏状态的类型与初始化。状态是纯 JSON，可以直接存档。
import type { MarketEvent } from './pricing';
import { GOODS, SHIP_BY_ID, type ShipType } from './world';

/** 一艘船。食物与淡水是整支船队合并计算的，只记在旗舰（state.ship）上，僚船的这两项恒为 0。 */
export interface Ship { type: string; name: string; hull: number; crew: number; food: number; water: number; guns: number; armor: number }
export interface CargoItem { qty: number; cost: number }
export type GoalKind = 'gold' | 'ports' | 'profit' | 'rep';
export interface Goal { id: string; kind: GoalKind; target: number; done: boolean }
export interface Quest { index: number; startT: number; goals: Goal[]; profitBase: number }
export interface Stats {
  traded: number; profit: number; sailedDays: number; questsWon: number; questsMissed: number; rescued: number;
  battlesWon: number; battlesLost: number; fled: number; paid: number;
  /** 上次领到港务官救济的日期 */
  reliefDay: number;
}

/** 港口状态：庆典、封港、瘟疫 */
export type CondKind = 'festival' | 'blockade' | 'plague';
export interface PortCond { id: string; port: string; kind: CondKind; until: number; text: string }

/** 海战里的敌船 */
export interface Foe {
  def: string; name: string; hull: number; hullMax: number; crew: number; crewMax: number; guns: number;
}
export interface BattleResult {
  outcome: 'won-sunk' | 'won-boarded' | 'foe-fled' | 'fled' | 'paid' | 'lost-boarded' | 'sunk' | 'standoff';
  text: string;
  gold: number;
}
export interface Combat {
  foe: Foe;
  /** 1 = 贴舷（可接舷），4 = 远 */
  dist: 1 | 2 | 3 | 4;
  /** 我方是否占上风 */
  gauge: boolean;
  round: number;
  /** 随机数计数器，保证存档读回来结果一致 */
  seq: number;
  rseed: number;
  log: string[];
  done: BattleResult | null;
}

/** 等待玩家选择的场景（随机事件、主线剧情） */
export interface Scene { id: string; title: string; text: string; choices: string[] }

export interface StoryState {
  /** 当前章（0 起）；done 为真表示全部完成 */
  chapter: number;
  started: boolean;
  step: number;
  /** 本步开始时的胜仗数，用于「击败 N 支」 */
  base: number;
  done: boolean;
}

export interface GameState {
  v: 2;
  seed: number;
  captain: string;
  /** 已过的天数（带小数），第 1 天从 0 开始 */
  t: number;
  pos: [number, number];
  /** 当前靠在哪个港口，海上为 null */
  docked: string | null;
  gold: number;
  rep: number;
  /** 旗舰 */
  ship: Ship;
  /** 僚船（最多 2 艘，加上旗舰共 3 艘） */
  consorts: Ship[];
  /** 雇来的护卫（不占船员名额，战斗力强，每天工资 1 金币） */
  guards: number;
  cargo: Record<string, CargoItem>;
  stock: Record<string, Record<string, number>>;
  events: MarketEvent[];
  conds: PortCond[];
  /** 各港口累计成交额（金币），达到 300 算建立贸易关系 */
  relations: Record<string, number>;
  wageDue: number;
  quest: Quest;
  story: StoryState;
  scene: Scene | null;
  combat: Combat | null;
  stats: Stats;
  log: string[];
}

export const START_GOLD = 800;
export const START_PORT = 'hui';
export const WAGE = 0.5;
export const GUARD_WAGE = 1;
export const REL_MIN = 300;
export const LOG_MAX = 40;

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
export const dayNumber = (s: { t: number }) => Math.floor(s.t) + 1;
export const shipType = (s: GameState): ShipType => SHIP_BY_ID[s.ship.type];
export const typeOf = (sh: Ship): ShipType => SHIP_BY_ID[sh.type];
export const fleetShips = (s: GameState): Ship[] => [s.ship, ...s.consorts];
export const fleetCargoCap = (s: GameState) => fleetShips(s).reduce((a, x) => a + typeOf(x).cargo, 0);
export const fleetSupplyCap = (s: GameState) => fleetShips(s).reduce((a, x) => a + typeOf(x).supply, 0);
export const totalCrew = (s: GameState) => fleetShips(s).reduce((a, x) => a + x.crew, 0);
export const fleetCrewMax = (s: GameState) => fleetShips(s).reduce((a, x) => a + typeOf(x).crewMax, 0);
/** 吃饭的人数：船员加护卫 */
export const people = (s: GameState) => totalCrew(s) + s.guards;
export const cargoUsed = (s: GameState): number =>
  Object.entries(s.cargo).reduce((a, [id, c]) => a + c.qty * (GOODS.find((g) => g.id === id)?.size ?? 1), 0);
export const cargoFree = (s: GameState) => fleetCargoCap(s) - cargoUsed(s);
export const tradePartners = (s: GameState) => Object.values(s.relations).filter((v) => v >= REL_MIN).length;

export function dateText(t: number): string {
  const d = Math.floor(t);
  const year = Math.floor(d / 360) + 1;
  const month = Math.floor((d % 360) / 30) + 1;
  const day = (d % 30) + 1;
  return `第 ${year} 年 ${month} 月 ${day} 日`;
}

export function pushLog(s: GameState, text: string) {
  s.log.push(`第 ${dayNumber(s)} 天 ${text}`);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}
