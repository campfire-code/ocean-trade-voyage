// 主线：「潮汐账」。五章，每章两步，全部靠完成贸易和航行目标推进。剧情为原创。
import { pushLog, type GameState, type Scene } from './state';
import { GOOD_BY_ID, PORT_BY_ID, type GoodId } from './world';

export type Step =
  | { kind: 'deliver'; port: string; good: GoodId; qty: number; label: string; done: string }
  | { kind: 'visit'; port: string; label: string; done: string }
  | { kind: 'battle'; n: number; label: string; done: string }
  | { kind: 'wealth'; port: string; n: number; label: string; done: string }
  | { kind: 'reach'; x: number; y: number; r: number; label: string; done: string };

export interface Chapter {
  title: string;
  /** 在这个港口靠岸时开启本章 */
  hub: string;
  need: { traded?: number; rep?: number };
  intro: string;
  steps: Step[];
  outro: string;
  reward: { gold: number; rep: number };
}

/** 失落的止潮港所在的海面坐标 */
export const LOST_PORT: [number, number] = [31, 25];

export const CHAPTERS: Chapter[] = [
  {
    title: '漂来的账页', hub: 'hui', need: { traded: 150 },
    intro: '灰檐港酒馆的老板娘递来一页被海水泡过的账页，落款只有一个「苔」字。传闻老航图师苔婆在失踪前，把一本《潮汐账》撕成五页，散给了澜屿海的五个港口，账上记着一座从海图上消失的港口——止潮港。\n账页末尾写着：给白鲸湾的渔匠带 8 卷帆麻布，他会告诉你下一步。',
    steps: [
      { kind: 'deliver', port: 'jing', good: 'canvas', qty: 8, label: '把 8 件帆麻布送到白鲸湾', done: '渔匠接过帆麻布，从补网的线团里抽出另一页账：上面画着一座灯塔，旁边写着「去雾灯镇问茶园管家」。' },
      { kind: 'visit', port: 'wu', label: '到雾灯镇拜访茶园管家', done: '茶园管家把两页账拼在一起：墨迹是同一种靛蓝。账上说，止潮港有十二盏灯，澜屿海每个港口各守一盏。' },
    ],
    outro: '前两页拼上了。管家说第三页在极光湾的守灯人手里，但他不见生人。',
    reward: { gold: 150, rep: 1 },
  },
  {
    title: '守灯人的考验', hub: 'ji', need: { rep: 1 },
    intro: '极光湾的守灯人听了你的来意，摇摇头：「第三页被人抢先买走过一次，有一伙海盗也在找《潮汐账》。我得先知道你能不能在海上站稳脚。」\n他要你先击退一支拦路的海盗或敌船，再带 10 件陶罐回来给他修灯罩。',
    steps: [
      { kind: 'battle', n: 1, label: '在海上击退 1 支海盗或敌船', done: '你击退了拦路的船。守灯人在窗口看见了远处的炮烟，点了点头。' },
      { kind: 'deliver', port: 'ji', good: 'pots', qty: 10, label: '把 10 件陶罐送到极光湾', done: '灯罩修好，守灯人点亮了灯。他交出第三页：「十二盏灯里，有一盏是假的。」' },
    ],
    outro: '第三页写着铜砂城钱庄的名字。',
    reward: { gold: 300, rep: 2 },
  },
  {
    title: '钱庄的暗号', hub: 'tong', need: { rep: 3 },
    intro: '铜砂城钱庄的掌柜认得苔婆的字迹。「账页我可以给你看，」他说，「但我得先看看你的家底，也得验一验你带不带得来月光珍珠——那是苔婆当年的暗号。」',
    steps: [
      { kind: 'wealth', port: 'tong', n: 3000, label: '带着至少 3000 金币回到铜砂城', done: '掌柜翻了翻你的账本，满意地合上了：「有钱，说明你不是靠运气。」' },
      { kind: 'deliver', port: 'tong', good: 'pearl', qty: 3, label: '把 3 件月光珍珠送到铜砂城', done: '掌柜把珍珠对着光看了看，从保险柜里拿出第四页：「苔婆说，要找潮图，就去椰影镇。」' },
    ],
    outro: '第四页上画的是潮汐的涨落图，缺了最关键的一角。',
    reward: { gold: 500, rep: 3 },
  },
  {
    title: '椰影镇的潮图', hub: 'ye', need: { rep: 5 },
    intro: '椰影镇上有个老渔夫，据说年轻时跟苔婆出过海。「图缺一角，那一角在我脑子里，」他说，「但我老了，要把它刻在琥珀罗盘上才不会忘。给我 6 块松脂琥珀。」\n他还说：「最近有人在海上截商船，你要是能多撂倒几支，我就信你。」',
    steps: [
      { kind: 'deliver', port: 'ye', good: 'amber', qty: 6, label: '把 6 件松脂琥珀送到椰影镇', done: '渔夫把琥珀磨成一只小罗盘，刻上了潮汐的最后一角。' },
      { kind: 'battle', n: 2, label: '再击退 2 支海盗或敌船', done: '你又击退了两支船队。渔夫把罗盘交给你：「去珊瑚堡，那里有人会修最后一盏灯。」' },
    ],
    outro: '第五页就在罗盘背面：止潮港只在潮水退到最低、雾最浓的那一刻现身。',
    reward: { gold: 800, rep: 3 },
  },
  {
    title: '止潮港', hub: 'shan', need: { rep: 8 },
    intro: '珊瑚堡的造灯匠接过罗盘：「止潮港的灯塔塌了半边，要用铁脊木重新撑起来。木料备齐，罗盘会指给你海上的位置。」\n罗盘的针一直指向群岛中央的一片海——那里海图上什么都没有。',
    steps: [
      { kind: 'deliver', port: 'shan', good: 'ironwood', qty: 10, label: '把 10 件铁脊木送到珊瑚堡', done: '造灯匠让人把木料装上船：「罗盘亮的时候，就是潮水最低的时候。」' },
      { kind: 'reach', x: LOST_PORT[0], y: LOST_PORT[1], r: 1.5, label: '驶到群岛中央的海面（罗盘指向的位置）', done: '雾散开了。水面下，一座石砌的港口露出了尖顶，十二盏灯同时亮起——其中十一盏是苔婆留下的，第十二盏，是你的船灯。' },
    ],
    outro: '止潮港重新出现在澜屿海的海图上。苔婆的笔记里写着最后一行：「港口不是一个地方，是一群愿意把灯留给别人的人。」\n\n主线完成。澜屿海仍然在等你，继续做你的买卖吧，船长。',
    reward: { gold: 2500, rep: 8 },
  },
];

