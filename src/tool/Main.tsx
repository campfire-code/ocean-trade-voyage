// 主界面：顶部状态条 + 海图 / 港口 + 右侧船只、货物、目标与航海日志。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Anchor, FilePlus2, Save, Star, Wind, Coins } from 'lucide-react';
import { findRoute, generateMap, idx, isWater, inMap } from './mapgen';
import { renderTerrain } from './render';
import { SeaView } from './Sea';
import { PortView } from './Port';
import { Bar } from './parts';
import { goalLabel, goalProgress, daysLeft, quarterName } from './quest';
import { SLOT_COUNT, dropSlot, parseSave, putAuto, putSlot, readAuto, summarize, type Slots } from './save';
import { sampleSea, samplePort } from './samples';
import { DIR_NAMES, STRENGTH_NAMES, dailySupply, windAt } from './sailing';
import { cargoUsed, dateText, shipType, type GameState } from './state';
import { loadSlots, storeSlots } from './store';
import { sailStep, tryDock, undock, newGame, waitDay, type StepResult } from './turn';
import type { TradeResult } from './trade';
import { GOOD_BY_ID, PORT_BY_ID, SHIP_BY_ID } from './world';
import './tool.css';

type Toast = { text: string; ok: boolean } | null;
const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
};

const previewScene = () => (typeof location !== 'undefined' && location.pathname.endsWith('preview.html') ? new URLSearchParams(location.search).get('scene') : null);

