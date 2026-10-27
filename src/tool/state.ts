// 游戏状态的类型与初始化。状态是纯 JSON，可以直接存档。
import type { MarketEvent } from './pricing';
import { GOODS, SHIP_BY_ID, type ShipType } from './world';

export interface Ship { type: string; name: string; hull: number; crew: number; food: number; water: number }
export interface CargoItem { qty: number; cost: number }
export type GoalKind = 'gold' | 'ports' | 'profit' | 'rep';
export interface Goal { id: string; kind: GoalKind; target: number; done: boolean }
export interface Quest { index: number; startT: number; goals: Goal[]; profitBase: number }
export interface Stats { traded: number; profit: number; sailedDays: number; questsWon: number; questsMissed: number; rescued: number }

export interface GameState {
  v: 1;
  seed: number;
  captain: string;
  /** 已过的天数（带小数），第 1 天从 0 开始 */
  t: number;
  pos: [number, number];
  /** 当前靠在哪个港口，海上为 null */
  docked: string | null;
  gold: number;
  rep: number;
  ship: Ship;
  cargo: Record<string, CargoItem>;
  stock: Record<string, Record<string, number>>;
  events: MarketEvent[];
  /** 各港口累计成交额（金币），达到 300 算建立贸易关系 */
  relations: Record<string, number>;
  wageDue: number;
  quest: Quest;
  stats: Stats;
  log: string[];
}

export const START_GOLD = 800;
export const START_PORT = 'hui';
export const WAGE = 0.5;
export const REL_MIN = 300;
export const LOG_MAX = 40;

export const dayNumber = (s: { t: number }) => Math.floor(s.t) + 1;
export const shipType = (s: GameState): ShipType => SHIP_BY_ID[s.ship.type];
export const cargoUsed = (s: GameState): number =>
  Object.entries(s.cargo).reduce((a, [id, c]) => a + c.qty * (GOODS.find((g) => g.id === id)?.size ?? 1), 0);
export const cargoFree = (s: GameState) => shipType(s).cargo - cargoUsed(s);
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