const openScene = (s: GameState, id: string, title: string, text: string) => {
  const sc: Scene = { id, title, text, choices: ['记下了'] };
  if (!s.scene && !s.combat) s.scene = sc;
};

export const newStory = (): GameState['story'] => ({ chapter: 0, started: false, step: 0, base: 0, done: false });
export const currentChapter = (s: GameState): Chapter | null => (s.story.done ? null : CHAPTERS[s.story.chapter] ?? null);
export const currentStep = (s: GameState): Step | null => {
  const c = currentChapter(s);
  return c && s.story.started ? c.steps[s.story.step] ?? null : null;
};

function stepDone(s: GameState, st: Step, portId: string | null): boolean {
  switch (st.kind) {
    case 'visit': return portId === st.port;
    case 'deliver': return portId === st.port && (s.cargo[st.good]?.qty ?? 0) >= st.qty;
    case 'wealth': return portId === st.port && s.gold >= st.n;
    case 'battle': return s.stats.battlesWon - s.story.base >= st.n;
    case 'reach': return !portId && Math.hypot(s.pos[0] - st.x, s.pos[1] - st.y) <= st.r;
  }
}

function finishChapter(s: GameState, c: Chapter) {
  s.gold += c.reward.gold;
  s.rep = Math.round((s.rep + c.reward.rep) * 100) / 100;
  pushLog(s, `主线「${c.title}」完成：奖励 ${c.reward.gold} 金币、声望 ${c.reward.rep}`);
  openScene(s, `story-end-${s.story.chapter}`, `${c.title}（完成）`, `${c.outro}\n\n奖励：${c.reward.gold} 金币，声望 +${c.reward.rep}`);
  if (s.story.chapter >= CHAPTERS.length - 1) { s.story.done = true; s.story.started = false; return; }
  s.story = { chapter: s.story.chapter + 1, started: false, step: 0, base: s.stats.battlesWon, done: false };
}

