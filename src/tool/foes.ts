// 敌船设定表（全部原创）。数据驱动：想加一种敌人，只要在 FOES 里加一行。
export type FoeKind = 'pirate' | 'hostile';
export type FoeStyle = 'boarder' | 'gunner';

export interface FoeDef {
  id: string;
  name: string;
  faction: string;
  /** pirate 可以交买路钱了事；hostile 是敌对势力的船，不收钱 */
  kind: FoeKind;
  /** boarder 一心接舷；gunner 保持距离炮击 */
  style: FoeStyle;
  hull: number;
  crew: number;
  guns: number;
  /** 相对航速，1 = 雀鹞艇满员无风 */
  speed: number;
  /** 肉搏战力系数 */
  melee: number;
  /** 出现在哪个威胁等级区间 */
  levels: [number, number];
  weight: number;
  /** 战利品金币区间 */
  gold: [number, number];
  /** 战利品货物件数区间 */
  goods: [number, number];
  blurb: string;
}

export const FOES: FoeDef[] = [
  { id: 'shark', name: '鬣鲨小艇', faction: '浅滩贼', kind: 'pirate', style: 'boarder', hull: 26, crew: 4, guns: 0, speed: 0.95, melee: 1.0, levels: [1, 2], weight: 6, gold: [30, 80], goods: [2, 6], blurb: '几个渔民凑出来的小艇，专挑落单的船下手' },
  { id: 'crow', name: '断桅会快桨船', faction: '断桅会', kind: 'pirate', style: 'boarder', hull: 42, crew: 7, guns: 1, speed: 1.05, melee: 1.1, levels: [2, 3], weight: 5, gold: [60, 140], goods: [4, 10], blurb: '桅杆断过一次又接上的老船，船上全是亡命徒' },
  { id: 'rival', name: '对手商号的私掠船', faction: '潮信商号', kind: 'hostile', style: 'boarder', hull: 60, crew: 10, guns: 2, speed: 1.0, melee: 1.0, levels: [3, 4], weight: 3, gold: [100, 200], goods: [6, 12], blurb: '商号雇来的武装船，专门扣下对手的货' },
  { id: 'tide', name: '黑潮帮武装商船', faction: '黑潮帮', kind: 'pirate', style: 'gunner', hull: 74, crew: 12, guns: 3, speed: 0.92, melee: 1.0, levels: [3, 4], weight: 5, gold: [120, 260], goods: [6, 14], blurb: '商船改的炮艇，喜欢远远地先打一轮' },
  { id: 'patrol', name: '封海联盟缉拿船', faction: '封海联盟', kind: 'hostile', style: 'gunner', hull: 88, crew: 14, guns: 4, speed: 1.0, melee: 1.0, levels: [4, 5], weight: 3, gold: [150, 320], goods: [8, 16], blurb: '自封海上执法的联盟，见船就要「查货」' },
  { id: 'raven', name: '雾鸦团巡弋舰', faction: '雾鸦团', kind: 'pirate', style: 'gunner', hull: 108, crew: 18, guns: 5, speed: 1.0, melee: 1.1, levels: [4, 5], weight: 4, gold: [200, 420], goods: [10, 18], blurb: '大雾天里最可怕的影子，炮火又准又密' },
  { id: 'king', name: '赤浪王的旗舰「焚帆号」', faction: '赤浪帮', kind: 'pirate', style: 'boarder', hull: 150, crew: 28, guns: 7, speed: 0.95, melee: 1.25, levels: [5, 5], weight: 1, gold: [500, 900], goods: [14, 24], blurb: '传闻中从不空手而归的海盗王' },
];
export const FOE_BY_ID: Record<string, FoeDef> = Object.fromEntries(FOES.map((f) => [f.id, f]));
