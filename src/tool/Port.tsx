// 港口界面：交易所、补给站、船坞、酒馆。
import { useState } from 'react';
import { Anchor, Beer, Hammer, Package, Store, Wrench, Users, Wheat } from 'lucide-react';
import { priceTier } from './pricing';
import { dailySupply } from './sailing';
import { REL_MIN, cargoUsed, dayNumber, shipType, type GameState } from './state';
import {
  FOOD_PRICE, ROUND_PRICE, buyGood, buyPriceOf, buyShip, buySupply, canBuildHere, currentMid, dismiss, listenRumors, recruit,
  recruitPrice, repairPrice, repairShip, sellGood, sellPriceOf, supplyPrice, tradeInValue, type TradeResult,
} from './trade';
import { GOODS, PORT_BY_ID, REGION_BY_ID, SHIPS, SHIP_BY_ID } from './world';
import { Bar } from './parts';

type Tab = 'market' | 'supply' | 'yard' | 'tavern';
const TABS: [Tab, string, typeof Store][] = [['market', '交易所', Store], ['supply', '补给站', Wheat], ['yard', '船坞', Hammer], ['tavern', '酒馆', Beer]];
const EV_TEXT = { shortage: '紧缺', glut: '过剩', festival: '庆典' } as const;

export type Act = (r: TradeResult) => void;

