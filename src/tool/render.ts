// 海图绘制：地形用代码逐像素生成（8 像素一格），再放大 2 倍画到画布上；港口、航线、船画在上层。
import { T_DEEP, T_GRASS, T_HILL, T_SAND, T_SHALLOW, idx, inMap, isWater, type SeaMap } from './mapgen';
import { rand01 } from './rng';
import { REGIONS, PORT_BY_ID } from './world';
import { REL_MIN, dayNumber, type GameState } from './state';
import { windAt } from './sailing';

export const ART = 8; // 地形每格的像素数
export const TILE = 16; // 画布上每格的像素数
type RGB = [number, number, number];

const SAND: RGB[] = [[214, 196, 150], [196, 202, 198], [232, 214, 160], [226, 184, 112]];
const GRASS: RGB[] = [[96, 146, 84], [128, 150, 128], [60, 148, 84], [176, 160, 88]];
const HILL: RGB[] = [[124, 122, 108], [236, 240, 244], [84, 112, 76], [170, 120, 84]];
const DEEP: RGB = [22, 70, 112];
const SHALLOW: RGB = [58, 150, 170];
const FOAM: RGB = [232, 246, 242];

const shade = (c: RGB, d: number): RGB => [c[0] + d, c[1] + d, c[2] + d];

/** 生成整张地形图（不含建筑与船）。返回的画布大小是 w*ART × h*ART。 */
export function renderTerrain(map: SeaMap, seed = 11): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = map.w * ART;
  cv.height = map.h * ART;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(cv.width, cv.height);
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const t = map.tiles[idx(tx, ty)];
      const reg = Math.max(0, map.region[idx(tx, ty)]);
      const nb = (dx: number, dy: number) => inMap(tx + dx, ty + dy) && isWater(map.tiles[idx(tx + dx, ty + dy)]);
      for (let py = 0; py < ART; py++) {
        for (let px = 0; px < ART; px++) {
          const X = tx * ART + px, Y = ty * ART + py;
          const r = rand01(seed, X, Y);
          let c: RGB;
          if (t === T_DEEP) {
            c = shade(DEEP, Math.round((r - 0.5) * 8));
            if (rand01(seed, 'w', X >> 1, Y) < 0.05) c = [44, 100, 146];
          } else if (t === T_SHALLOW) {
            c = shade(SHALLOW, Math.round((r - 0.5) * 10));
            if (rand01(seed, 's', X, Y >> 1) < 0.06) c = [140, 210, 212];
          } else {
            const base = t === T_SAND ? SAND[reg] : t === T_GRASS ? GRASS[reg] : HILL[reg];
            c = shade(base, Math.round((r - 0.5) * 16));
            if (t === T_GRASS && rand01(seed, 'g', X, Y) < 0.08) c = shade(base, -22);
            if (t === T_HILL && py < 3 && px < 3) c = shade(base, 14);
            // 海岸泡沫：靠水一侧的边缘一像素
            if ((py === 0 && nb(0, -1)) || (py === ART - 1 && nb(0, 1)) || (px === 0 && nb(-1, 0)) || (px === ART - 1 && nb(1, 0))) c = FOAM;
          }
          const o = (Y * cv.width + X) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

const REGION_LABELS: { id: string; x: number; y: number }[] = [
  { id: 'mist', x: 14, y: 15 }, { id: 'frost', x: 44, y: 11 }, { id: 'jade', x: 19, y: 32 }, { id: 'sand', x: 47, y: 29 },
];

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size = 13) {
  g.font = `600 ${size}px "PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif`;
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.lineWidth = 3.5;
  g.strokeStyle = 'rgba(10,30,50,.85)';
  g.strokeText(text, x, y);
  g.fillStyle = '#fff';
  g.fillText(text, x, y);
}

function drawHouse(g: CanvasRenderingContext2D, cx: number, cy: number, roof: string, big: boolean) {
  const w = big ? 12 : 10;
  g.fillStyle = '#f2e8d2'; g.fillRect(cx - w / 2, cy - 2, w, 7);
  g.fillStyle = roof; g.fillRect(cx - w / 2 - 1, cy - 5, w + 2, 4);
  g.fillStyle = '#5a3d2b'; g.fillRect(cx - 1, cy + 1, 3, 4);
  g.fillStyle = '#3b2a20'; g.fillRect(cx + w / 2 + 2, cy - 9, 1, 12);
  g.fillStyle = '#e24a3b'; g.fillRect(cx + w / 2 + 3, cy - 9, 4, 3);
}

export function drawShip(g: CanvasRenderingContext2D, cx: number, cy: number, facing: 1 | -1, windTo: number, foe = false) {
  g.save();
  g.translate(cx, cy);
  g.scale(facing, 1);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-8, 5, 16, 2);
  g.fillStyle = '#6a4228'; g.fillRect(-7, 1, 14, 4);
  g.fillStyle = '#8a5a36'; g.fillRect(-8, 0, 16, 2);
  g.fillStyle = '#3b2a20'; g.fillRect(-1, -11, 2, 12);
  // 帆随风向微微鼓起：顺风时鼓得更大
  const lean = windTo === 2 || windTo === 1 || windTo === 3 ? 2 : 0;
  g.fillStyle = foe ? '#3a3a46' : '#f7f3e6';
  g.beginPath(); g.moveTo(1, -10); g.lineTo(8 + lean, -2); g.lineTo(1, -2); g.closePath(); g.fill();
  g.fillStyle = foe ? '#2a2a34' : '#e9e2cc';
  g.beginPath(); g.moveTo(-1, -9); g.lineTo(-6, -2); g.lineTo(-1, -2); g.closePath(); g.fill();
  g.fillStyle = foe ? '#111' : '#d6573f'; g.fillRect(1, -12, 5, 2);
  if (foe) { g.fillStyle = '#eee'; g.fillRect(3, -11, 1, 1); }
  g.restore();
}

