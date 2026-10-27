// 随机事件与港口状态：全部由数据表驱动。想加一个事件，只要在 SEA_EVENTS 里加一项。
import { clamp, pick, rand01, round2 } from './rng';
import { fleetShips, pushLog, typeOf, fleetSupplyCap, type CondKind, type GameState, type PortCond, type Scene } from './state';
import { removeCrew } from './fleet';
import { GOODS, PORTS, PORT_BY_ID, type GoodId } from './world';
import { cargoFree } from './state';

export type Effect =
  | { t: 'gold'; n: number }
  | { t: 'rep'; n: number }
  /** 每艘船的船体按最大值的比例增减（负数为受损） */
  | { t: 'hullPct'; n: number }
  | { t: 'crew'; n: number }
  | { t: 'food'; n: number }
  | { t: 'water'; n: number }
  | { t: 'goods'; lo: number; hi: number; good?: GoodId }
  | { t: 'days'; n: number }
  /** 顺风漂移 n 格（遇到陆地即止） */
  | { t: 'drift'; n: number }
  | { t: 'combat'; foe: string }
  | { t: 'chance'; p: number; yes: Effect[]; no: Effect[] }
  | { t: 'say'; text: string };

export interface EventChoice { label: string; needGold?: number; effects: Effect[] }
export interface SeaEventDef { id: string; title: string; text: string; minDay: number; weight: number; choices: EventChoice[] }

export const SEA_EVENTS: SeaEventDef[] = [
  {
    id: 'storm-drift', title: '风暴漂流', minDay: 3, weight: 3,
    text: '乌云压下来，一场没有预兆的风暴把船队卷进了浪里。桅杆在呻吟，水手们抓紧缆绳等你下令。',
    choices: [
      { label: '收帆，顺着风漂', effects: [{ t: 'say', text: '收了帆，被风浪推着漂了几天' }, { t: 'days', n: 2 }, { t: 'drift', n: 5 }, { t: 'hullPct', n: -0.04 }] },
      { label: '硬顶着风浪走', effects: [{ t: 'chance', p: 0.55, yes: [{ t: 'say', text: '硬是扛了过去，只是船身多了几道裂纹' }, { t: 'hullPct', n: -0.06 }], no: [{ t: 'say', text: '一个大浪砸下来，船体重伤，还有人落水' }, { t: 'hullPct', n: -0.22 }, { t: 'crew', n: -1 }] }] },
    ],
  },
  {
    id: 'wreck', title: '遇难船', minDay: 5, weight: 3,
    text: '浪尖上漂着一艘断了桅的商船，甲板上有人在挥手。船身已经半沉，但舱里也许还有东西。',
    choices: [
      { label: '救人（耽搁 1 天）', effects: [{ t: 'days', n: 1 }, { t: 'chance', p: 0.7, yes: [{ t: 'say', text: '救起了幸存者，他们愿意留下当水手，船主还给了谢礼' }, { t: 'crew', n: 3 }, { t: 'rep', n: 1 }, { t: 'gold', n: 60 }], no: [{ t: 'say', text: '赶到时船已经沉了，只捞起一点漂浮的箱子' }, { t: 'gold', n: 25 }] }] },
      { label: '打捞货舱（耽搁 1 天）', effects: [{ t: 'days', n: 1 }, { t: 'chance', p: 0.75, yes: [{ t: 'say', text: '从沉船里捞出一批没泡坏的货' }, { t: 'goods', lo: 6, hi: 12 }], no: [{ t: 'say', text: '残骸底下是暗礁，船底被刮了一道' }, { t: 'hullPct', n: -0.08 }] }] },
      { label: '绕开，继续赶路', effects: [{ t: 'say', text: '绕开了那片残骸' }] },
    ],
  },
  {
    id: 'crates', title: '浮木货箱', minDay: 2, weight: 3,
    text: '海面上漂着几只用麻绳捆在一起的木箱，像是被风浪冲出商船的。',
    choices: [
      { label: '捞起来', effects: [{ t: 'say', text: '捞起几只箱子，货物还完好' }, { t: 'goods', lo: 3, hi: 8 }] },
      { label: '不去管', effects: [{ t: 'say', text: '没有理会漂着的箱子' }] },
    ],
  },
  {
    id: 'fog', title: '大雾', minDay: 4, weight: 3,
    text: '雾从水面上涨起来，几十步外就看不见船头的灯。水手说前面一带暗礁多。',
    choices: [
      { label: '抛锚，等雾散（耽搁 1 天）', effects: [{ t: 'say', text: '抛锚等了一天，雾散了' }, { t: 'days', n: 1 }] },
      { label: '摸黑前进', effects: [{ t: 'chance', p: 0.6, yes: [{ t: 'say', text: '凭着经验摸了过去' }], no: [{ t: 'say', text: '船底擦到了暗礁' }, { t: 'hullPct', n: -0.1 }] }] },
    ],
  },
  {
    id: 'doldrums', title: '无风带', minDay: 6, weight: 2,
    text: '风忽然停了，帆软塌塌地垂着，海面平得像一块铅板。',
    choices: [
      { label: '放桨划出去（耽搁 1 天）', effects: [{ t: 'days', n: 1 }, { t: 'chance', p: 0.3, yes: [{ t: 'say', text: '划桨累倒了一个水手' }, { t: 'crew', n: -1 }], no: [{ t: 'say', text: '轮班划桨，总算划出了无风带' }] }] },
      { label: '原地等风（耽搁 2 天）', effects: [{ t: 'say', text: '等了两天，风终于回来了' }, { t: 'days', n: 2 }] },
    ],
  },
  {
    id: 'trader', title: '路过的商船', minDay: 3, weight: 2,
    text: '一艘同路的小商船打来旗语：他们的船舱里有多出来的食物和淡水，愿意匀一些。',
    choices: [
      { label: '买一批补给（30 金币）', needGold: 30, effects: [{ t: 'gold', n: -30 }, { t: 'food', n: 8 }, { t: 'water', n: 8 }, { t: 'say', text: '花 30 金币买了 8 份食物和 8 份淡水' }] },
      { label: '挥手致意', effects: [{ t: 'say', text: '互相挥了挥旗，各自赶路' }] },
    ],
  },
  {
    id: 'whales', title: '鲸群', minDay: 3, weight: 2,
    text: '一群灰背的鲸从船边浮上来，喷出的水雾在阳光里闪。鱼群也跟着聚了过来。',
    choices: [
      { label: '放下鱼线', effects: [{ t: 'say', text: '钓上来一网鱼，补了点口粮' }, { t: 'food', n: 6 }] },
      { label: '不打扰它们', effects: [{ t: 'say', text: '看着鲸群远去，水手们都很开心' }, { t: 'rep', n: 0.2 }] },
    ],
  },
  {
    id: 'false-flare', title: '求救的信号弹', minDay: 15, weight: 2,
    text: '远处升起一串红色信号弹，一艘小船在原地打转，像是失了舵。但这一带常有人用这招引商船上钩。',
    choices: [
      { label: '过去帮忙', effects: [{ t: 'chance', p: 0.5, yes: [{ t: 'say', text: '真是失了舵的渔船，船主千恩万谢' }, { t: 'gold', n: 120 }, { t: 'rep', n: 1 }], no: [{ t: 'say', text: '是个圈套！小船上跳出一帮人' }, { t: 'combat', foe: 'shark' }] }] },
      { label: '装作没看见', effects: [{ t: 'say', text: '没有理会那串信号弹' }] },
    ],
  },
];
export const SEA_EVENT_BY_ID: Record<string, SeaEventDef> = Object.fromEntries(SEA_EVENTS.map((e) => [e.id, e]));

