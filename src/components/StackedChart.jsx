import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { state, notify } from '../simulation/engine.js';
import { BAND_COLORS, PERIODS, periodFor } from '../utils/colors.js';
import { binSamples, windowSpan } from '../utils/window.js';
import { drawModifierRuns, eventMarkers, drawEventMarkers } from '../utils/chartDraw.js';
import { modifierColor, modifierLabel, modifierPattern } from '../data/modifiers.js';

const BANDS = ['served', 'redirected', 'inLine', 'left', 'stayedHome'];
const LABELS = ['Served', 'Redirected', 'In Line', 'Left', 'Stayed home'];
const LEGEND_H = 20; // one row of legend; it grows when the entries need a second row
const STRIP_H = 5;

export default function StackedChart({ width, height }) {
  const canvasRef = useRef(null);
  const legendRef = useRef(null);
  const frameRef = useRef(0);
  const [legendH, setLegendH] = useState(LEGEND_H);

  // The legend wraps onto a second row when several modifiers are showing; the chart gives up that height.
  useLayoutEffect(() => {
    const h = Math.max(LEGEND_H, legendRef.current?.offsetHeight || 0);
    if (h !== legendH) setLegendH(h);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const ch = Math.max(20, height - legendH);
    canvas.width = width * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    function draw() {
      drawChart(ctx, width, ch);
      frameRef.current = requestAnimationFrame(draw);
    }
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [width, height, legendH]);

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
        style={{ width: '100%', flex: 1, minHeight: 0, display: 'block' }}
      />
      <div className="chart-legend" ref={legendRef} style={{ minHeight: LEGEND_H }}>
        <span className="legend-group">
        {BANDS.map((band, i) => {
          const hidden = !!state.hiddenChartBands[band];
          return (
            <button key={band} className="legend-item" onClick={() => toggleBand(band)} style={{ opacity: hidden ? 0.35 : 1 }}>
              <span className="legend-swatch" style={{ background: hidden ? '#64748b' : BAND_COLORS[band] }} />
              {LABELS[i]}
            </button>
          );
        })}
        </span>
        {visibleMods.map(id => (
          <span key={id} className="legend-item static" title="This pattern behind the bars shows when the modifier was on">
            <span className={'legend-swatch pattern pat-' + modifierPattern(id)} style={{ '--c': modifierColor(id) }} />
            {modifierLabel(id)}
          </span>
        ))}
        <span className="legend-group">
        {PERIODS.map(p => (
          <span key={p.id} className="legend-item static">
            <span className="legend-swatch bar" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
        </span>
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

  // Faint modifier backgrounds behind the bars
  drawModifierRuns(ctx, bins, xOf, 0, plotBottom);

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
      ctx.globalAlpha = 1; // solid, so the bars read at once over any background
      ctx.fillRect(x0, yBottom - barH, bw, barH);
      yBottom -= barH;
    }

    // Time-of-day strip along the bottom edge
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = periodFor(bin.hour ?? 12).color;
    ctx.fillRect(x0, h - STRIP_H, x1 - x0, STRIP_H);
  }
  ctx.globalAlpha = 1;

  drawEventMarkers(ctx, eventMarkers(state.events), xOf, now - span, now, 0, plotBottom, { large: true });
  ctx.globalAlpha = 1;
}
