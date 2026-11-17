import { useRef, useEffect } from 'react';
import { BAND_COLORS } from '../utils/colors.js';
import { drawModifierPatterns } from '../utils/chartDraw.js';
import { modifierColor, modifierLabel } from '../data/modifiers.js';
import { needTotal } from '../data/reasons.js';
import { simSecondsToMinutes } from '../config.js';

export default function Summary({ runs, onClose }) {
  if (runs.length === 0) {
    return (
      <div className="summary-overlay">
        <div className="summary-content">
          <div className="summary-header">
            <h2>Session Summary</h2>
            <button className="btn" onClick={onClose}>&times; Close</button>
          </div>
          <p style={{ color: 'var(--muted)', padding: 20 }}>
            No runs saved yet. Click "Save run" to capture the current simulation state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="summary-overlay">
      <div className="summary-content">
        <div className="summary-header">
          <h2>Session Summary</h2>
          <button className="btn" onClick={onClose}>&times; Close</button>
        </div>
        <div className="summary-runs">
          {runs.map((run, idx) => (
            <RunCard key={run.id} run={run} index={idx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunCard({ run, index }) {
  const chartRef = useRef(null);
  const sparkRef = useRef(null);
  const s = run.stats;
  const total = needTotal(s);
  const satPct = total > 0 ? Math.round(s.served / total * 100) : 0;

  useEffect(() => {
    drawMiniChart(chartRef.current, run);
    drawMiniSparklines(sparkRef.current, run);
  }, [run]);

  return (
    <div className="run-card">
      <div className="run-card-header">
        <h3>
          Run {index + 1}
          {run.modifiers.length === 0 && <span className="run-mod">Baseline</span>}
          {run.modifiers.map(id => (
            <span key={id} className="run-mod" style={{ borderColor: modifierColor(id), color: modifierColor(id) }}>
              {modifierLabel(id)}
            </span>
          ))}
        </h3>
        <span className="run-sat" style={{ color: satPct > 70 ? 'var(--accent)' : satPct > 40 ? 'var(--warn)' : 'var(--danger)' }}>
          {satPct}% of need met
        </span>
      </div>
      <div className="run-card-stats">
        <span>Served: {s.served}</span>
        <span>Left: {s.leftNoFood + s.leftTooLong}</span>
        <span>Stayed home: {s.stayedHome || 0}</span>
        <span>Redirected: {s.redirected}</span>
        <span>Time: {(simSecondsToMinutes(run.simTime) / 60).toFixed(1)} hr</span>
        {run.seed !== undefined && <span>Seed: {run.seed}</span>}
        {run.households && <span>Waiting 3+ days: {run.households.waiting3}</span>}
        {run.households && <span>Gave up: {run.households.gaveUp}</span>}
      </div>
      <div className="run-card-charts">
        <canvas ref={chartRef} width={400} height={100} style={{ width: '65%', height: 100 }} />
        <canvas ref={sparkRef} width={200} height={100} style={{ width: '35%', height: 100 }} />
      </div>
    </div>
  );
}

function drawMiniChart(canvas, run) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const samples = run.samples;
  if (samples.length < 2) return;

  const bands = ['served', 'redirected', 'inLine', 'left', 'stayedHome'];
  const n = samples.length;
  const xStep = w / (n - 1);

  // Faint background patterns for stretches where modifiers were on
  let start = 0;
  for (let i = 1; i <= n; i++) {
    const key = (samples[start].modifiers || []).join(',');
    if (i < n && (samples[i].modifiers || []).join(',') === key) continue;
    if (key) drawModifierPatterns(ctx, start * xStep, (i - 1) * xStep, 0, h, samples[start].modifiers, 1.2);
    start = i;
  }

  const stackedValues = samples.map(d => {
    const total = (d.served + d.redirected + d.inLine + d.left + (d.stayedHome || 0)) || 1;
    let cum = 0;
    return bands.map(key => {
      const val = (d[key] || 0) / total;
      const row = { y0: cum, y1: cum + val };
      cum += val;
      return row;
    });
  });

  for (let b = bands.length - 1; b >= 0; b--) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) ctx.lineTo(i * xStep, h - stackedValues[i][b].y1 * h);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(i * xStep, h - stackedValues[i][b].y0 * h);
    ctx.closePath();
    ctx.fillStyle = BAND_COLORS[bands[b]];
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function averages(samples, sumKey, nKey) {
  const out = [];
  let last = 0;
  for (const s of samples) {
    if (s[nKey] > 0) last = simSecondsToMinutes(s[sumKey] / s[nKey]);
    out.push(last);
  }
  return out;
}

function drawMiniSparklines(canvas, run) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const halfH = h / 2 - 2;
  drawMiniSparkline(ctx, averages(run.samples, 'waitSum', 'waitN'), 0, 0, w, halfH, '#f59e0b', 'Wait');
  drawMiniSparkline(ctx, averages(run.samples, 'travelSum', 'travelN'), 0, halfH + 4, w, halfH, '#3b82f6', 'Travel');
}

function drawMiniSparkline(ctx, data, x, y, w, h, color, label) {
  ctx.fillStyle = 'rgba(15,23,42,0.4)';
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + 10);

  if (data.length < 2) return;
  const max = Math.max(...data, 0.01);
  const step = w / (data.length - 1);

  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const px = x + i * step;
    const py = y + h - (data[i] / max) * (h - 14);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}