export function Main() {
  const map = useMemo(() => generateMap(), []);
  const terrain = useMemo(() => renderTerrain(map), [map]);
  const scene = previewScene();
  const init = useMemo(() => {
    if (scene === 'port') return { state: samplePort(map), route: [] as [number, number][] };
    if (scene === 'sea') return sampleSea(map);
    return { state: newGame(map), route: [] as [number, number][] };
  }, [map, scene]);

  const [game, setGame] = useState<GameState>(init.state);
  const [route, setRoute] = useState<[number, number][]>(init.route);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [toast, setToast] = useState<Toast>(null);
  const [dialog, setDialog] = useState<null | 'save' | 'new'>(null);
  const [slots, setSlots] = useState<Slots>({});
  const [loaded, setLoaded] = useState(!!scene);
  const gameRef = useRef(game);
  gameRef.current = game;

  const say = useCallback((text: string, ok = true) => setToast({ text, ok }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(id);
  }, [toast]);

  // 启动：读取存档位；有自动存档就接着玩
  useEffect(() => {
    if (scene) return;
    void loadSlots().then((s) => {
      setSlots(s);
      const a = readAuto(s);
      if (a.ok) { setGame(a.state); say('已读取自动存档，继续上次的航程'); }
      setLoaded(true);
    });
  }, [scene, say]);

  // 自动存档：状态变化后稍等一下再写
  useEffect(() => {
    if (!loaded || scene) return;
    const id = setTimeout(() => {
      setSlots((cur) => { const n = putAuto(cur, game); void storeSlots(n); return n; });
    }, 900);
    return () => clearTimeout(id);
  }, [game, loaded, scene]);

  const afterStep = useCallback((r: StepResult) => {
    setGame(r.state);
    if (!r.ok) { setRoute([]); if (r.reason) say(r.reason, false); return; }
    if (r.interrupt) {
      setRoute([]);
      const last = r.state.log[r.state.log.length - 1];
      if (last) say(last.replace(/^第 \d+ 天 /, ''), !/耗尽|倒下|沉没|救/.test(last));
    }
  }, [say]);

  const step = useCallback((dx: number, dy: number) => {
    const g = gameRef.current;
    if (dx) setFacing(dx > 0 ? 1 : -1);
    afterStep(sailStep(map, g, dx, dy));
  }, [map, afterStep]);

  // 自动航行：每 70 毫秒走一格
  useEffect(() => {
    if (!route.length) return;
    const id = setTimeout(() => {
      const g = gameRef.current;
      const [nx, ny] = route[0];
      if (nx !== g.pos[0]) setFacing(nx > g.pos[0] ? 1 : -1);
      const r = sailStep(map, g, nx - g.pos[0], ny - g.pos[1]);
      if (r.ok && !r.interrupt) { setGame(r.state); setRoute((rt) => rt.slice(1)); } else afterStep(r);
    }, 70);
    return () => clearTimeout(id);
  }, [route, map, afterStep]);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (e.key === ' ') { setRoute([]); e.preventDefault(); return; }
      const d = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!d || gameRef.current.docked) return;
      e.preventDefault();
      setRoute([]);
      step(d[0], d[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, step]);

  const onTarget = (x: number, y: number) => {
    if (game.docked) return;
    const site = map.sites.find((s) => Math.abs(s.land[0] - x) <= 1 && Math.abs(s.land[1] - y) <= 1);
    const to: [number, number] | null = site ? site.dock : inMap(x, y) && isWater(map.tiles[idx(x, y)]) ? [x, y] : null;
    if (!to) return say('那里是陆地，选一块海面', false);
    if (to[0] === game.pos[0] && to[1] === game.pos[1]) return;
    const r = findRoute(map, game.pos, to);
    if (!r) return say('到不了那里', false);
    setRoute(r);
  };

  const act = (r: TradeResult) => { if (r.ok) setGame(r.state); say(r.msg, r.ok); };
  const canDock = !game.docked && map.sites.some((s) => s.dock[0] === game.pos[0] && s.dock[1] === game.pos[1]);
  const wind = windAt(game.seed, Math.floor(game.t));
  const type = shipType(game);

  const saveTo = (slot: number) => {
    const n = putSlot(slots, slot, game);
    setSlots(n); void storeSlots(n);
    say(`已存到存档位 ${slot}`);
  };
  const loadFrom = (text: string) => {
    const r = parseSave(text);
    if (!r.ok) return say(r.error, false);
    setRoute([]); setGame(r.state); setDialog(null); say('读档成功');
  };
  const removeSlot = (slot: number) => { const n = dropSlot(slots, slot); setSlots(n); void storeSlots(n); };
  const startNew = (captain: string) => {
    setRoute([]); setGame(newGame(map, Math.floor(Math.random() * 1e6), captain.trim() || '新船长')); setDialog(null); say('新的航程开始了');
  };

  return (
    <div className="ot-root">
      <div className="ot-hud">
        <span className="ot-hud-i"><b>{dateText(game.t)}</b><span className="k-muted">{quarterName(game.quest.index)} · 剩 {daysLeft(game)} 天</span></span>
        <span className="ot-hud-i" title="资金"><Coins size={15} /><b className="k-num">{Math.round(game.gold).toLocaleString()}</b> 金币</span>
        <span className="ot-hud-i" title="声望：影响招人价格与可买的船"><Star size={15} /><b className="k-num">{Math.floor(game.rep)}</b> 声望</span>
        <span className="ot-hud-i" title={`风从${DIR_NAMES[wind.from]}吹来`}>
          <Wind size={15} /><span className="ot-arrow" style={{ transform: `rotate(${((wind.from + 4) % 8) * 45}deg)` }}><ArrowUp size={15} /></span>
          <b>{DIR_NAMES[wind.from]}风</b><span className="k-muted">{STRENGTH_NAMES[wind.strength]}</span>
        </span>
        <span className="b-sp" />
        <button className="k-btn" onClick={() => setDialog('save')}><Save size={15} />存档 / 读档</button>
        <button className="k-btn" onClick={() => setDialog('new')}><FilePlus2 size={15} />新游戏</button>
      </div>

      <div className="ot-body">
        <div className="ot-main">
          {game.docked ? (
            <PortView game={game} act={act} onLeave={() => afterStep(undock(game))} onWait={() => afterStep(waitDay(game))} />
          ) : (
            <SeaView map={map} terrain={terrain} game={game} route={route} facing={facing} onTarget={onTarget} canDock={canDock} onDock={() => afterStep(tryDock(map, game))} />
          )}
          {toast && <div className={`ot-toast ${toast.ok ? '' : 'bad'}`} role="status">{toast.text}</div>}
        </div>

        <aside className="ot-side k-scroll">
          <section className="ot-sec">
            <h3><Anchor size={14} />{game.ship.name}<span className="ot-tag">{type.name}</span></h3>
            <Bar value={game.ship.hull} max={type.hull} label={`船体 ${Math.round(game.ship.hull)}/${type.hull}`} />
            <Bar value={game.ship.crew} max={type.crewMax} label={`船员 ${game.ship.crew}/${type.crewMax}`} tone={game.ship.crew <= type.crewMin ? 'err' : undefined} />
            <Bar value={game.ship.food} max={type.supply} label={`食物 ${game.ship.food}（${Math.floor(game.ship.food / dailySupply(game.ship.crew))} 天）`} />
            <Bar value={game.ship.water} max={type.supply} label={`淡水 ${game.ship.water}（${Math.floor(game.ship.water / dailySupply(game.ship.crew))} 天）`} />
            <div className="k-muted ot-line">{game.docked ? `停靠：${PORT_BY_ID[game.docked].name}` : `位置：海图 (${game.pos[0]}, ${game.pos[1]})`}</div>
          </section>
          <section className="ot-sec">
            <h3>货舱 <span className="k-muted k-num">{cargoUsed(game)}/{type.cargo}</span></h3>
            {Object.keys(game.cargo).length === 0 && <div className="k-muted ot-line">空的</div>}
            {Object.entries(game.cargo).map(([id, c]) => (
              <div key={id} className="ot-cargo"><span>{GOOD_BY_ID[id].name}</span><span className="k-num">{c.qty} 件 · 均价 {Math.round(c.cost)}</span></div>
            ))}
          </section>
          <section className="ot-sec">
            <h3>{quarterName(game.quest.index)}目标</h3>
            {game.quest.goals.map((g) => (
              <div key={g.id} className={`ot-goal${g.done ? ' done' : ''}`}>
                <div>{g.done ? '✓ ' : ''}{goalLabel(g)}</div>
                <Bar value={Math.min(goalProgress(game, g), g.target)} max={g.target} tone={g.done ? undefined : undefined} label={`${goalProgress(game, g)} / ${g.target}`} />
              </div>
            ))}
            <div className="k-muted ot-line">季度末结算：达成有奖金和声望，未达成扣声望。</div>
          </section>
          <section className="ot-sec">
            <h3>航海日志</h3>
            <ol className="ot-log">{[...game.log].reverse().slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}</ol>
          </section>
        </aside>
      </div>

      {dialog === 'save' && <SaveDialog slots={slots} onClose={() => setDialog(null)} onSave={saveTo} onLoad={loadFrom} onDrop={removeSlot} />}
      {dialog === 'new' && <NewDialog onClose={() => setDialog(null)} onStart={startNew} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="ot-modal" onClick={onClose}>
      <div className="ot-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ot-dialog-head"><b>{title}</b><button className="k-btn ghost" onClick={onClose}>关闭</button></div>
        {children}
      </div>
    </div>
  );
}