/** 检查当前这一步是否完成；完成了就推进（可连续推进多步）。portId 为 null 表示在海上。 */
export function storyTick(s: GameState, portId: string | null) {
  // 开启新一章
  const ch = currentChapter(s);
  if (!ch) return;
  if (!s.story.started && portId === ch.hub) {
    const t = ch.need.traded ?? 0, r = ch.need.rep ?? 0;
    if (s.stats.traded >= t && s.rep >= r) {
      s.story.started = true;
      s.story.step = 0;
      s.story.base = s.stats.battlesWon;
      pushLog(s, `主线开启：第 ${s.story.chapter + 1} 章「${ch.title}」`);
      openScene(s, `story-${s.story.chapter}`, `第 ${s.story.chapter + 1} 章　${ch.title}`, ch.intro + `\n\n目标：${ch.steps[0].label}`);
    }
  }
  for (let guard = 0; guard < 4; guard++) {
    const c = currentChapter(s), st = currentStep(s);
    if (!c || !st || !stepDone(s, st, portId)) return;
    if (st.kind === 'deliver') {
      const it = s.cargo[st.good];
      it.qty -= st.qty;
      if (it.qty <= 0) delete s.cargo[st.good];
    }
    pushLog(s, `主线进展：${st.done}`);
    if (s.story.step + 1 >= c.steps.length) {
      finishChapter(s, c);
      return;
    }
    s.story.step += 1;
    s.story.base = s.stats.battlesWon;
    openScene(s, `story-${s.story.chapter}-${s.story.step}`, c.title, `${st.done}\n\n下一步：${c.steps[s.story.step].label}`);
  }
}

export interface StoryStatus { chapterNo: number; total: number; title: string; objective: string; progress: string; locked: string | null; finished: boolean }

export function storyStatus(s: GameState): StoryStatus {
  const total = CHAPTERS.length;
  if (s.story.done) return { chapterNo: total, total, title: '止潮港', objective: '主线已完成，继续经营吧', progress: '', locked: null, finished: true };
  const c = CHAPTERS[s.story.chapter];
  const st = currentStep(s);
  if (!st) {
    const parts: string[] = [];
    if (c.need.traded && s.stats.traded < c.need.traded) parts.push(`累计成交 ${c.need.traded} 金币`);
    if (c.need.rep && s.rep < c.need.rep) parts.push(`声望 ${c.need.rep}`);
    return { chapterNo: s.story.chapter + 1, total, title: c.title, objective: `到${PORT_BY_ID[c.hub].name}靠岸，开启本章`, progress: '', locked: parts.length ? `还需要：${parts.join('、')}` : null, finished: false };
  }
  let progress = '';
  if (st.kind === 'deliver') progress = `${Math.min(s.cargo[st.good]?.qty ?? 0, st.qty)} / ${st.qty} 件${GOOD_BY_ID[st.good].name}在船`;
  else if (st.kind === 'battle') progress = `${Math.min(s.stats.battlesWon - s.story.base, st.n)} / ${st.n}`;
  else if (st.kind === 'wealth') progress = `${Math.round(s.gold)} / ${st.n} 金币`;
  else if (st.kind === 'reach') progress = `距目标 ${Math.round(Math.hypot(s.pos[0] - st.x, s.pos[1] - st.y))} 格`;
  return { chapterNo: s.story.chapter + 1, total, title: c.title, objective: st.label, progress, locked: null, finished: false };
}