export function PortView({ game, act, onLeave, onWait }: { game: GameState; act: Act; onLeave: () => void; onWait: () => void }) {
  const [tab, setTab] = useState<Tab>('market');
  const port = PORT_BY_ID[game.docked!];
  const region = REGION_BY_ID[port.region];
  const est = (game.relations[port.id] ?? 0) >= REL_MIN;
  return (
    <div className="ot-port">
      <div className="ot-port-head">
        <div className="ot-port-title">
          <Anchor size={20} />
          <div>
            <b>{port.name}</b> <span className="ot-tag">{region.name}</span>{est && <span className="ot-tag ok">已建立贸易关系</span>}
            <div className="k-muted ot-blurb">{port.blurb}</div>
          </div>
        </div>
        <span className="b-sp" />
        <button className="k-btn" onClick={onWait} title="停靠一天，等行情恢复；工资照付">休整一天</button>
        <button className="k-btn primary" onClick={onLeave}>起航</button>
      </div>
      <div className="ot-tabs" role="tablist" aria-label="港口设施">
        {TABS.map(([k, l, I]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`k-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}><I size={14} />{l}</button>
        ))}
      </div>
      <div className="ot-port-body k-scroll">
        {tab === 'market' && <Market game={game} act={act} />}
        {tab === 'supply' && <Supply game={game} act={act} />}
        {tab === 'yard' && <Yard game={game} act={act} />}
        {tab === 'tavern' && <Tavern game={game} act={act} />}
      </div>
    </div>
  );
}

function Market({ game, act }: { game: GameState; act: Act }) {
  const port = game.docked!;
  const day = dayNumber(game);
  return (
    <>
      <div className="ot-cap k-muted">货舱 <b className="k-num">{cargoUsed(game)}/{shipType(game).cargo}</b> 格 · 资金 <b className="k-num">{Math.round(game.gold)}</b> 金币 · 价格随库存与事件波动，买卖都有 5% 差价</div>
      <table className="k-table ot-market">
        <thead><tr><th>商品</th><th className="r">买入价</th><th className="r">卖出价</th><th className="r">港口库存</th><th>行情</th><th className="r">在船（均价）</th><th>买入</th><th>卖出</th></tr></thead>
        <tbody>
          {GOODS.map((g) => {
            const mid = currentMid(game, port, g.id);
            const tier = priceTier(mid, g.id);
            const held = game.cargo[g.id];
            const evs = game.events.filter((e) => e.port === port && e.good === g.id && e.until >= day);
            return (
              <tr key={g.id}>
                <td title={g.note}><b>{g.name}</b>{g.size > 1 && <span className="ot-tag">占 {g.size} 格</span>}</td>
                <td className="r k-num">{buyPriceOf(game, port, g.id)}</td>
                <td className="r k-num">{sellPriceOf(game, port, g.id)}</td>
                <td className="r k-num">{Math.round(game.stock[port][g.id])}</td>
                <td>
                  <span className={`ot-tier ${tier}`}>{tier === 'cheap' ? '便宜' : tier === 'dear' ? '偏贵' : '平价'}</span>
                  {evs.map((e) => <span key={e.id} className={`ot-tag ev-${e.kind}`} title={e.text}>{EV_TEXT[e.kind]}</span>)}
                </td>
                <td className="r k-num">{held ? `${held.qty}（${Math.round(held.cost)}）` : '—'}</td>
                <td><div className="ot-btns">{[1, 10, 999].map((n) => <button key={n} className="k-btn ot-sm" onClick={() => act(buyGood(game, g.id, n))}>{n === 999 ? '买满' : `买${n}`}</button>)}</div></td>
                <td><div className="ot-btns">{[1, 10, 999].map((n) => <button key={n} className="k-btn ot-sm" disabled={!held} onClick={() => act(sellGood(game, g.id, n))}>{n === 999 ? '全卖' : `卖${n}`}</button>)}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Supply({ game, act }: { game: GameState; act: Act }) {
  const port = game.docked!;
  const t = shipType(game);
  const need = dailySupply(game.ship.crew);
  const rows: ['food' | 'water', string][] = [['food', '食物'], ['water', '淡水']];
  return (
    <div className="ot-cards">
      {rows.map(([k, name]) => (
        <div key={k} className="ot-card">
          <h4>{name}</h4>
          <Bar value={game.ship[k]} max={t.supply} label={`${game.ship[k]} / ${t.supply} 份 · 够航行 ${Math.floor(game.ship[k] / need)} 天`} />
          <p className="k-muted">单价 {supplyPrice(port, k)} 金币/份（本港系数 {PORT_BY_ID[port].supply}）。当前 {game.ship.crew} 名船员，每天各耗 {need} 份。</p>
          <div className="ot-btns">
            {[10, 30].map((n) => <button key={n} className="k-btn" onClick={() => act(buySupply(game, k, n))}>买 {n} 份</button>)}
            <button className="k-btn primary" onClick={() => act(buySupply(game, k, 9999))}>补满</button>
          </div>
        </div>
      ))}
      <p className="k-muted ot-wide">补给耗尽后每天会有船员倒下；船员不足以开船时会被渔船救起，货物全损。基础单价：食物 {FOOD_PRICE}、淡水 2 金币。</p>
    </div>
  );
}

function Yard({ game, act }: { game: GameState; act: Act }) {
  const t = shipType(game);
  const missing = Math.ceil(t.hull - game.ship.hull);
  return (
    <>
      <div className="ot-card ot-wide">
        <h4><Wrench size={15} /> 修理</h4>
        <Bar value={game.ship.hull} max={t.hull} label={`船体 ${Math.round(game.ship.hull)} / ${t.hull}`} />
        <div className="ot-btns">
          <span className="k-muted">每点 {repairPrice(game)} 金币</span>
          <button className="k-btn" disabled={missing < 1} onClick={() => act(repairShip(game, 10))}>修 10 点</button>
          <button className="k-btn primary" disabled={missing < 1} onClick={() => act(repairShip(game, 9999))}>全部修好{missing > 0 ? `（${missing * repairPrice(game)} 金币）` : ''}</button>
        </div>
      </div>
      <div className="ot-ships">
        {SHIPS.map((s) => {
          const why = canBuildHere(game, s.id);
          const own = game.ship.type === s.id;
          const diff = s.price - tradeInValue(game);
          return (
            <div key={s.id} className={`ot-card${own ? ' own' : ''}`}>
              <h4>{s.name} <span className="ot-tag">{s.tier} 级</span>{own && <span className="ot-tag ok">现用</span>}</h4>
              <p className="k-muted">{s.blurb}</p>
              <dl className="ot-dl">
                <dt>载货</dt><dd>{s.cargo} 格</dd><dt>速度</dt><dd>{s.speed} 格/天</dd><dt>逆风</dt><dd>{Math.round(s.upwind * 100)}%</dd>
                <dt>船员</dt><dd>{s.crewMin}～{s.crewMax}</dd><dt>船体</dt><dd>{s.hull}</dd><dt>补给</dt><dd>{s.supply} 份</dd>
              </dl>
              <div className="ot-btns">
                <button className="k-btn primary" disabled={own || !!why} onClick={() => act(buyShip(game, s.id))}>{own ? '正在使用' : `换乘（补 ${Math.max(0, diff)} 金币）`}</button>
              </div>
              {!own && why && <p className="ot-why">{why}</p>}
            </div>
          );
        })}
      </div>
      <p className="k-muted">换船时旧船按 {SHIP_BY_ID[game.ship.type].name}现值折价 {tradeInValue(game)} 金币（原价六成，随船体磨损下降）。</p>
    </>
  );
}

function Tavern({ game, act }: { game: GameState; act: Act }) {
  const [lines, setLines] = useState<string[]>([]);
  const t = shipType(game);
  return (
    <div className="ot-cards">
      <div className="ot-card">
        <h4><Users size={15} /> 招募船员</h4>
        <Bar value={game.ship.crew} max={t.crewMax} label={`${game.ship.crew} / ${t.crewMax} 人（至少 ${t.crewMin} 人才能开船）`} />
        <p className="k-muted">每人 {recruitPrice(game)} 金币（声望越高越便宜）。船员越满航速越快，但每天要吃 1/5 份食物与淡水，也要发工资（每人每天 0.5 金币）。</p>
        <div className="ot-btns">
          <button className="k-btn" onClick={() => act(recruit(game, 1))}>招 1 人</button>
          <button className="k-btn" onClick={() => act(recruit(game, 5))}>招 5 人</button>
          <button className="k-btn primary" onClick={() => act(recruit(game, 999))}>招满</button>
          <button className="k-btn" onClick={() => act(dismiss(game, 1))}>遣散 1 人</button>
        </div>
      </div>
      <div className="ot-card">
        <h4><Beer size={15} /> 打听消息</h4>
        <p className="k-muted">请全场喝一轮（{ROUND_PRICE} 金币），听听哪里缺货、哪里压仓。</p>
        <div className="ot-btns">
          <button className="k-btn primary" onClick={() => { const r = listenRumors(game); act(r); if (r.ok) setLines(r.lines); }}><Package size={15} />请一轮酒</button>
        </div>
        <ul className="ot-rumors">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </div>
  );
}

