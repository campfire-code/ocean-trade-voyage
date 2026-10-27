// 海图视图：画布 + 点击 / 方向键航行。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Anchor } from 'lucide-react';
import { idx, inMap, isWater, type SeaMap } from './mapgen';
import { TILE, drawScene } from './render';
import type { GameState } from './state';
import { PORT_BY_ID } from './world';

export function SeaView({ map, terrain, game, route, facing, onTarget, onDock, canDock }: {
  map: SeaMap; terrain: HTMLCanvasElement; game: GameState; route: [number, number][]; facing: 1 | -1;
  onTarget: (x: number, y: number) => void; onDock: () => void; canDock: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (ref.current) drawScene(ref.current, terrain, map, game, { route, hover, facing });
  }, [terrain, map, game, route, hover, facing]);

  const tileAt = (e: React.MouseEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * map.w), Math.floor(((e.clientY - r.top) / r.height) * map.h)];
  };
  const hoverInfo = useMemo(() => {
    if (!hover || !inMap(hover[0], hover[1])) return '';
    const site = map.sites.find((s) => Math.abs(s.land[0] - hover[0]) <= 1 && Math.abs(s.land[1] - hover[1]) <= 1);
    if (site) return `${PORT_BY_ID[site.id].name}：点击驶向码头`;
    return isWater(map.tiles[idx(hover[0], hover[1])]) ? '点击驶向这里' : '陆地';
  }, [hover, map]);

  return (
    <div className="ot-sea">
      <canvas
        ref={ref} className="ot-canvas" width={map.w * TILE} height={map.h * TILE}
        aria-label="海图：点击水面航行，方向键手动操舵"
        onMouseMove={(e) => setHover(tileAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { const [x, y] = tileAt(e); onTarget(x, y); }}
      />
      <div className="ot-sea-bar">
        <span className="k-muted">{hoverInfo || '点击海图水面自动航行 · 方向键 / Q E Z C 手动操舵 · 空格停船'}</span>
        <span className="b-sp" />
        {canDock && <button className="k-btn primary" onClick={onDock}><Anchor size={15} />靠港</button>}
      </div>
    </div>
  );
}
