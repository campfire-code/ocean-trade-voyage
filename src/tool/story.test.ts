import { describe, expect, it } from 'vitest';
import { findRoute, generateMap, idx, isWater } from './mapgen';
import { CHAPTERS, LOST_PORT, currentChapter, currentStep, storyStatus, storyTick } from './story';
import { chooseScene, dockAt, newGame, sailStep, undock, waitDay } from './turn';
import { parseSave, serializeSave } from './save';
import { GOOD_BY_ID, PORTS, PORT_BY_ID } from './world';
import type { GameState } from './state';

const map = generateMap();
const fresh = (): GameState => newGame(map, 5, '测试');
/** 把状态摆成「在 port 港口，满足 chapter 的开启条件」 */
const ready = (s: GameState, port: string, tradedEnough = true): GameState => {
  s.docked = port;
  if (tradedEnough) s.stats.traded = 1000;
  s.rep = 20;
  return s;
};
const give = (s: GameState, good: string, qty: number) => { s.cargo[good] = { qty: (s.cargo[good]?.qty ?? 0) + qty, cost: 10 }; };

describe('主线数据', () => {
  it('共 5 章，每章至少 2 步，标题和奖励齐全', () => {
    expect(CHAPTERS).toHaveLength(5);
    for (const c of CHAPTERS) {
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.title.length).toBeGreaterThan(1);
      expect(c.intro.length).toBeGreaterThan(30);
      expect(c.outro.length).toBeGreaterThan(10);
      expect(c.reward.gold).toBeGreaterThan(0);
    }
  });
  it('章节里提到的港口和商品都存在，目标数量合理', () => {
    for (const c of CHAPTERS) {
      expect(PORT_BY_ID[c.hub]).toBeDefined();
      for (const st of c.steps) {
        if ('port' in st) expect(PORT_BY_ID[st.port]).toBeDefined();
        if (st.kind === 'deliver') { expect(GOOD_BY_ID[st.good]).toBeDefined(); expect(st.qty).toBeGreaterThan(0); expect(st.qty).toBeLessThanOrEqual(40); }
        expect(st.label.length).toBeGreaterThan(3);
        expect(st.done.length).toBeGreaterThan(10);
      }
    }
  });
  it('奖励逐章递增', () => {
    for (let i = 1; i < CHAPTERS.length; i++) expect(CHAPTERS[i].reward.gold).toBeGreaterThan(CHAPTERS[i - 1].reward.gold);
  });
  it('失落港的位置是一片深水，离所有港口都很远，而且开得到', () => {
    expect(isWater(map.tiles[idx(LOST_PORT[0], LOST_PORT[1])])).toBe(true);
    for (const p of PORTS) expect(Math.hypot(p.x - LOST_PORT[0], p.y - LOST_PORT[1])).toBeGreaterThan(5);
    const hui = map.sites.find((x) => x.id === 'hui')!;
    expect(findRoute(map, hui.dock, LOST_PORT)).not.toBeNull();
  });
  it('最后一步是驶到海面上的指定位置', () => {
    const last = CHAPTERS[4].steps[CHAPTERS[4].steps.length - 1];
    expect(last.kind).toBe('reach');
  });
});

describe('开启与推进', () => {
  it('新游戏主线还没开始', () => {
    const s = fresh();
    expect(s.story).toEqual({ chapter: 0, started: false, step: 0, base: 0, done: false });
    expect(currentStep(s)).toBeNull();
    expect(currentChapter(s)!.title).toBe(CHAPTERS[0].title);
  });
  it('成交额不够时，在灰檐港靠岸也不会开启', () => {
    const s = ready(fresh(), 'hui', false);
    storyTick(s, 'hui');
    expect(s.story.started).toBe(false);
    expect(storyStatus(s).locked).toMatch(/累计成交/);
  });
  it('成交额够了，在灰檐港靠岸开启第一章并弹出剧情', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    expect(s.story.started).toBe(true);
    expect(s.scene!.title).toContain('漂来的账页');
    expect(s.scene!.choices).toEqual(['记下了']);
    expect(s.log.some((l) => l.includes('主线开启'))).toBe(true);
  });
  it('不在开启港口不会开启', () => {
    const s = ready(fresh(), 'wu');
    storyTick(s, 'wu');
    expect(s.story.started).toBe(false);
  });
  it('剧情场景点「记下了」就消失', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    const r = chooseScene(map, s, 0);
    expect(r.ok).toBe(true);
    expect(r.state.scene).toBeNull();
  });
  it('送货步骤：货不够不推进，够了扣货并推进', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    s.scene = null;
    give(s, 'canvas', 7);
    storyTick(s, 'jing');
    expect(s.story.step).toBe(0);
    give(s, 'canvas', 3);
    storyTick(s, 'jing');
    expect(s.story.step).toBe(1);
    expect(s.cargo.canvas.qty).toBe(2);
  });
  it('送货要到指定港口才算', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    give(s, 'canvas', 8);
    storyTick(s, 'wu');
    expect(s.story.step).toBe(0);
    expect(s.cargo.canvas.qty).toBe(8);
  });
  it('拜访步骤 + 章节结算：发奖励、进入下一章（需重新到枢纽港开启）', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    s.scene = null;
    give(s, 'canvas', 8);
    storyTick(s, 'jing');
    s.scene = null;
    const gold0 = s.gold, rep0 = s.rep;
    storyTick(s, 'wu');
    expect(s.gold).toBe(gold0 + CHAPTERS[0].reward.gold);
    expect(s.rep).toBe(rep0 + CHAPTERS[0].reward.rep);
    expect(s.story.chapter).toBe(1);
    expect(s.story.started).toBe(false);
    expect(s.scene!.title).toContain('完成');
  });
  it('声望不够不能开启后面的章节', () => {
    const s = ready(fresh(), 'ji');
    s.rep = 0;
    s.story = { chapter: 1, started: false, step: 0, base: 0, done: false };
    storyTick(s, 'ji');
    expect(s.story.started).toBe(false);
    expect(storyStatus(s).locked).toMatch(/声望/);
  });
  it('击败敌船步骤只算开启之后的胜仗', () => {
    const s = ready(fresh(), 'ji');
    s.stats.battlesWon = 3;
    s.story = { chapter: 1, started: false, step: 0, base: 0, done: false };
    storyTick(s, 'ji');
    expect(s.story.started).toBe(true);
    expect(s.story.base).toBe(3);
    s.scene = null;
    storyTick(s, null);
    expect(s.story.step).toBe(0);
    expect(storyStatus(s).progress).toBe('0 / 1');
    s.stats.battlesWon = 4;
    storyTick(s, null);
    expect(s.story.step).toBe(1);
  });
  it('资金步骤要在指定港口靠岸时钱够', () => {
    const s = ready(fresh(), 'tong');
    s.story = { chapter: 2, started: false, step: 0, base: 0, done: false };
    s.gold = 2000;
    storyTick(s, 'tong');
    s.scene = null;
    expect(s.story.step).toBe(0);
    expect(storyStatus(s).progress).toMatch(/2000/);
    s.gold = 3500;
    storyTick(s, 'tong');
    expect(s.story.step).toBe(1);
  });
  it('场景被占用时，剧情仍记进日志，不会丢进度', () => {
    const s = ready(fresh(), 'hui');
    s.scene = { id: 'fog', title: '大雾', text: 'x', choices: ['a', 'b'] };
    storyTick(s, 'hui');
    expect(s.story.started).toBe(true);
    expect(s.scene.id).toBe('fog');
  });
});