export const SEA_EVENT_CHANCE = 0.05;

export function makeScene(def: SeaEventDef): Scene {
  return { id: def.id, title: def.title, text: def.text, choices: def.choices.map((c) => c.label) };
}

/** 这一天海上有没有碰上事件：有则返回场景 */
export function rollSeaEvent(s: GameState, day: number): Scene | null {
  if (s.scene || s.combat) return null;
  if (rand01(s.seed, 'sev', day) >= SEA_EVENT_CHANCE) return null;
  const pool = SEA_EVENTS.filter((e) => day >= e.minDay);
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let r = rand01(s.seed, 'sevk', day) * total;
  for (const e of pool) { r -= e.weight; if (r < 0) return makeScene(e); }
  return makeScene(pool[0]);
}

export interface Post { days: number; drift: number; combat: string | null }

/** 把一组效果套用到状态上（直接修改）。耗时、漂移、开战这三类要靠调用方处理，记在 post 里。 */
export function applyEffects(s: GameState, effects: Effect[], key: string, post: Post = { days: 0, drift: 0, combat: null }): Post {
  effects.forEach((e, i) => {
    switch (e.t) {
      case 'gold': s.gold = Math.max(0, round2(s.gold + e.n)); break;
      case 'rep': s.rep = Math.max(0, round2(s.rep + e.n)); break;
      case 'hullPct':
        for (const sh of fleetShips(s)) sh.hull = clamp(round2(sh.hull + typeOf(sh).hull * e.n), e.n < 0 ? 1 : 0, typeOf(sh).hull);
        break;
      case 'crew':
        if (e.n < 0) removeCrew(s, -e.n);
        else {
          let left = e.n;
          for (const sh of fleetShips(s)) {
            const k = Math.min(left, typeOf(sh).crewMax - sh.crew);
            sh.crew += k; left -= k;
          }
        }
        break;
      case 'food': s.ship.food = Math.min(fleetSupplyCap(s), s.ship.food + e.n); break;
      case 'water': s.ship.water = Math.min(fleetSupplyCap(s), s.ship.water + e.n); break;
      case 'goods': {
        const good = e.good ? GOODS.find((g) => g.id === e.good)! : pick(GOODS, s.seed, key, 'g', i);
        const want = Math.round(e.lo + (e.hi - e.lo) * rand01(s.seed, key, 'n', i));
        const q = Math.min(want, Math.floor(cargoFree(s) / good.size));
        if (q > 0) {
          const old = s.cargo[good.id] ?? { qty: 0, cost: 0 };
          const cost = Math.round(good.base * 0.5);
          s.cargo[good.id] = { qty: old.qty + q, cost: round2((old.qty * old.cost + q * cost) / (old.qty + q)) };
          pushLog(s, `获得 ${q} 件${good.name}`);
        } else pushLog(s, '货舱已满，货物只能放弃');
        break;
      }
      case 'days': post.days += e.n; break;
      case 'drift': post.drift += e.n; break;
      case 'combat': post.combat = e.foe; break;
      case 'chance': applyEffects(s, rand01(s.seed, key, 'c', i) < e.p ? e.yes : e.no, `${key}.${i}`, post); break;
      case 'say': pushLog(s, e.text); break;
    }
  });
  return post;
}

