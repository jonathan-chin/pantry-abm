// Bars always use these colors; active modifiers show up as stripes behind the bars instead.
export const BAND_COLORS = {
  served: 'hsl(142, 71%, 55%)',
  redirected: 'hsl(258, 90%, 66%)',
  inLine: 'hsl(215, 14%, 47%)',
  left: 'hsl(0, 84%, 60%)',
  stayedHome: 'hsl(350, 42%, 36%)',
};

// Time-of-day bands for the strip under the timeline (active hours are 6am–8pm).
export const PERIODS = [
  { id: 'morning', label: 'Morning', start: 0, end: 12, color: '#FAC775' },
  { id: 'afternoon', label: 'Afternoon', start: 12, end: 17, color: '#EF9F27' },
  { id: 'evening', label: 'Evening', start: 17, end: 24, color: '#7F77DD' },
];

export function periodFor(hour) {
  return PERIODS.find(p => hour >= p.start && hour < p.end) || PERIODS[0];
}

export function wellbeingColor(score) {
  const clamped = Math.max(0, Math.min(1, score));
  if (clamped > 0.5) {
    const t = (clamped - 0.5) * 2;
    const r = Math.round(138 * (1 - t) + 59 * t);
    const g = Math.round(92 * (1 - t) + 130 * t);
    const b = Math.round(246 * (1 - t) + 246 * t);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = clamped * 2;
    const r = Math.round(239 * (1 - t) + 138 * t);
    const g = Math.round(68 * (1 - t) + 92 * t);
    const b = Math.round(68 * (1 - t) + 246 * t);
    return `rgb(${r},${g},${b})`;
  }
}
