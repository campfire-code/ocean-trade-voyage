// 季度目标：每 90 天一个季度，季度末结算。目标一旦达成就记下（不会因为之后花钱而失效）。
import { DAYS_PER_QUARTER, QUARTER_NAMES } from './world';
import { pushLog, tradePartners, type Goal, type GameState, type Quest } from './state';

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function makeQuest(index: number, startT: number, profitBase: number): Quest {
  const goals: Goal[] = [{ id: `q${index}-gold`, kind: 'gold', target: roundTo(1500 * Math.pow(1.42, index), 100), done: false }];
  const second = index % 3;
  if (second === 0) goals.push({ id: `q${index}-ports`, kind: 'ports', target: Math.min(12, 3 + index), done: false });
  else if (second === 1) goals.push({ id: `q${index}-profit`, kind: 'profit', target: roundTo(400 * Math.pow(1.35, index), 10), done: false });
  else goals.push({ id: `q${index}-rep`, kind: 'rep', target: Math.round(3 + 2.5 * index), done: false });
  return { index, startT, goals, profitBase };
}

export function goalLabel(g: Goal): string {
  switch (g.kind) {
    case 'gold': return `资金达到 ${g.target} 金币`;
    case 'ports': return `与 ${g.target} 个港口建立贸易关系`;
    case 'profit': return `本季度贸易净利润 ${g.target} 金币`;
    case 'rep': return `声望达到 ${g.target}`;
  }
}

export function goalProgress(s: GameState, g: Goal): number {
  switch (g.kind) {
    case 'gold': return s.gold;
    case 'ports': return tradePartners(s);
    case 'profit': return Math.round(s.stats.profit - s.quest.profitBase);
    case 'rep': return Math.floor(s.rep);
  }
}

/** 季度名称：第 N 年 春/夏/秋/冬 */
export function quarterName(index: number): string {
  return `第 ${Math.floor(index / 4) + 1} 年${QUARTER_NAMES[index % 4]}季`;
}

export const quarterEnd = (q: Quest) => q.startT + DAYS_PER_QUARTER;
export const daysLeft = (s: GameState) => Math.max(0, Math.ceil(quarterEnd(s.quest) - s.t));

/** 每次交易 / 靠港后调用：把已满足的目标记下来 */
export function latchGoals(s: GameState) {
  for (const g of s.quest.goals) {
    if (!g.done && goalProgress(s, g) >= g.target) {
      g.done = true;
      pushLog(s, `季度目标达成：${goalLabel(g)}`);
    }
  }
}

/** 季度结束：发奖励或扣声望，开始下一季度 */
export function closeQuarter(s: GameState) {
  latchGoals(s);
  const q = s.quest;
  const won = q.goals.filter((g) => g.done);
  const missed = q.goals.length - won.length;
  const bonus = won.length * 100 * (q.index + 1);
  s.gold += bonus;
  s.rep = Math.round((Math.max(0, s.rep + won.length * 3 - missed)) * 100) / 100;
  s.stats.questsWon += won.length;
  s.stats.questsMissed += missed;
  pushLog(s, `${quarterName(q.index)}结算：完成 ${won.length}/${q.goals.length} 个目标${bonus ? `，奖金 ${bonus} 金币` : ''}${missed ? `，未完成扣声望 ${missed}` : ''}`);
  s.quest = makeQuest(q.index + 1, q.startT + DAYS_PER_QUARTER, s.stats.profit);
}