describe('通关', () => {
  it('从头到尾走完五章：每章奖励到账，最后标记完成', () => {
    const s = fresh();
    s.rep = 30;
    s.stats.traded = 1000;
    const goldStart = s.gold;
    let expected = goldStart;
    for (let ci = 0; ci < CHAPTERS.length; ci++) {
      const c = CHAPTERS[ci];
      s.scene = null;
      storyTick(s, c.hub);
      expect(s.story.started).toBe(true);
      expect(s.story.chapter).toBe(ci);
      for (const st of c.steps) {
        s.scene = null;
        if (st.kind === 'deliver') { give(s, st.good, st.qty); storyTick(s, st.port); }
        else if (st.kind === 'visit') storyTick(s, st.port);
        else if (st.kind === 'wealth') { s.gold = st.n + 10; storyTick(s, st.port); }
        else if (st.kind === 'battle') { s.stats.battlesWon += st.n; storyTick(s, null); }
        else { s.pos = [Math.round(st.x), Math.round(st.y)]; storyTick(s, null); }
      }
      expected = s.gold;
    }
    expect(s.story.done).toBe(true);
    expect(s.story.started).toBe(false);
    expect(currentChapter(s)).toBeNull();
    expect(storyStatus(s).finished).toBe(true);
    expect(s.gold).toBe(expected);
    expect(s.gold).toBeGreaterThan(goldStart);
    expect(s.scene!.title).toContain('完成');
    expect(s.scene!.text).toContain('主线完成');
  });
  it('驶入失落港海域才算到达，海上走一步也会检查', () => {
    const s = fresh();
    s.rep = 30;
    s.story = { chapter: 4, started: true, step: 1, base: 0, done: false };
    s.docked = null;
    s.pos = [LOST_PORT[0] - 1, LOST_PORT[1]];
    s.ship.food = 60; s.ship.water = 60;
    const far = sailStep(map, { ...s, pos: [LOST_PORT[0] - 4, LOST_PORT[1]] }, 1, 0);
    expect(far.state.story.done).toBe(false);
    const r = sailStep(map, s, 1, 0);
    expect(r.state.story.done).toBe(true);
  });
  it('完成后状态栏显示主线已完成', () => {
    const s = fresh();
    s.story.done = true;
    const st = storyStatus(s);
    expect(st.chapterNo).toBe(5);
    expect(st.objective).toContain('完成');
  });
});

describe('存档与主线', () => {
  it('进行中的主线随存档保存', () => {
    const s = ready(fresh(), 'hui');
    storyTick(s, 'hui');
    give(s, 'canvas', 8);
    storyTick(s, 'jing');
    const r = parseSave(serializeSave(s));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.state.story).toEqual(s.story); expect(r.state.scene).toEqual(s.scene); }
  });
  it('靠港会自动检查主线（dockAt 触发）', () => {
    const s = ready(undock(fresh()).state, 'hui');
    s.docked = null;
    dockAt(s, 'hui');
    expect(s.story.started).toBe(true);
  });
  it('休整一天也会检查主线', () => {
    const s = ready(fresh(), 'hui');
    const r = waitDay(s);
    expect(r.state.story.started).toBe(true);
  });
});
