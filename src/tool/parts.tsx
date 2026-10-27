// 小部件：进度条。
export function Bar({ value, max, label, tone }: { value: number; max: number; label?: string; tone?: 'warn' | 'err' }) {
  const r = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const auto = r < 0.2 ? 'err' : r < 0.4 ? 'warn' : '';
  return (
    <div className="ot-bar-wrap">
      <div className="ot-bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
        <div className={`ot-bar-fill ${tone ?? auto}`} style={{ width: `${r * 100}%` }} />
      </div>
      {label && <span className="ot-bar-label k-num">{label}</span>}
    </div>
  );
}
