// 示例存档：只在浏览器预览页（preview.html?scene=sea|port）里用，用来生成截图和做界面检查。
// 状态是用真实的游戏规则一步步玩出来的，不是手写的数字。
import { findRoute, type SeaMap } from './mapgen';
import { buyConsort, buyGood, buySupply, sellGood } from './trade';
import { beginBattle } from './turn';
import { combatAct } from './combat';
import { clone, newGame, sailStep, undock } from './turn';
import type { GameState } from './state';

function sail(map: SeaMap, s: GameState, to: string, maxSteps = 9999): { s: GameState; route: [number, number][] } {
  let cur = s.docked ? undock(s).state : clone(s);
  const dock = map.sites.find((x) => x.id === to)!.dock;
  const route = findRoute(map, cur.pos, dock)!;
  let n = 0;
  for (const [x, y] of route) {
    if (n >= maxSteps) break;
    cur = sailStep(map, cur, x - cur.pos[0], y - cur.pos[1]).state;
    n += 1;
    if (cur.docked) break;
  }
  return { s: cur, route: route.slice(Math.min(n, route.length)) };
}

/** 港口场景：已在灰檐港进了鱼和帆布，开到雾灯镇卖掉一部分，买了茶叶 */
export function samplePort(map: SeaMap): GameState {
  let s = newGame(map, 1027, '示例船长');
  s = buySupply(s, 'food', 30).state;
  s = buySupply(s, 'water', 30).state;
  s = buyGood(s, 'fish', 14).state;
  s = buyGood(s, 'canvas', 10).state;
  s = sail(map, s, 'wu').s;
  s = sellGood(s, 'canvas', 4).state;
  s = buyGood(s, 'tea', 8).state;
  return s;
}

/** 海上场景：载着货物驶向白鲸湾，航线还剩一段 */
export function sampleSea(map: SeaMap): { state: GameState; route: [number, number][] } {
  let s = newGame(map, 1027, '示例船长');
  s = buySupply(s, 'food', 30).state;
  s = buySupply(s, 'water', 30).state;
  s = buyGood(s, 'fish', 16).state;
  s = buyGood(s, 'tools', 12).state;
  s.gold += 0;
  const r = sail(map, s, 'jing', 14);
  return { state: r.s, route: r.route };
}

/** 海战场景：带着一艘僚船，在驶向白鲸湾的路上遇到断桅会的快桨船，已经交了几轮炮 */
export function sampleBattle(map: SeaMap): GameState {
  let s = newGame(map, 1027, '示例船长');
  s.gold = 3000;
  s.rep = 5;
  s = buyConsort(s, 'lark').state;
  s = buySupply(s, 'food', 30).state;
  s = buySupply(s, 'water', 30).state;
  s = buyGood(s, 'tea', 10).state;
  s = sail(map, s, 'jing', 6).s;
  s = beginBattle(s, 'crow');
  s.combat!.dist = 2;
  s.combat!.gauge = true;
  for (const a of ['fire', 'fire', 'close', 'fire'] as const) {
    const r = combatAct(s, a);
    if (r.ok && !r.state.combat!.done) s = r.state;
  }
  return s;
}