function SaveDialog({ slots, onClose, onSave, onLoad, onDrop }: { slots: Slots; onClose: () => void; onSave: (n: number) => void; onLoad: (t: string) => void; onDrop: (n: number) => void }) {
  const entries: (number | 'auto')[] = ['auto', ...Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)];
  return (
    <Modal title="存档 / 读档" onClose={onClose}>
      <div className="ot-slots">
        {entries.map((k) => {
          const text = slots[String(k)];
          const r = text ? parseSave(text) : null;
          const sm = r && r.ok ? summarize(r.state, r.savedAt) : null;
          return (
            <div key={k} className="ot-slot">
              <b>{k === 'auto' ? '自动存档' : `存档位 ${k}`}</b>
              <div className="ot-slot-info">
                {sm ? <>{sm.captain} · {sm.shipName} · {sm.quarter}<br /><span className="k-muted">{sm.date} · {sm.gold.toLocaleString()} 金币 · 声望 {sm.rep}{sm.savedAt ? ` · ${new Date(sm.savedAt).toLocaleString('zh-CN')}` : ''}</span></>
                  : r && !r.ok ? <span className="ot-why">{r.error}</span> : <span className="k-muted">空</span>}
              </div>
              <div className="ot-btns">
                {k !== 'auto' && <button className="k-btn" onClick={() => onSave(k)}>存入</button>}
                <button className="k-btn" disabled={!text} onClick={() => onLoad(text)}>读取</button>
                {k !== 'auto' && <button className="k-btn ghost" disabled={!text} onClick={() => onDrop(k)}>清空</button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="k-muted">存档保存在本机，不会上传。游戏会自动存到「自动存档」，下次打开接着玩。</p>
    </Modal>
  );
}

function NewDialog({ onClose, onStart }: { onClose: () => void; onStart: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Modal title="新游戏" onClose={onClose}>
      <p>重新开始会替换当前航程（当前进度如果没存到存档位，只会留在自动存档里，之后会被覆盖）。</p>
      <label className="ot-field">船长名字<input className="k-input" value={name} maxLength={12} placeholder="新船长" onChange={(e) => setName(e.target.value)} /></label>
      <div className="ot-btns"><button className="k-btn primary" onClick={() => onStart(name)}>出海</button><button className="k-btn" onClick={onClose}>取消</button></div>
      <p className="k-muted">起点：灰檐港，一艘{SHIP_BY_ID.lark.name}、800 金币、6 名船员。</p>
    </Modal>
  );
}
