import { useEffect, useRef } from 'react';
import { state } from '../simulation/engine.js';
import { binSamples, windowSpan, WINDOW_OPTIONS } from '../utils/window.js';
import { eventMarkers, drawEventMarkers } from '../utils/chartDraw.js';
import { simSecondsToMinutes } from '../config.js';

export default function Sparklines({ width, height }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    function draw() {
      drawSparklines(ctx, width, height);
      frameRef.current = requestAnimationFrame(draw);
    }
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

// points: [{ t, v }] in time order; xOf maps sim time to x.
function drawSparkline(ctx, points, xOf, span, now, x, y, w, h, color, label, unit) {
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(100,116,139,0.3)';
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 6, y + 14);

  const plotY = y + 22;
  const plotH = h - 28;

  if (points.length >= 2) {
    const max = Math.max(...points.map(p => p.v), 0.01);
    const current = points[points.length - 1].v;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px Space Grotesk, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(current.toFixed(1) + unit, x + w - 6, y + 14);

    const px = p => x + Math.max(0, xOf(p.t));
    const py = p => plotY + plotH - (p.v / max) * plotH;

    const trace = () => {
      for (let i = 0; i < points.length; i++) {
        const cx = px(points[i]), cy = py(points[i]);
        if (i === 0) { ctx.lineTo(cx, cy); continue; }
        const prevX = px(points[i - 1]), prevY = py(points[i - 1]);
        const mid = (prevX + cx) / 2;
        ctx.bezierCurveTo(mid, prevY, mid, cy, cx, cy);
      }
    };

    ctx.beginPath();
    ctx.moveTo(px(points[0]), plotY + plotH);
    trace();
    ctx.lineTo(px(points[points.length - 1]), plotY + plotH);
    ctx.closePath();
    ctx.fillStyle = color + '33';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px(points[0]), py(points[0]));
    trace();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Event markers, placed on the same time axis as the line so they scroll with it
  drawEventMarkers(ctx, eventMarkers(state.events), xOf, now - span, now, plotY, plotY + plotH, { offsetX: x, large: false });
}

function toPoints(bins, sumKey, nKey) {
  const pts = [];
  let last = null;
  for (const b of bins) {
    const v = b[nKey] > 0 ? simSecondsToMinutes(b[sumKey] / b[nKey]) : last; // minutes
    if (v == null) continue;
    last = v;
    pts.push({ t: (b.t0 + b.t1) / 2, v });
  }
  return pts;
}

function drawSparklines(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const samples = state.chart.samples;
  const now = state.simTime;
  const span = windowSpan(state.view.windowIdx, samples, now);
  const { bins } = binSamples(samples, span, now, Math.floor(w / 4));
  const xOf = t => w - ((now - t) / span) * w;
  const windowLabel = WINDOW_OPTIONS[state.view.windowIdx]?.label || '';
  const halfH = h / 2 - 2;
  drawSparkline(ctx, toPoints(bins, 'waitSum', 'waitN'), xOf, span, now, 0, 0, w, halfH, '#f59e0b', `Avg wait · ${windowLabel}`, ' min');
  drawSparkline(ctx, toPoints(bins, 'travelSum', 'travelN'), xOf, span, now, 0, halfH + 4, w, halfH, '#3b82f6', `Avg travel · ${windowLabel}`, ' min');
}
