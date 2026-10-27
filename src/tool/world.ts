// 世界设定：完全原创的虚构群岛「澜屿海」。地名、商品、船型、数值均为本工具原创。
export const MAP_W = 60;
export const MAP_H = 38;

export type GoodId =
  | 'salt' | 'fish' | 'rice' | 'sugar' | 'oil' | 'ironwood' | 'canvas' | 'pots'
  | 'copper' | 'tools' | 'tea' | 'indigo' | 'pepper' | 'amber' | 'pearl';

export interface GoodDef { id: GoodId; name: string; base: number; size: number; note: string }

/** 15 种商品：base 是基准价（金币），size 是占货舱的格数 */
export const GOODS: GoodDef[] = [
  { id: 'salt', name: '灰海盐', base: 12, size: 1, note: '晒盐场的大宗货，腌鱼离不了' },
  { id: 'fish', name: '风干鱼', base: 15, size: 1, note: '耐放的口粮，北方渔港出产' },
  { id: 'rice', name: '岛稻米', base: 18, size: 1, note: '南方水田的主粮' },
  { id: 'sugar', name: '棕榈糖', base: 24, size: 1, note: '用棕榈汁熬成的块糖' },
  { id: 'oil', name: '灯油', base: 28, size: 1, note: '鲸脂与椰子榨的油，点灯用' },
  { id: 'ironwood', name: '铁脊木', base: 30, size: 2, note: '极硬的木材，造船修船用' },
  { id: 'canvas', name: '帆麻布', base: 26, size: 1, note: '织帆的粗麻布' },
  { id: 'pots', name: '陶罐', base: 22, size: 1, note: '釉面陶器，轻拿轻放' },
  { id: 'copper', name: '铜锭', base: 45, size: 2, note: '沉，但各地都要' },
  { id: 'tools', name: '渔具与工具', base: 38, size: 1, note: '铁钩、锚链、凿子' },
  { id: 'tea', name: '雾山茶', base: 55, size: 1, note: '高山云雾里的茶叶' },
  { id: 'indigo', name: '靛蓝染料', base: 50, size: 1, note: '染布用的蓝膏' },
  { id: 'pepper', name: '烟红椒', base: 70, size: 1, note: '辛辣的干椒，按两论价' },
  { id: 'amber', name: '松脂琥珀', base: 95, size: 1, note: '冷海岸边捡到的化石松脂' },
  { id: 'pearl', name: '月光珍珠', base: 120, size: 1, note: '珊瑚礁里采的淡色珍珠' },
];
export const GOOD_BY_ID: Record<string, GoodDef> = Object.fromEntries(GOODS.map((g) => [g.id, g]));

export type RegionId = 'mist' | 'frost' | 'jade' | 'sand';
export interface RegionDef { id: RegionId; name: string; blurb: string; roof: string }
export const REGIONS: RegionDef[] = [
  { id: 'mist', name: '朝雾群屿', blurb: '多雾的温带岛群，渔业与织麻', roof: '#b4553c' },
  { id: 'frost', name: '霜钉列岛', blurb: '北方冷海，出木材、铜与琥珀', roof: '#3f6f9e' },
  { id: 'jade', name: '翡翠礁环', blurb: '南方热带礁湖，米糖香料与珍珠', roof: '#2f8f6a' },
  { id: 'sand', name: '赤沙海岸', blurb: '干热的沙岸，出盐、陶器与铜', roof: '#c28a2e' },
];
export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export interface PortDef {
  id: string;
  name: string;
  region: RegionId;
  /** 岛的中心（海图坐标） */
  x: number;
  y: number;
  /** 岛的大小 */
  rx: number;
  ry: number;
  /** 市场规模：越大库存越厚、价格越稳 */
  size: number;
  /** 本港出产（便宜）与紧缺（贵） */
  makes: GoodId[];
  wants: GoodId[];
  /** 船坞最高能造到几级的船 */
  yard: number;
  /** 补给价格系数 */
  supply: number;
  blurb: string;
}

