import { useState } from 'react';
import {
  state, notify, triggerShock, initSim, saveCurrentRun, initModifiers, togglePantryClosed,
  toggleModifier, getWindowStats, setWindowIdx, setClock, setSeed, getHouseholdStats,
} from '../simulation/engine.js';
import { randomSeed } from '../utils/rng.js';
import { UNMET_REASONS } from '../data/reasons.js';
import { MODIFIER_GROUPS } from '../data/modifiers.js';
import { WINDOW_OPTIONS } from '../utils/window.js';
import { generateCSV, downloadCSV } from '../utils/csv.js';
import { loadPref, savePref } from '../utils/prefs.js';
import { CONFIG, simSecondsToMinutes } from '../config.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${ampm}`;
}

function fmtMinutes(total) {
  const h = Math.floor(total / 60), m = total % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function clockLabel(c) {
  const h = Math.floor(c.hour);
  const m = Math.floor(c.minute);
  const dayName = DAYS[(c.weekday - 1) % 7];
  const isWeekend = c.weekday >= 6;
  return `${dayName} Day ${c.day} · ${fmtMinutes(h * 60 + m)}${isWeekend ? ' · Weekend' : ''}`;
}

export default function Panel({ onShowSummary, onOpenConfig }) {
  const [collapsed, setCollapsed] = useState(() => loadPref('collapsed', {}));
  const p = state.params;
  const w = getWindowStats();
  const total = w.served + w.left + w.stayedHome; // everyone who needed food
  const satPct = total > 0 ? Math.round(w.served / total * 100) : 0;
  const avgDist = w.served > 0 ? (w.distSum / w.served).toFixed(2) : '0';
  const queued = state.pantries.reduce((sum, pt) => sum + pt.queue.length, 0);
  const active = state.agents.filter(a => a.state === 'traveling' || a.state === 'queued').length;
  const windowLabel = WINDOW_OPTIONS[state.view.windowIdx].label;

  const inspectedPantry = state.inspecting ? state.pantries.find(pt => pt.id === state.inspecting) : null;

  function toggleSection(id) {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    savePref('collapsed', next);
  }

  function setAllSections(isCollapsed) {
    const ids = ['metrics', 'unmet', 'households', 'simulation', 'clock', 'modifiers', 'environment', 'agents', 'shock', 'data', 'inspector'];
    const next = Object.fromEntries(ids.map(id => [id, isCollapsed]));
    setCollapsed(next);
    savePref('collapsed', next);
  }

  const sectionProps = id => ({ collapsed: !!collapsed[id], onToggle: () => toggleSection(id), onOpenConfig });

  function handleParam(key, value) {
    state.params[key] = value;
    notify();
  }

  function handlePlay() {
    state.running = !state.running;
    notify();
  }

  function handleReset() {
    initSim(state.params);
    initModifiers();
  }

  function handleExportCSV() {
    const allEvents = state.runs.flatMap(r => r.events);
    downloadCSV(generateCSV(state.runs, allEvents));
  }

  const satColor = satPct > 70 ? 'var(--accent)' : satPct > 40 ? 'var(--warn)' : 'var(--danger)';
  const clockMinutes = Math.floor(state.clock.hour) * 60 + Math.floor(state.clock.minute / 15) * 15;

  return (
    <div className="panel">
      {/* Metrics + global window */}
      <div className="metrics-bar">
        <div className="control-row window-row" title="Time span for every chart and the metrics below (active hours; nights are skipped)">
          <label>Window</label>
          <input type="range" min={0} max={WINDOW_OPTIONS.length - 1} step={1} value={state.view.windowIdx}
            onChange={e => setWindowIdx(+e.target.value)} />
          <span className="value">{windowLabel}</span>
        </div>
        <button className="section-toggle metrics-toggle" onClick={() => toggleSection('metrics')} aria-expanded={!collapsed.metrics}>
          <span className={'chevron' + (collapsed.metrics ? '' : ' open')}>▸</span>
          <span className="section-title">Metrics</span>
          <span className="toggle-hint">{collapsed.metrics ? `${satPct}% of need met · ${w.served} served` : ''}</span>
        </button>
        {!collapsed.metrics && (
          <>
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
          </>
        )}
      </div>

      {/* Header */}
      <div className="panel-header">
        <h1>NYC Pantry ABM</h1>
        <p>Agent-based model of food pantry access</p>
        <p className="poc-note">Proof of concept. Nothing here is real data; results are illustrative.</p>
        <p><a className="about-link" href="https://github.com/jonathan-chin/pantry-abm#readme" target="_blank" rel="noreferrer">About this tool</a></p>
        <div className="header-row">
          <span className="header-clock">{clockLabel(state.clock)}</span>
          <span className="collapse-all">
            <button onClick={() => setAllSections(true)}>Collapse all</button>
            <button onClick={() => setAllSections(false)}>Expand all</button>
          </span>
        </div>
      </div>

      <Section title="Unmet need" {...sectionProps('unmet')}>
        <UnmetReasons reasons={w.reasons} windowLabel={windowLabel} />
      </Section>

      <Section title="Households" config="agents" {...sectionProps('households')}>
        <HouseholdStats />
      </Section>

      <Section title="Simulation" config="simulation" {...sectionProps('simulation')}>
        <div className="btn-row">
          <button className={state.running ? 'btn' : 'btn primary'} onClick={handlePlay}>
            {state.running ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className="btn" onClick={handleReset}>Reset</button>
          <button className="btn" onClick={() => { saveCurrentRun(); notify(); }}>Save run</button>
        </div>
        <Slider label="Speed" value={state.speed} min={CONFIG.minSpeed} max={CONFIG.maxSpeed} step={0.1}
          display={v => v.toFixed(1) + 'x'}
          onChange={v => { state.speed = v; notify(); }} />
        <div className="control-row seed-row"
          title="The seed fixes every random choice. Same seed and same settings give the same run. A new seed takes effect on Reset.">
          <label htmlFor="seed-input">Seed</label>
          <input id="seed-input" type="number" className="seed-input" min={0} step={1} value={state.seed}
            onChange={e => setSeed(e.target.value)} />
          <button className="btn seed-new" onClick={() => setSeed(randomSeed())}>New</button>
        </div>
        {state.seed !== state.runSeed && (
          <div className="hint">This run used seed {state.runSeed}. Press Reset to use {state.seed}.</div>
        )}
      </Section>

      <Section title="Day & time" config="simulation" {...sectionProps('clock')}>
        <div className="day-picker">
          {DAYS.map((d, i) => (
            <button key={d}
              className={'day-btn' + (state.clock.weekday === i + 1 ? ' active' : '') + (i >= 5 ? ' weekend' : '')}
              onClick={() => setClock(i + 1, clockMinutes)}>
              {d}
            </button>
          ))}
        </div>
        <Slider label="Time" value={clockMinutes}
          min={CONFIG.nightResumeHour * 60} max={CONFIG.nightSkipHour * 60 - 15} step={15}
          display={fmtMinutes}
          onChange={v => setClock(state.clock.weekday, v)} />
        <div className="hint">Nights ({fmtHour(CONFIG.nightSkipHour)}–{fmtHour(CONFIG.nightResumeHour)}) are skipped.</div>
      </Section>

      <Section title="Modifiers" config="modifiers" {...sectionProps('modifiers')}>
        {MODIFIER_GROUPS.map(g => (
          <div key={g.title} className="modifier-group">
            <div className="modifier-group-title">{g.title}</div>
            <div className="modifier-chips">
              {state.modifiers.filter(m => g.types.includes(m.type)).map(m => (
                <button
                  key={m.id}
                  className={'chip' + (m.active ? ' active' : '')}
                  onClick={() => toggleModifier(m.id)}
                  title={m.description}
                  style={m.active ? { background: m.color, borderColor: m.color, color: '#0f172a' } : undefined}
                >
                  <span className="chip-dot" style={{ background: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Environment" config="pantries" {...sectionProps('environment')}>
        <Slider label="Pantries" value={p.pantryCount} min={4} max={20} step={1}
          display={v => v} onChange={v => handleParam('pantryCount', v)} />
        <Slider label="Capacity" value={p.capacity} min={5} max={50} step={1}
          display={v => v} onChange={v => handleParam('capacity', v)} />
        <Slider label="Service speed" value={p.serviceRatePerHour} min={5} max={150} step={5}
          title="How fast each open pantry works through its line: people served per hour"
          display={v => v + '/hr'} onChange={v => handleParam('serviceRatePerHour', v)} />
        <div className="btn-row">
          <button className="btn danger" onClick={triggerShock}>SNAP shock</button>
        </div>
      </Section>

      <Section title="Agents" config="agents" {...sectionProps('agents')}>
        <Slider label="Households" value={p.householdCount} min={1000} max={15000} step={500}
          title="Households in the pool at the start. Each needs food about once a week. Applied on Reset."
          display={v => v.toLocaleString()} onChange={v => handleParam('householdCount', v)} />
        <Slider label="Variance" value={p.variance} min={0} max={100} step={5}
          display={v => v + '%'} onChange={v => handleParam('variance', v)} />
      </Section>

      <Section title="Shock" config="pantries" {...sectionProps('shock')}>
        <Slider label="Variance" value={p.shockVariance} min={0} max={100} step={5}
          display={v => v + '%'} onChange={v => handleParam('shockVariance', v)} />
        {state.shock.active && (
          <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>
            Active — {(simSecondsToMinutes(state.shock.remaining) / ((CONFIG.nightSkipHour - CONFIG.nightResumeHour) * 60)).toFixed(1)} days remaining
          </div>
        )}
      </Section>

      <Section title="Data" {...sectionProps('data')}>
        <div className="btn-row">
          <button className="btn" onClick={onShowSummary}>Summary</button>
          <button className="btn" onClick={handleExportCSV} disabled={state.runs.length === 0}>
            Export CSV
          </button>
        </div>
        {state.runs.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {state.runs.length} run{state.runs.length > 1 ? 's' : ''} saved
          </div>
        )}
      </Section>

      {inspectedPantry && (
        <Section title={`Pantry #${inspectedPantry.id}: ${inspectedPantry.name}`} {...sectionProps('inspector')}>
          <div className="metric-grid" style={{ fontSize: 12 }}>
            <Metric value={inspectedPantry.stats.served} label="Served" color="var(--accent)" />
            <Metric value={inspectedPantry.stats.leftNoFood + inspectedPantry.stats.leftTooLong} label="Left" color="var(--danger)" />
            <Metric value={Math.floor(inspectedPantry.stock)} label="Stock" color="var(--info)" />
            <Metric value={inspectedPantry.queue.length} label="Queue" color="var(--muted)" />
            <Metric
              value={inspectedPantry.stats.waitN > 0
                ? simSecondsToMinutes(inspectedPantry.stats.waitSum / inspectedPantry.stats.waitN).toFixed(1) + ' min'
                : '0 min'}
              label="Avg wait" color="var(--warn)" />
            <Metric value={inspectedPantry.stats.stockOuts} label="Stock-outs" color="var(--danger)" />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            Hours: {fmtHour(inspectedPantry.openHour)}–{fmtHour(inspectedPantry.closeHour)}
            {inspectedPantry.closed && !inspectedPantry.manuallyClosed && (
              <span style={{ color: 'var(--warn)', marginLeft: 6 }}>Closed for the night</span>
            )}
            {inspectedPantry.manuallyClosed && (
              <span style={{ color: 'var(--danger)', marginLeft: 6 }}>Manually closed</span>
            )}
          </div>
          <button className="btn small" style={{ marginTop: 6, width: '100%' }}
            onClick={() => togglePantryClosed(inspectedPantry.id)}>
            {inspectedPantry.manuallyClosed ? 'Reopen Pantry' : 'Close Pantry'}
          </button>
        </Section>
      )}

      {(state.addingPantry || state.removingPantry || state.closingPantry) && (
        <div className="mode-indicator">
          {state.addingPantry ? 'Click map to place pantry' : state.removingPantry ? 'Click a pantry to remove it' : 'Click a pantry to close/reopen it'}
        </div>
      )}
    </div>
  );
}

function Section({ title, collapsed, onToggle, config, onOpenConfig, children }) {
  return (
    <div className={'section' + (collapsed ? ' collapsed' : '')}>
      <div className="section-head">
        <button className="section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <span className={'chevron' + (collapsed ? '' : ' open')}>▸</span>
          <span className="section-title">{title}</span>
        </button>
        {config && (
          <button className="cfg-btn" onClick={() => onOpenConfig(config)} title={`Open ${config}.yaml`}>
            yaml
          </button>
        )}
      </div>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  );
}

// The household pool right now, and how it has changed since the start of the run.
function HouseholdStats() {
  const h = getHouseholdStats();
  return (
    <>
      <div className="metric-grid four">
        <Metric value={h.households.toLocaleString()} label="Households" color="#e2e8f0" title="Households in the pool now" />
        <Metric value={h.inNeed.toLocaleString()} label="In need" color="var(--info)" title="Households whose current need has not been met yet" />
        <Metric value={h.waiting1.toLocaleString()} label="Waiting 1+ d" color="var(--warn)" title="Went without food yesterday and are still waiting" />
        <Metric value={h.waiting3.toLocaleString()} label="Waiting 3+ d" color="var(--danger)" title="Have gone 3 or more days in a row without food" />
        <Metric value={h.longestWait} label="Longest (d)" color="#e2e8f0" title="Longest current run of days without food" />
        <Metric value={h.gaveUp.toLocaleString()} label="Gave up" color="var(--danger)" title={`Left the system after ${CONFIG.givesUpAfterDays} days in a row without food`} />
        <Metric value={h.retired.toLocaleString()} label="Retired" color="var(--muted)" title="Stopped needing pantry food" />
        <Metric value={h.joined.toLocaleString()} label="Joined" color="var(--accent)" title="New households since the start" />
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Unmet need carries over: a household that goes without tries again the next day.
      </div>
    </>
  );
}

// Why need went unmet in the current window, largest cause first.
function UnmetReasons({ reasons, windowLabel }) {
  const rows = UNMET_REASONS.map(r => ({ ...r, n: reasons?.[r.id] || 0 })).filter(r => r.n > 0).sort((a, b) => b.n - a.n);
  if (!rows.length) return <div className="hint">Nobody has gone without food yet ({windowLabel}).</div>;
  const max = rows[0].n;
  return (
    <div className="reasons">
      {rows.map(r => (
        <div key={r.id} className="reason-row" title={r.kind === 'left' ? 'Set out and came back without food' : 'Never set out'}>
          <span className="reason-label">{r.label}</span>
          <span className="reason-bar"><span className={r.kind} style={{ width: `${Math.max(3, (r.n / max) * 100)}%` }} /></span>
          <span className="reason-n">{r.n}</span>
        </div>
      ))}
      <div className="reason-key">
        <span><i className="left" />Left without food</span>
        <span><i className="stayedHome" />Stayed home</span>
      </div>
    </div>
  );
}

function Metric({ value, label, color, title }) {
  return (
    <div className="metric" title={title}>
      <div className="num" style={{ color }}>{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, onChange, title }) {
  return (
    <div className="control-row" title={title}>
      <label>{label}</label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
      />
      <span className="value">{display(value)}</span>
    </div>
  );
}
