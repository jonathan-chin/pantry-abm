import { useEffect, useRef } from 'react';
import { state, notify } from '../simulation/engine.js';
import { BAND_COLORS, PERIODS, periodFor } from '../utils/colors.js';
import { CONFIG } from '../config.js';
import { binSamples, windowSpan } from '../utils/window.js';
import { EVENT_ICONS, drawStripeRuns } from '../utils/chartDraw.js';
import { modifierColor, modifierLabel } from '../data/modifiers.js';

const BANDS = ['served', 'redirected', 'inLine', 'left', 'stayedHome'];
const LABELS = ['Served', 'Redirected', 'In Line', 'Left', 'Stayed home'];
const LEGEND_H = 20;
const STRIP_H = 5;

export default function StackedChart({ width, height }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const ch = height - LEGEND_H;
    canvas.width = width * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    function draw() {
      drawChart(ctx, width, ch);
      frameRef.current = requestAnimationFrame(draw);
    }
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [width, height]);

  function toggleBand(band) {
    if (state.hiddenChartBands[band]) {
      delete state.hiddenChartBands[band];
    } else {
      state.hiddenChartBands[band] = true;
    }
    notify();
  }

  // Modifiers that appear anywhere in the visible window, plus any active now
  const samples = state.chart.samples;
  const span = windowSpan(state.view.windowIdx, samples, state.simTime);
  const seen = new Set(state.modifiers.filter(m => m.active).map(m => m.id));
  for (let i = samples.length - 1; i >= 0 && samples[i].time >= state.simTime - span; i--) {
    for (const id of samples[i].modifiers || []) seen.add(id);
  }
  const visibleMods = state.modifiers.filter(m => seen.has(m.id)).map(m => m.id);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', flex: 1, display: 'block' }}
      />
      <div className="chart-legend" style={{ height: LEGEND_H }}>
        {BANDS.map((band, i) => {
          const hidden = !!state.hiddenChartBands[band];
          return (
            <button key={band} className="legend-item" onClick={() => toggleBand(band)} style={{ opacity: hidden ? 0.35 : 1 }}>
              <span className="legend-swatch" style={{ background: hidden ? '#64748b' : BAND_COLORS[band] }} />
              {LABELS[i]}
            </button>
          );
        })}
        {visibleMods.length > 0 && <span className="legend-sep" />}
        {visibleMods.map(id => (
          <span key={id} className="legend-item static" title="Stripes behind the bars show when this modifier was on">
            <span className="legend-swatch striped" style={{ '--stripe': modifierColor(id) }} />
            {modifierLabel(id)}
          </span>
        ))}
        <span className="legend-sep" />
        {PERIODS.map(p => (
          <span key={p.id} className="legend-item static">
            <span className="legend-swatch bar" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function drawChart(ctx, w, h) {
  const samples = state.chart.samples;
  ctx.clearRect(0, 0, w, h);

  if (samples.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Collecting data…', w / 2, h / 2);
    return;
  }

  const now = state.simTime;
  const span = windowSpan(state.view.windowIdx, samples, now);
  const { bins } = binSamples(samples, span, now, Math.floor(w / 3));
  const xOf = t => w - ((now - t) / span) * w;
  const plotBottom = h - STRIP_H - 1;

  const hidden = state.hiddenChartBands;
  const visibleBands = BANDS.filter(b => !hidden[b]);

  // Modifier stripes behind the bars
  const phase = ((xOf(0) % 7) + 7) % 7;
  drawStripeRuns(ctx, bins, xOf, 0, plotBottom, phase);

  const totals = bins.map(d => visibleBands.reduce((sum, b) => sum + (d[b] || 0), 0));
  const maxTotal = Math.max(...totals, 1);

  for (const bin of bins) {
    const x0 = Math.max(0, xOf(bin.t0));
    const x1 = xOf(bin.t1);
    if (x1 <= 0) continue;
    const gap = x1 - x0 > 3 ? 1 : 0;
    const bw = Math.max(1, x1 - x0 - gap);
    let yBottom = plotBottom;

    for (const band of BANDS) {
      if (hidden[band]) continue;
      const barH = ((bin[band] || 0) / maxTotal) * (plotBottom - 4);
      if (barH < 0.5) continue;
      ctx.fillStyle = BAND_COLORS[band];
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x0, yBottom - barH, bw, barH);
      yBottom -= barH;
    }

    // Time-of-day strip along the bottom edge
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = periodFor(bin.hour ?? 12).color;
    ctx.fillRect(x0, h - STRIP_H, x1 - x0, STRIP_H);
  }
  ctx.globalAlpha = 1;

  for (const evt of state.events) {
    if (evt.time < now - span || evt.time > now) continue;
    const icon = EVENT_ICONS[evt.type];
    if (!icon) continue;
    const evtX = xOf(evt.time);
    ctx.strokeStyle = icon.color;
    ctx.lineWidth = CONFIG.eventMarkerWidth;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(evtX, 0);
    ctx.lineTo(evtX, plotBottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = icon.color;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(icon.symbol, evtX, 18);
  }
  ctx.globalAlpha = 1;
}