export interface SceneOpts {
  route: [number, number][];
  hover: [number, number] | null;
  facing: 1 | -1;
}

export function drawScene(cv: HTMLCanvasElement, terrain: HTMLCanvasElement, map: SeaMap, s: GameState, o: SceneOpts) {
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(terrain, 0, 0, cv.width, cv.height);

  for (const r of REGION_LABELS) {
    const name = REGIONS.find((x) => x.id === r.id)!.name;
    g.save();
    g.globalAlpha = 0.22;
    g.font = '700 22px "PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#eaf6ff';
    g.fillText(name.split('').join(' '), r.x * TILE + TILE / 2, r.y * TILE);
    g.restore();
  }

  // 航线
  if (o.route.length) {
    g.fillStyle = 'rgba(255,255,255,.9)';
    o.route.forEach(([x, y], i) => {
      if (i % 1 === 0) g.fillRect(x * TILE + TILE / 2 - 2, y * TILE + TILE / 2 - 2, 4, 4);
    });
    const [ex, ey] = o.route[o.route.length - 1];
    g.strokeStyle = '#ffd36a'; g.lineWidth = 2;
    g.strokeRect(ex * TILE + 1, ey * TILE + 1, TILE - 2, TILE - 2);
  }
  if (o.hover && inMap(o.hover[0], o.hover[1])) {
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1;
    g.strokeRect(o.hover[0] * TILE + 0.5, o.hover[1] * TILE + 0.5, TILE - 1, TILE - 1);
  }

  // 港口
  for (const site of map.sites) {
    const p = PORT_BY_ID[site.id];
    const roof = REGIONS.find((r) => r.id === p.region)!.roof;
    const cx = site.land[0] * TILE + TILE / 2, cy = site.land[1] * TILE + TILE / 2;
    drawHouse(g, cx, cy, roof, p.size >= 1.5);
    // 码头：木栈桥
    g.fillStyle = '#9a6b3f';
    g.fillRect(site.dock[0] * TILE + 4, site.dock[1] * TILE + 4, TILE - 8, TILE - 8);
    const est = (s.relations[site.id] ?? 0) >= REL_MIN;
    const cond = s.conds.find((c) => c.port === site.id && c.until >= dayNumber(s));
    const tag = cond ? ({ festival: ' 庆', blockade: ' 封', plague: ' 疫' } as const)[cond.kind] : '';
    label(g, p.name + (est ? ' ★' : '') + tag, cx, cy - 12, 13);
  }

  // 船
  const [sx, sy] = s.pos;
  const windTo = (windAt(s.seed, Math.floor(s.t)).from + 4) % 8;
  s.consorts.forEach((_, i) => drawShip(g, sx * TILE + TILE / 2 - o.facing * (14 + i * 13), sy * TILE + TILE / 2 + 2 + i * 3, o.facing, windTo));
  drawShip(g, sx * TILE + TILE / 2, sy * TILE + TILE / 2 - 2, o.facing, windTo);
}

/** 海战画面：两方船按距离拉开，炮击时冒烟 */
export function drawBattle(cv: HTMLCanvasElement, s: GameState) {
  const c = s.combat;
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  g.imageSmoothingEnabled = false;
  const sky = g.createLinearGradient(0, 0, 0, H * 0.45);
  sky.addColorStop(0, '#9fcbe8'); sky.addColorStop(1, '#d9eef6');
  g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.45);
  const sea = g.createLinearGradient(0, H * 0.45, 0, H);
  sea.addColorStop(0, '#2c7fa8'); sea.addColorStop(1, '#17466e');
  g.fillStyle = sea; g.fillRect(0, H * 0.45, W, H * 0.55);
  g.fillStyle = 'rgba(255,255,255,.16)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % W, y = H * 0.48 + ((i * 53) % (H * 0.5));
    g.fillRect(x, y, 14 + (i % 3) * 6, 2);
  }
  if (!c) return;
  const gap = [0, 110, 210, 310, 410][c.dist];
  const mx = W / 2 - gap / 2 - 30, fx = W / 2 + gap / 2 + 30;
  const y = H * 0.66;
  const windTo = (windAt(s.seed, Math.floor(s.t)).from + 4) % 8;
  const SC = 4;
  g.save(); g.scale(SC, SC);
  s.consorts.forEach((_, i) => drawShip(g, (mx - 52 - i * 44) / SC, (y + 16 + i * 14) / SC, 1, windTo));
  drawShip(g, mx / SC, y / SC, 1, windTo);
  drawShip(g, fx / SC, y / SC, -1, windTo, true);
  g.restore();
  const last = c.log[c.log.length - 1] ?? '';
  const smoke = (x: number) => {
    g.fillStyle = 'rgba(240,240,240,.75)';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + i * 9, y - 18 - i * 6, 8 + i * 2, 0, 7); g.fill(); }
    g.fillStyle = '#ffd36a'; g.fillRect(x - 4, y - 14, 8, 6);
  };
  if (/我方.*(齐射|命中)/.test(last)) smoke(mx + 40);
  if (/敌船.*开火/.test(last)) smoke(fx - 80);
  if (c.dist === 1) { g.fillStyle = '#6a4228'; g.fillRect(mx + 36, y - 6, fx - mx - 72, 4); }
}

