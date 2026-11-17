import { state, getWindowStats, setWindowIdx } from '../simulation/engine.js';
import { WINDOW_OPTIONS } from '../utils/window.js';
import Metric from './Metric.jsx';

// Top bar, right of the charts: the Window slider and the headline numbers for that window.
export default function MetricsBar() {
  const w = getWindowStats();
  const total = w.served + w.left + w.stayedHome; // everyone who needed food
  const satPct = total > 0 ? Math.round(w.served / total * 100) : 0;
  const avgDist = w.served > 0 ? (w.distSum / w.served).toFixed(2) : '0';
  const queued = state.pantries.reduce((sum, pt) => sum + pt.queue.length, 0);
  const active = state.agents.filter(a => a.state === 'traveling' || a.state === 'queued').length;
  const satColor = satPct > 70 ? 'var(--accent)' : satPct > 40 ? 'var(--warn)' : 'var(--danger)';

  return (
    <div className="metrics-area">
      <div className="control-row window-row" title="Time span for every chart and for these numbers (active hours; nights are skipped)">
        <label>Window</label>
        <input type="range" min={0} max={WINDOW_OPTIONS.length - 1} step={1} value={state.view.windowIdx}
          onChange={e => setWindowIdx(+e.target.value)} />
        <span className="value">{WINDOW_OPTIONS[state.view.windowIdx].label}</span>
      </div>
      <div className="gauge" title="People who got food, out of everyone who needed it, including those who stayed home">
        <div className="gauge-label"><span>Need met</span><span>{satPct}%</span></div>
        <div className="gauge-bar">
          <div className="gauge-fill" style={{ width: satPct + '%', background: satColor }} />
        </div>
      </div>
      <div className="metric-grid four">
        <Metric value={total} label="Needed food" color="#e2e8f0" title="Everyone who needed food in this window" />
        <Metric value={w.served} label="Served" color="var(--accent)" />
        <Metric value={w.left} label="Left" color="var(--danger)" title="Set out and came back without food" />
        <Metric value={w.stayedHome} label="Stayed home" color="#c2566b" title="Needed food but never set out" />
        <Metric value={w.redirected} label="Redirected" color="var(--nudge)" />
        <Metric value={avgDist} label="Avg km" color="var(--info)" />
        <Metric value={queued} label="In line" color="var(--muted)" title="In line right now" />
        <Metric value={active} label="Active" color="#94a3b8" title="Walking or in line right now" />
      </div>
    </div>
  );
}
