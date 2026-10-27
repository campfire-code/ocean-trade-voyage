// 港口界面：交易所、补给站、船坞、酒馆。
import { useState } from 'react';
import { Anchor, Beer, Hammer, Package, Store, Wrench, Users, Wheat, Shield, Crosshair } from 'lucide-react';
import { priceTier } from './pricing';
import { dailySupply } from './sailing';
import { REL_MIN, cargoUsed, dayNumber, fleetCargoCap, fleetShips, fleetSupplyCap, people, typeOf, type GameState } from './state';
import { COND_NAME } from './events';
import { ARMOR_MAX, GUARD_PER_SHIP, GUARD_PRICE, GUN_PRICE, MAX_FLEET, guardCap } from './fleet';
import {
  FOOD_PRICE, ROUND_PRICE, buyArmor, buyConsort, buyGood, buyGun, buyPriceOf, buyShip, buySupply, canBuildHere, currentMid, dismiss, dismissGuards,
  hireGuards, listenRumors, nextArmorPrice, recruit, recruitPrice, repairNeed, repairPriceOf, repairShip, sellConsort, sellGood, sellGun, sellPriceOf,
  supplyPrice, tradeInValue, type TradeResult,
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
            {game.conds.filter((c) => c.port === port.id && c.until >= dayNumber(game)).map((c) => <span key={c.id} className={`ot-tag cond-${c.kind}`} title={c.text}>{COND_NAME[c.kind]}（还剩 {Math.max(0, Math.ceil(c.until - dayNumber(game)))} 天）</span>)}
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
      <div className="ot-cap k-muted">货舱 <b className="k-num">{cargoUsed(game)}/{fleetCargoCap(game)}</b> 格 · 资金 <b className="k-num">{Math.round(game.gold)}</b> 金币 · 价格随库存与事件波动，买卖都有 5% 差价</div>
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
  const cap = fleetSupplyCap(game);
  const need = dailySupply(people(game));
  const rows: ['food' | 'water', string][] = [['food', '食物'], ['water', '淡水']];
  return (
    <div className="ot-cards">
      {rows.map(([k, name]) => (
        <div key={k} className="ot-card">
          <h4>{name}</h4>
          <Bar value={game.ship[k]} max={cap} label={`${game.ship[k]} / ${cap} 份 · 够航行 ${Math.floor(game.ship[k] / need)} 天`} />
          <p className="k-muted">单价 {supplyPrice(port, k)} 金币/份（本港系数 {PORT_BY_ID[port].supply}）。当前船上共 {people(game)} 人（船员加护卫），整支船队合用，每天各耗 {need} 份。</p>
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
  const need = repairNeed(game);
  const ships = fleetShips(game);
  return (
    <>
      <div className="ot-card ot-wide">
        <h4><Wrench size={15} /> 修理</h4>
        {ships.map((sh, i) => <Bar key={i} value={sh.hull} max={typeOf(sh).hull} label={`${sh.name} 船体 ${Math.round(sh.hull)} / ${typeOf(sh).hull}（每点 ${repairPriceOf(sh)} 金币）`} />)}
        <div className="ot-btns">
          <button className="k-btn" disabled={need.points < 1} onClick={() => act(repairShip(game, 10))}>修 10 点</button>
          <button className="k-btn primary" disabled={need.points < 1} onClick={() => act(repairShip(game, 9999))}>全部修好{need.points > 0 ? `（${need.cost} 金币）` : ''}</button>
        </div>
      </div>
      <div className="ot-card ot-wide">
        <h4><Crosshair size={15} /> 船队与装备 <span className="ot-tag">{ships.length}/{MAX_FLEET} 艘</span></h4>
        <p className="k-muted">火炮每门 {GUN_PRICE} 金币，炮手要够（每 2 名船员操作 1 门）；加固铁皮每级少挨 15% 炮击，最高 {ARMOR_MAX} 级。海战时全部船只一起参战，载货与补给合并计算，航速取最慢的一艘。</p>
        <div className="ot-fleet">
          {ships.map((sh, i) => {
            const t = typeOf(sh);
            return (
              <div key={i} className="ot-fleet-card">
                <div><b>{sh.name}</b><span className="ot-tag">{t.name}{i === 0 ? ' · 旗舰' : ''}</span></div>
                <div className="k-muted ot-line">炮位 {sh.guns}/{t.gunSlots} · 装甲 {sh.armor}/{ARMOR_MAX} · 船员 {sh.crew}（{t.crewMin}～{t.crewMax}）</div>
                <div className="ot-btns">
                  <button className="k-btn ot-sm" onClick={() => act(buyGun(game, i))}>买炮 -{GUN_PRICE}</button>
                  <button className="k-btn ot-sm" disabled={sh.guns < 1} onClick={() => act(sellGun(game, i))}>卖炮 +{Math.round(GUN_PRICE / 2)}</button>
                  <button className="k-btn ot-sm" disabled={sh.armor >= ARMOR_MAX} onClick={() => act(buyArmor(game, i))}>{sh.armor >= ARMOR_MAX ? '装甲已满' : `加固 -${nextArmorPrice(game, i)}`}</button>
                  {i > 0 && <button className="k-btn ot-sm ghost" onClick={() => act(sellConsort(game, i - 1))}>卖掉（+{tradeInValue(game, sh)}）</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ot-ships">
        {SHIPS.map((s) => {
          const why = canBuildHere(game, s.id);
          const own = game.ship.type === s.id;
          const diff = s.price - tradeInValue(game);
          const full = ships.length >= MAX_FLEET;
          return (
            <div key={s.id} className={`ot-card${own ? ' own' : ''}`}>
              <h4>{s.name} <span className="ot-tag">{s.tier} 级</span>{own && <span className="ot-tag ok">旗舰</span>}</h4>
              <p className="k-muted">{s.blurb}</p>
              <dl className="ot-dl">
                <dt>载货</dt><dd>{s.cargo} 格</dd><dt>速度</dt><dd>{s.speed} 格/天</dd><dt>逆风</dt><dd>{Math.round(s.upwind * 100)}%</dd>
                <dt>船员</dt><dd>{s.crewMin}～{s.crewMax}</dd><dt>船体</dt><dd>{s.hull}</dd><dt>补给</dt><dd>{s.supply} 份</dd>
                <dt>炮位</dt><dd>{s.gunSlots} 门</dd><dt>造价</dt><dd>{s.price}</dd>
              </dl>
              <div className="ot-btns">
                <button className="k-btn primary" disabled={own || !!why} onClick={() => act(buyShip(game, s.id))}>{own ? '正在使用' : `换旗舰（补 ${Math.max(0, diff)}）`}</button>
                <button className="k-btn" disabled={!!why || full} onClick={() => act(buyConsort(game, s.id))}>{full ? '船队已满' : '加入船队'}</button>
              </div>
              {!own && why && <p className="ot-why">{why}</p>}
            </div>
          );
        })}
      </div>
      <p className="k-muted">换旗舰时旧船按 {SHIP_BY_ID[game.ship.type].name}现值折价 {tradeInValue(game)} 金币（原价六成，随船体磨损下降）；装备不随船转移，多出的炮半价回收。「加入船队」按原价买下新船，并自动招齐最低船员。</p>
    </>
  );
}

function Tavern({ game, act }: { game: GameState; act: Act }) {
  const [lines, setLines] = useState<string[]>([]);
  const ships = fleetShips(game);
  return (
    <div className="ot-cards">
      <div className="ot-card">
        <h4><Users size={15} /> 招募船员</h4>
        <p className="k-muted">每人 {recruitPrice(game)} 金币（声望越高越便宜）。船员越满航速越快，也能操作更多火炮；每天要吃 1/5 份食物与淡水，工资每人每天 0.5 金币。</p>
        {ships.map((sh, i) => (
          <div key={i} className="ot-crew-row">
            <Bar value={sh.crew} max={typeOf(sh).crewMax} label={`${sh.name} ${sh.crew}/${typeOf(sh).crewMax}（至少 ${typeOf(sh).crewMin}）`} />
            <div className="ot-btns">
              <button className="k-btn ot-sm" onClick={() => act(recruit(game, 1, i))}>招 1</button>
              <button className="k-btn ot-sm" onClick={() => act(recruit(game, 5, i))}>招 5</button>
              <button className="k-btn ot-sm primary" onClick={() => act(recruit(game, 999, i))}>招满</button>
              <button className="k-btn ot-sm" onClick={() => act(dismiss(game, 1, i))}>遣散 1</button>
            </div>
          </div>
        ))}
      </div>
      <div className="ot-card">
        <h4><Shield size={15} /> 雇护卫</h4>
        <Bar value={game.guards} max={guardCap(game)} label={`护卫 ${game.guards}/${guardCap(game)}（每艘船最多 ${GUARD_PER_SHIP} 名）`} />
        <p className="k-muted">护卫不占船员名额，登船肉搏战力是普通船员的 2.5 倍，也能让海盗少打你的主意。每人 {GUARD_PRICE} 金币，每天工资 1 金币，也要吃饭。</p>
        <div className="ot-btns">
          <button className="k-btn" onClick={() => act(hireGuards(game, 1))}>雇 1 人</button>
          <button className="k-btn" onClick={() => act(hireGuards(game, 4))}>雇 4 人</button>
          <button className="k-btn primary" onClick={() => act(hireGuards(game, 999))}>雇满</button>
          <button className="k-btn" onClick={() => act(dismissGuards(game, 1))}>遣散 1 人</button>
        </div>
      </div>
      <div className="ot-card">
        <h4><Beer size={15} /> 打听消息</h4>
        <p className="k-muted">请全场喝一轮（{ROUND_PRICE} 金币），听听哪里缺货、哪里在办庆典或封港，还有哪支海盗在出没。</p>
        <div className="ot-btns">
          <button className="k-btn primary" onClick={() => { const r = listenRumors(game); act(r); if (r.ok) setLines(r.lines); }}><Package size={15} />请一轮酒</button>
        </div>
        <ul className="ot-rumors">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </div>
  );
}
