// 海图的程序化生成：只靠代码和确定性噪声，不依赖任何外部美术素材。
import { rand01 } from './rng';
import { FILLER_ISLANDS, MAP_H, MAP_W, PORTS, REGIONS, type RegionId } from './world';

export const T_DEEP = 0;
export const T_SHALLOW = 1;
export const T_SAND = 2;
export const T_GRASS = 3;
export const T_HILL = 4;
export type Tile = 0 | 1 | 2 | 3 | 4;

export const isWater = (t: number) => t === T_DEEP || t === T_SHALLOW;

export interface PortSite {
  id: string;
  /** 港口建筑所在的陆地格 */
  land: [number, number];
  /** 船靠岸的水格 */
  dock: [number, number];
}

export interface SeaMap {
  w: number;
  h: number;
  tiles: Tile[];
  /** 每个陆地格属于哪个文化区（水格为 -1），用于上色 */
  region: number[];
  sites: PortSite[];
}

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = rand01(seed, gx, gy);
  const b = rand01(seed, gx + 1, gy);
  const c = rand01(seed, gx, gy + 1);
  const d = rand01(seed, gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const NB4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const NB8: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** 从给定水格出发能到达的水格集合 */
export function waterComponent(tiles: number[], start: [number, number]): Set<number> {
  const seen = new Set<number>([idx(start[0], start[1])]);
  const stack: [number, number][] = [start];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const k = idx(nx, ny);
      if (seen.has(k) || !isWater(tiles[k])) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export function generateMap(seed = 20261027): SeaMap {
  const islands = [
    ...PORTS.map((p) => ({ x: p.x, y: p.y, rx: p.rx, ry: p.ry })),
    ...FILLER_ISLANDS,
  ];
  const elev = new Array<number>(MAP_W * MAP_H).fill(0);
  const tiles = new Array<Tile>(MAP_W * MAP_H).fill(T_DEEP);
  const region = new Array<number>(MAP_W * MAP_H).fill(-1);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      let best = 0;
      for (const isl of islands) {
        const dx = (x - isl.x) / isl.rx;
        const dy = (y - isl.y) / isl.ry;
        const v = 1 - (dx * dx + dy * dy);
        if (v > best) best = v;
      }
      const n = valueNoise(seed, x, y, 4) * 0.6 + valueNoise(seed + 7, x, y, 2) * 0.4;
      // 边缘一圈强制为海，保证海图四周可通行
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y) < 2 ? -1 : 0;
      const e = best > 0 ? best + (n - 0.5) * 0.5 + edge : edge - 1;
      elev[idx(x, y)] = e;
      if (e > 0.12) tiles[idx(x, y)] = e > 0.62 ? T_HILL : e > 0.3 ? T_GRASS : T_SAND;
    }
  }
  // 浅滩：靠近陆地的海
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!isWater(tiles[idx(x, y)])) continue;
      let near = 99;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (inMap(nx, ny) && !isWater(tiles[idx(nx, ny)])) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }
      if (near === 1 || (near === 2 && rand01(seed, 'sh', x, y) < 0.45)) tiles[idx(x, y)] = T_SHALLOW;
    }
  }
  // 陆地格的文化区：离哪个港口岛最近
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isWater(tiles[idx(x, y)])) continue;
      let bi = 0, bd = Infinity;
      PORTS.forEach((p, i) => {
        const d = ((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      region[idx(x, y)] = REGIONS.findIndex((r) => r.id === PORTS[bi].region);
    }
  }

  // 最大的一片水域作为「外海」，港口必须挨着它
  let main = new Set<number>();
  const visited = new Set<number>();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = idx(x, y);
      if (!isWater(tiles[k]) || visited.has(k)) continue;
      const comp = waterComponent(tiles, [x, y]);
      comp.forEach((c) => visited.add(c));
      if (comp.size > main.size) main = comp;
    }
  }

  const sites: PortSite[] = [];
  const usedDocks = new Set<number>();
  for (const p of PORTS) {
    let found: PortSite | null = null;
    for (let r = 0; r < 14 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const lx = p.x + dx, ly = p.y + dy;
          if (!inMap(lx, ly) || isWater(tiles[idx(lx, ly)])) continue;
          for (const [ox, oy] of NB4) {
            const wx = lx + ox, wy = ly + oy;
            if (!inMap(wx, wy)) continue;
            const wk = idx(wx, wy);
            if (isWater(tiles[wk]) && main.has(wk) && !usedDocks.has(wk) && wx > 1 && wy > 1 && wx < MAP_W - 2 && wy < MAP_H - 2) {
              found = { id: p.id, land: [lx, ly], dock: [wx, wy] };
              break;
            }
          }
        }
      }
    }
    if (!found) throw new Error(`海图生成失败：${p.id} 找不到靠岸点`);
    usedDocks.add(idx(found.dock[0], found.dock[1]));
    // 港口所在的陆地格改成沙地，方便画建筑
    tiles[idx(found.land[0], found.land[1])] = T_SAND;
    // 码头水格必须是浅水
    tiles[idx(found.dock[0], found.dock[1])] = T_SHALLOW;
    sites.push(found);
  }
  return { w: MAP_W, h: MAP_H, tiles, region, sites };
}

export const regionOfIndex = (i: number): RegionId => REGIONS[i]?.id ?? 'mist';

// ---------------- 寻路（A*，只走水格，八方向，不穿过陆地角） ----------------

export function canStep(map: SeaMap, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx, ny = y + dy;
  if (!inMap(nx, ny) || !isWater(map.tiles[idx(nx, ny)])) return false;
  if (dx !== 0 && dy !== 0) {
    if (!isWater(map.tiles[idx(x + dx, y)]) || !isWater(map.tiles[idx(x, y + dy)])) return false;
  }
  return true;
}

export function findRoute(map: SeaMap, from: [number, number], to: [number, number]): [number, number][] | null {
  if (!inMap(to[0], to[1]) || !isWater(map.tiles[idx(to[0], to[1])])) return null;
  const start = idx(from[0], from[1]);
  const goal = idx(to[0], to[1]);
  if (start === goal) return [];
  const g = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: start, f: 0 }];
  const closed = new Set<number>();
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to[0]), dy = Math.abs(y - to[1]);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (closed.has(cur.k)) continue;
    if (cur.k === goal) {
      const path: [number, number][] = [];
      for (let k = goal; k !== start; k = prev.get(k)!) path.push([k % MAP_W, Math.floor(k / MAP_W)]);
      return path.reverse();
    }
    closed.add(cur.k);
    const cx = cur.k % MAP_W, cy = Math.floor(cur.k / MAP_W);
    for (const [dx, dy] of NB8) {
      if (!canStep(map, cx, cy, dx, dy)) continue;
      const nk = idx(cx + dx, cy + dy);
      if (closed.has(nk)) continue;
      const cost = (g.get(cur.k) ?? 0) + (dx && dy ? 1.414 : 1) * (map.tiles[nk] === T_SHALLOW ? 1.2 : 1);
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        prev.set(nk, cur.k);
        open.push({ k: nk, f: cost + h(cx + dx, cy + dy) });
      }
    }
  }
  return null;
}
