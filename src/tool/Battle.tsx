// 海战界面：画面 + 双方状态 + 行动按钮 + 战报。
import { useEffect, useRef } from 'react';
import { Anchor, Crosshair, Flag, Handshake, MoveHorizontal, Swords, Wind } from 'lucide-react';
import { ACTION_NAMES, DIST_NAMES, combatOptions, type CombatAction } from './combat';
import { FOE_BY_ID } from './foes';
import { fleetGuns, meleePower } from './fleet';
import { drawBattle } from './render';
import { DIR_NAMES, STRENGTH_NAMES, windAt } from './sailing';
import { fleetShips, totalCrew, typeOf, type GameState } from './state';
import { Bar } from './parts';

const ICONS: Record<CombatAction, typeof Swords> = { fire: Crosshair, close: MoveHorizontal, open: MoveHorizontal, gauge: Wind, board: Swords, flee: Flag, pay: Handshake };
const OUTCOME_TONE: Record<string, string> = { 'won-sunk': 'ok', 'won-boarded': 'ok', 'foe-fled': 'ok', fled: '', paid: '', standoff: '', 'lost-boarded': 'bad', sunk: 'bad' };

export function BattleView({ game, onAct, onEnd }: { game: GameState; onAct: (a: CombatAction) => void; onEnd: () => void }) {
  const c = game.combat!;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawBattle(ref.current, game); }, [game]);
  const wind = windAt(game.seed, Math.floor(game.t));
  const def = FOE_BY_ID[c.foe.def];
  const options = combatOptions(game);
  const hull = fleetShips(game).reduce((a, x) => a + x.hull, 0);
  const hullMax = fleetShips(game).reduce((a, x) => a + typeOf(x).hull, 0);
  return (
    <div className="ot-battle">
      <div className="ot-battle-top">
        <div className="ot-fighter">
          <b>{game.ship.name}{game.consorts.length ? ` 等 ${game.consorts.length + 1} 艘` : ''}</b>
          <Bar value={hull} max={hullMax} label={`船体 ${Math.round(hull)}/${hullMax}`} />
          <span className="k-muted ot-line">船员 {totalCrew(game)}{game.guards ? ` · 护卫 ${game.guards}` : ''} · 可开火 {fleetGuns(game)} 门 · 肉搏 {Math.round(meleePower(game))}</span>
        </div>
        <div className="ot-vs">
          <span className="ot-tag">第 {c.round} 回合</span>
          <span className="ot-dist" title="1 贴舷 · 4 远">距离：<b>{DIST_NAMES[c.dist]}</b></span>
          <span className="ot-dist"><Wind size={13} /> {DIR_NAMES[wind.from]}风 · {STRENGTH_NAMES[wind.strength]} · {c.gauge ? '我方占上风' : '敌方占上风'}</span>
        </div>
        <div className="ot-fighter foe">
          <div><b>{c.foe.name}</b><span className="ot-tag">{def.faction}{def.kind === 'hostile' ? ' · 敌对' : ''}</span></div>
          <Bar value={c.foe.hull} max={c.foe.hullMax} label={`船体 ${c.foe.hull}/${c.foe.hullMax}`} tone={c.foe.hull / c.foe.hullMax < 0.3 ? 'err' : undefined} />
          <span className="k-muted ot-line">船员约 {c.foe.crew} · 火炮 {c.foe.guns} 门 · {def.style === 'boarder' ? '擅长接舷' : '擅长炮击'}</span>
        </div>
      </div>
      <canvas ref={ref} className="ot-battle-cv" width={960} height={300} aria-label="海战画面" />
      {c.done ? (
        <div className={`ot-result ${OUTCOME_TONE[c.done.outcome]}`}>
          <b>{c.done.text}</b>
          <button className="k-btn primary" onClick={onEnd}><Anchor size={15} />继续航行</button>
        </div>
      ) : (
        <div className="ot-actions" role="group" aria-label="海战行动">
          {options.map((o) => {
            const I = ICONS[o.action];
            return (
              <button key={o.action} className="k-btn ot-act" disabled={!o.enabled} onClick={() => onAct(o.action)} title={o.enabled ? o.hint : o.why}>
                <I size={15} />{ACTION_NAMES[o.action]}
                <span className="ot-act-sub">{o.enabled ? o.hint : o.why}</span>
              </button>
            );
          })}
        </div>
      )}
      <ol className="ot-log ot-battle-log">{[...c.log].reverse().slice(0, 7).map((l, i) => <li key={i}>{l}</li>)}</ol>
    </div>
  );
}
