import { CONFIG } from '../config.js';
import { modifierColor, modifierPattern } from '../data/modifiers.js';

// ---------------------------------------------------------------------------
// Modifier backgrounds: a light wash plus one pattern per modifier, behind the bars.
// ---------------------------------------------------------------------------

const TINT_ALPHA = 0.05;
const PATTERN_ALPHA = 0.34;

// Every pattern is laid out from the canvas origin, so it stays still on screen and
// only the edges of a region move as the timeline scrolls.
const PATTERNS = {
  diagonal_up(ctx, x0, x1, top, bottom) {
    const h = bottom - top, gap = 10;
    ctx.beginPath();
    for (let x = Math.floor((x0 - h) / gap) * gap; x <= x1; x += gap) { ctx.moveTo(x, bottom); ctx.lineTo(x + h, top); }
    ctx.stroke();
  },
  diagonal_down(ctx, x0, x1, top, bottom) {
    const h = bottom - top, gap = 10;
    ctx.beginPath();
    for (let x = Math.floor((x0 - h) / gap) * gap; x <= x1; x += gap) { ctx.moveTo(x, top); ctx.lineTo(x + h, bottom); }
    ctx.stroke();
  },
  horizontal(ctx, x0, x1, top, bottom) {
    ctx.beginPath();
    for (let y = top + 4.5; y < bottom; y += 8) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  },
  dots(ctx, x0, x1, top, bottom) {
    const gap = 9;
    ctx.beginPath();
    for (let y = top + 4, row = 0; y < bottom; y += gap, row++) {
      const shift = row % 2 ? gap / 2 : 0;
      for (let x = Math.floor(x0 / gap) * gap - gap + shift; x <= x1; x += gap) ctx.rect(x - 1, y - 1, 2, 2);
    }
    ctx.fill();
  },
  crosses(ctx, x0, x1, top, bottom) {
    const gap = 13, arm = 2.5;
    ctx.beginPath();
    for (let y = top + 6.5, row = 0; y < bottom; y += gap, row++) {
      const shift = row % 2 ? gap / 2 : 0;
      for (let x = Math.floor(x0 / gap) * gap - gap + shift + 0.5; x <= x1 + gap; x += gap) {
        ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm);
      }
    }
    ctx.stroke();
  },
  dashes(ctx, x0, x1, top, bottom) {
    const gap = 14, len = 6;
    ctx.beginPath();
    for (let y = top + 4.5, row = 0; y < bottom; y += 7, row++) {
      const shift = row % 2 ? gap / 2 : 0;
      for (let x = Math.floor(x0 / gap) * gap - gap + shift; x <= x1; x += gap) { ctx.moveTo(x, y); ctx.lineTo(x + len, y); }
    }
    ctx.stroke();
  },
};

// Background for one stretch of time where the given modifiers were on.
export function drawModifierPatterns(ctx, x0, x1, top, bottom, modifierIds, strength = 1) {
  if (!modifierIds || !modifierIds.length || x1 <= x0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, bottom - top);
  ctx.clip();
  ctx.lineWidth = 1;
  for (const id of modifierIds) {
    const color = modifierColor(id);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = TINT_ALPHA * strength;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    ctx.globalAlpha = Math.min(1, PATTERN_ALPHA * strength);
    (PATTERNS[modifierPattern(id)] || PATTERNS.diagonal_up)(ctx, x0, x1, top, bottom);
  }
  ctx.restore();
}

// Backgrounds for a row of bins: consecutive bins with the same modifiers are one stretch.
export function drawModifierRuns(ctx, bins, xOf, top, bottom) {
  let runStart = 0;
  for (let i = 1; i <= bins.length; i++) {
    const key = bins[runStart]?.modifiers.join(',');
    if (i < bins.length && bins[i].modifiers.join(',') === key) continue;
    const mods = bins[runStart].modifiers;
    if (mods.length) drawModifierPatterns(ctx, xOf(bins[runStart].t0), xOf(bins[i - 1].t1), top, bottom, mods);
    runStart = i;
  }
}

// ---------------------------------------------------------------------------
// Event markers
// ---------------------------------------------------------------------------

