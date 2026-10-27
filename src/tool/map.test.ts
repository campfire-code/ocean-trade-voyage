import { describe, expect, it } from 'vitest';
import { generateMap, findRoute, idx, isWater, canStep, waterComponent, T_SHALLOW } from './mapgen';
import { MAP_H, MAP_W, PORTS } from './world';

const map = generateMap();

describe('海图生成', () => {
  it('尺寸与瓦片数量正确', () => {
    expect(map.tiles.length).toBe(MAP_W * MAP_H);
    expect(map.region.length).toBe(MAP_W * MAP_H);
  });
  it('同样的种子生成同样的海图', () => {
    expect(generateMap().tiles).toEqual(map.tiles);
  });
  it('不同种子的海图不同', () => {
    expect(generateMap(5).tiles).not.toEqual(map.tiles);
  });
  it('四周一圈是海', () => {
    for (let x = 0; x < MAP_W; x++) {
      expect(isWater(map.tiles[idx(x, 0)])).toBe(true);
      expect(isWater(map.tiles[idx(x, MAP_H - 1)])).toBe(true);
    }
  });
  it('每个港口都有靠岸点：陆地格 + 相邻的水格', () => {
    expect(map.sites.length).toBe(PORTS.length);
    for (const s of map.sites) {
      expect(isWater(map.tiles[idx(s.dock[0], s.dock[1])])).toBe(true);
      expect(isWater(map.tiles[idx(s.land[0], s.land[1])])).toBe(false);
      expect(Math.abs(s.land[0] - s.dock[0]) + Math.abs(s.land[1] - s.dock[1])).toBe(1);
    }
  });
  it('码头水格互不重复，且是浅水', () => {
    const keys = new Set(map.sites.map((s) => idx(s.dock[0], s.dock[1])));
    expect(keys.size).toBe(PORTS.length);
    for (const s of map.sites) expect(map.tiles[idx(s.dock[0], s.dock[1])]).toBe(T_SHALLOW);
  });
  it('所有码头在同一片水域里（互相可达）', () => {
    const comp = waterComponent(map.tiles, map.sites[0].dock);
    for (const s of map.sites) expect(comp.has(idx(s.dock[0], s.dock[1]))).toBe(true);
  });
  it('既有海也有陆地，陆地占比在合理范围', () => {
    const land = map.tiles.filter((t) => !isWater(t)).length / map.tiles.length;
    expect(land).toBeGreaterThan(0.08);
    expect(land).toBeLessThan(0.4);
  });
  it('三种以上不同的陆地瓦片和两种水', () => {
    expect(new Set(map.tiles).size).toBe(5);
  });
});

describe('寻路', () => {
  it('任意两个港口之间都能找到航线', () => {
    for (const a of map.sites) for (const b of map.sites) {
      if (a === b) continue;
      const r = findRoute(map, a.dock, b.dock);
      expect(r, `${a.id}→${b.id}`).not.toBeNull();
      expect(r![r!.length - 1]).toEqual(b.dock);
    }
  });
  it('航线上每一步都在水上，且相邻格之间可通行', () => {
    const a = map.sites[0], b = map.sites[9];
    const r = findRoute(map, a.dock, b.dock)!;
    let [x, y] = a.dock;
    for (const [nx, ny] of r) {
      expect(canStep(map, x, y, nx - x, ny - y)).toBe(true);
      [x, y] = [nx, ny];
    }
  });
  it('目标是陆地时返回 null', () => {
    expect(findRoute(map, map.sites[0].dock, map.sites[1].land)).toBeNull();
  });
  it('起点等于终点返回空航线', () => {
    expect(findRoute(map, map.sites[0].dock, map.sites[0].dock)).toEqual([]);
  });
  it('斜着穿过两块陆地之间的缝隙是不允许的', () => {
    const m = generateMap();
    const t = m.tiles.slice();
    // 手工造一个：x 为陆地、对角两格为水
    const base = idx(10, 10);
    t[base] = 2; t[base + MAP_W + 1] = 2;
    t[base + 1] = 0; t[base + MAP_W] = 0;
    const mm = { ...m, tiles: t };
    expect(canStep(mm, 11, 10, -1, 1)).toBe(false);
  });
});