// ---------------- 港口状态 ----------------

export interface CondRule { kind: CondKind; name: string; weight: number; days: [number, number]; text: (port: string) => string }
export const COND_RULES: CondRule[] = [
  { kind: 'festival', name: '庆典', weight: 4, days: [6, 9], text: (p) => `${p}办起了盛大的庆典，奢侈品供不应求` },
  { kind: 'blockade', name: '封港', weight: 2, days: [7, 11], text: (p) => `${p}被封港了，船只一概不许进出` },
  { kind: 'plague', name: '瘟疫', weight: 2, days: [12, 16], text: (p) => `${p}出现了瘟疫，进港的人有染病的危险，粮食价格飞涨` },
];
export const COND_NAME: Record<CondKind, string> = { festival: '庆典', blockade: '封港', plague: '瘟疫' };
export const COND_CHANCE = 0.06;
export const COND_MAX = 2;
const LUXURY: GoodId[] = ['tea', 'pepper', 'pearl', 'sugar', 'amber'];
const FOOD: GoodId[] = ['fish', 'rice', 'salt'];

export function condMult(conds: PortCond[], portId: string, good: GoodId, day: number): number {
  let m = 1;
  for (const c of conds) {
    if (c.port !== portId || day > c.until) continue;
    if (c.kind === 'festival') m *= LUXURY.includes(good) ? 1.3 : 1.05;
    else if (c.kind === 'plague') m *= FOOD.includes(good) ? 1.35 : 1.1;
  }
  return m;
}

export const condAt = (s: GameState, portId: string, kind: CondKind, day: number): PortCond | undefined =>
  s.conds.find((c) => c.port === portId && c.kind === kind && day <= c.until);
export const isBlockaded = (s: GameState, portId: string, day: number) => !!condAt(s, portId, 'blockade', day);

export function maybeSpawnCond(s: GameState, d: number) {
  if (s.conds.length >= COND_MAX || rand01(s.seed, 'cond', d) >= COND_CHANCE) return;
  const total = COND_RULES.reduce((a, r) => a + r.weight, 0);
  let r = rand01(s.seed, 'condk', d) * total;
  let rule = COND_RULES[0];
  for (const x of COND_RULES) { r -= x.weight; if (r < 0) { rule = x; break; } }
  const port = pick(PORTS, s.seed, 'condp', d);
  if (s.conds.some((c) => c.port === port.id)) return;
  if (rule.kind === 'blockade' && (s.docked === port.id || (port.id === 'hui' && d < 40))) return;
  const len = Math.round(rule.days[0] + (rule.days[1] - rule.days[0]) * rand01(s.seed, 'condl', d));
  s.conds.push({ id: `${d}-${port.id}-${rule.kind}`, port: port.id, kind: rule.kind, until: d + len, text: rule.text(PORT_BY_ID[port.id].name) });
}