export const PORTS: PortDef[] = [
  { id: 'hui', name: '灰檐港', region: 'mist', x: 8, y: 7, rx: 5, ry: 4, size: 1.6, makes: ['fish', 'canvas', 'tools'], wants: ['rice', 'pepper', 'pearl'], yard: 3, supply: 1.0, blurb: '朝雾群屿的大港，灰瓦屋檐连成一片' },
  { id: 'wu', name: '雾灯镇', region: 'mist', x: 20, y: 12, rx: 4, ry: 3, size: 1.1, makes: ['tea', 'pots', 'canvas'], wants: ['salt', 'copper', 'sugar'], yard: 2, supply: 0.9, blurb: '山腰茶园下的小镇，灯塔夜夜不灭' },
  { id: 'jing', name: '白鲸湾', region: 'mist', x: 10, y: 21, rx: 4, ry: 4, size: 1.2, makes: ['fish', 'oil', 'tools'], wants: ['rice', 'indigo', 'pearl'], yard: 1, supply: 1.1, blurb: '捕鲸人的海湾，空气里一股灯油味' },
  { id: 'bing', name: '冰脊港', region: 'frost', x: 44, y: 6, rx: 5, ry: 4, size: 1.5, makes: ['ironwood', 'amber', 'copper'], wants: ['rice', 'sugar', 'salt'], yard: 2, supply: 1.25, blurb: '冰脊山脚的林木港，冬天海面会结薄冰' },
  { id: 'tie', name: '铁锚镇', region: 'frost', x: 53, y: 14, rx: 4, ry: 3, size: 1.0, makes: ['copper', 'ironwood', 'oil'], wants: ['tea', 'pepper', 'indigo'], yard: 1, supply: 1.3, blurb: '矿工与锚匠的镇子，叮当声不断' },
  { id: 'ji', name: '极光湾', region: 'frost', x: 35, y: 15, rx: 4, ry: 3, size: 1.1, makes: ['amber', 'oil', 'fish'], wants: ['sugar', 'canvas', 'pots', 'pearl'], yard: 1, supply: 1.2, blurb: '夜里天空会发绿光的海湾' },
  { id: 'qing', name: '青藤港', region: 'jade', x: 9, y: 31, rx: 5, ry: 3, size: 1.4, makes: ['rice', 'sugar', 'indigo'], wants: ['tools', 'copper', 'salt', 'oil'], yard: 2, supply: 0.8, blurb: '藤蔓爬满栈桥的南方粮仓港' },
  { id: 'shan', name: '珊瑚堡', region: 'jade', x: 22, y: 27, rx: 4, ry: 3, size: 1.7, makes: ['pearl', 'pepper', 'sugar'], wants: ['canvas', 'ironwood', 'tea', 'pots'], yard: 3, supply: 0.85, blurb: '建在珊瑚礁上的富港，珍珠行最多' },
  { id: 'ye', name: '椰影镇', region: 'jade', x: 31, y: 33, rx: 4, ry: 2, size: 1.0, makes: ['rice', 'oil', 'pepper'], wants: ['tools', 'copper', 'amber', 'fish'], yard: 1, supply: 0.8, blurb: '椰林遮天的小镇，日子过得慢' },
  { id: 'tong', name: '铜砂城', region: 'sand', x: 44, y: 26, rx: 5, ry: 4, size: 1.8, makes: ['copper', 'pots', 'salt'], wants: ['rice', 'ironwood', 'tea', 'pearl'], yard: 4, supply: 1.0, blurb: '赤沙海岸最大的城，唯一能造远洋快船的船坞' },
  { id: 'tuo', name: '驼影港', region: 'sand', x: 53, y: 32, rx: 4, ry: 3, size: 1.1, makes: ['indigo', 'pots', 'pepper'], wants: ['fish', 'canvas', 'sugar', 'oil'], yard: 2, supply: 1.1, blurb: '商队与商船交汇的沙湾' },
  { id: 'yan', name: '盐泉镇', region: 'sand', x: 51, y: 21, rx: 3, ry: 3, size: 1.0, makes: ['salt', 'fish', 'tools'], wants: ['ironwood', 'rice', 'pearl', 'canvas'], yard: 1, supply: 1.15, blurb: '海边晒盐的白色小镇' },
];
export const PORT_BY_ID: Record<string, PortDef> = Object.fromEntries(PORTS.map((p) => [p.id, p]));

/** 不带港口的陪衬岛（暗礁、无人岛） */
export const FILLER_ISLANDS: { x: number; y: number; rx: number; ry: number }[] = [
  { x: 29, y: 21, rx: 3, ry: 3 },
  { x: 27, y: 6, rx: 3, ry: 2 },
  { x: 41, y: 35, rx: 3, ry: 2 },
  { x: 16, y: 36, rx: 2, ry: 1.5 },
  { x: 56, y: 5, rx: 2, ry: 2 },
  { x: 3, y: 15, rx: 2, ry: 2 },
  { x: 40, y: 20, rx: 2, ry: 1.5 },
];

export interface ShipType {
  id: string;
  name: string;
  tier: number;
  price: number;
  /** 货舱格数 */
  cargo: number;
  /** 无风速度（格/天） */
  speed: number;
  crewMin: number;
  crewMax: number;
  hull: number;
  /** 食物与淡水各自的容量 */
  supply: number;
  /** 逆风时能保留的速度比例 */
  upwind: number;
  /** 买入此型号需要的声望 */
  rep: number;
  /** 能装几门火炮 */
  gunSlots: number;
  blurb: string;
}
export const SHIPS: ShipType[] = [
  { id: 'lark', name: '雀鹞艇', tier: 1, price: 1500, cargo: 40, speed: 4.4, crewMin: 3, crewMax: 10, hull: 60, supply: 70, upwind: 0.6, rep: 0, gunSlots: 3, blurb: '单桅小艇，船小灵活，适合跑短途' },
  { id: 'swallow', name: '双桅燕', tier: 2, price: 5200, cargo: 90, speed: 4.1, crewMin: 6, crewMax: 22, hull: 100, supply: 150, upwind: 0.5, rep: 4, gunSlots: 5, blurb: '双桅贸易船，载货与速度折中' },
  { id: 'whale', name: '宽肚鲸商', tier: 3, price: 13500, cargo: 190, speed: 3.3, crewMin: 12, crewMax: 40, hull: 170, supply: 300, upwind: 0.38, rep: 10, gunSlots: 9, blurb: '三桅宽船，能装很多货，但慢且怕逆风' },
  { id: 'hawk', name: '破浪鹰', tier: 4, price: 19000, cargo: 125, speed: 5.3, crewMin: 10, crewMax: 30, hull: 120, supply: 230, upwind: 0.55, rep: 18, gunSlots: 7, blurb: '远洋快船，船身狭长，跑得最快' },
];
export const SHIP_BY_ID: Record<string, ShipType> = Object.fromEntries(SHIPS.map((s) => [s.id, s]));

export const DAYS_PER_QUARTER = 90;
export const QUARTER_NAMES = ['春', '夏', '秋', '冬'];