export const EVENT_ICONS = {
  shock: { shape: 'bolt', color: '#f59e0b' },
  shock_end: { shape: 'bolt', color: '#94a3b8' },
  pantry_added: { shape: 'plus', color: '#22c55e' },
  pantry_removed: { shape: 'minus', color: '#ef4444' },
  pantry_closed: { shape: 'cross', color: '#f59e0b' },
  pantry_reopened: { shape: 'check', color: '#22c55e' },
};

// The markers to draw for a list of events. A shock or a pantry change made by hand gets
// its own heavy divider. Pantries opening in the morning and closing in the evening happen
// every day, so each morning's openings (and each evening's closings) share one quiet marker,
// placed where the first of them happened.
let markerCache = { events: null, n: -1, markers: [] };
export function eventMarkers(events) {
  if (markerCache.events === events && markerCache.n === events.length) return markerCache.markers;
  const markers = [];
  const collecting = {}; // event type -> the group still being added to
  for (const evt of events) {
    if (!EVENT_ICONS[evt.type]) continue;
    if (!evt.routine) {
      markers.push({ time: evt.time, type: evt.type, routine: false });
      continue;
    }
    const g = collecting[evt.type];
    if (g && evt.time - g.last <= CONFIG.routineEventGroupGap) {
      g.last = evt.time;
      g.count++;
    } else {
      markers.push(collecting[evt.type] = { time: evt.time, last: evt.time, type: evt.type, routine: true, count: 1 });
    }
  }
  markerCache = { events, n: events.length, markers };
  return markers;
}

function drawShape(ctx, shape, x, y, s, color, lineWidth) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (shape === 'bolt') {
    const pts = [[0.25, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.25, 1], [0.6, -0.15], [0.05, -0.15]];
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s)));
    ctx.closePath();
    ctx.fill();
    return;
  }
  const a = s * 0.62;
  if (shape === 'plus') {
    ctx.moveTo(x - a, y); ctx.lineTo(x + a, y); ctx.moveTo(x, y - a); ctx.lineTo(x, y + a);
  } else if (shape === 'minus') {
    ctx.moveTo(x - a, y); ctx.lineTo(x + a, y);
  } else if (shape === 'cross') {
    const d = a * 0.8;
    ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
  } else if (shape === 'check') {
    ctx.moveTo(x - a, y); ctx.lineTo(x - a * 0.25, y + a * 0.7); ctx.lineTo(x + a, y - a * 0.65);
  }
  ctx.stroke();
}

// Draw markers between tMin and tMax. large: the timeline's full-size dividers and badges;
// otherwise the lighter version used on the sparklines.
export function drawEventMarkers(ctx, markers, xOf, tMin, tMax, top, bottom, { offsetX = 0, large = true } = {}) {
  ctx.save();
  // the quiet daily markers first, so the heavy dividers sit on top of them
  for (const routine of [true, false]) {
    for (const m of markers) {
      if (m.routine !== routine || m.time < tMin || m.time > tMax) continue;
      const icon = EVENT_ICONS[m.type];
      const x = Math.round(offsetX + xOf(m.time));
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      if (routine) {
        ctx.strokeStyle = 'rgba(148,163,184,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, top);
        ctx.lineTo(x + 0.5, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        if (large) {
          ctx.beginPath();
          ctx.arc(x + 0.5, top + 8, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = '#1e293b';
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1;
          ctx.stroke();
          drawShape(ctx, icon.shape, x + 0.5, top + 8, 5.5, '#cbd5e1', 1.4);
        }
        continue;
      }

      const width = large ? CONFIG.eventMarkerWidth : Math.max(1.5, CONFIG.eventMarkerWidth - 1);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(2,6,23,0.85)'; // dark edge, so the divider reads over bars of any color
      ctx.lineWidth = width + 2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.strokeStyle = icon.color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      const r = large ? 10 : 6.5;
      const cy = top + r + 1.5;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = icon.color;
      ctx.fill();
      ctx.strokeStyle = '#020617';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      drawShape(ctx, icon.shape, x, cy, large ? 7.5 : 5, '#020617', large ? 2.2 : 1.6);
    }
  }
  ctx.restore();
}
