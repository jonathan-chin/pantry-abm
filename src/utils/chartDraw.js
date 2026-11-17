import { modifierColor } from '../data/modifiers.js';

export const EVENT_ICONS = {
  shock: { symbol: '⚡', color: '#f59e0b' },
  shock_end: { symbol: '⚡', color: '#64748b' },
  pantry_added: { symbol: '+', color: '#22c55e' },
  pantry_removed: { symbol: '−', color: '#ef4444' },
  pantry_closed: { symbol: '✕', color: '#f59e0b' },
  pantry_reopened: { symbol: '✓', color: '#22c55e' },
};

const STRIPE_GAP = 7;

// Diagonal stripes behind a stretch of bars, one stripe color per active modifier,
// cycling so every combination stays readable. `phase` keeps stripes attached to the
// data as it scrolls.
export function drawModifierStripes(ctx, x0, x1, top, bottom, modifierIds, phase = 0, alpha = 0.3) {
  if (!modifierIds.length || x1 <= x0) return;
  const colors = modifierIds.map(modifierColor);
  const h = bottom - top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  const startN = Math.floor((x0 - h - phase) / STRIPE_GAP);
  const endN = Math.ceil((x1 - phase) / STRIPE_GAP);
  for (let n = startN; n <= endN; n++) {
    const x = phase + n * STRIPE_GAP;
    ctx.strokeStyle = colors[((n % colors.length) + colors.length) % colors.length];
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + h, top);
    ctx.stroke();
  }
  ctx.restore();
}

// Draw stripes for consecutive bins that share the same modifier set as one block.
export function drawStripeRuns(ctx, bins, xOf, top, bottom, phase) {
  let runStart = 0;
  for (let i = 1; i <= bins.length; i++) {
    const key = bins[runStart]?.modifiers.join(',');
    if (i < bins.length && bins[i].modifiers.join(',') === key) continue;
    const mods = bins[runStart].modifiers;
    if (mods.length) drawModifierStripes(ctx, xOf(bins[runStart].t0), xOf(bins[i - 1].t1), top, bottom, mods, phase);
    runStart = i;
  }
}
