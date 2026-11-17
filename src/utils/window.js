import { CONFIG } from '../config.js';

// Active sim-hours (the overnight skip is not counted). One sim-day is 14 active hours.
export const WINDOW_OPTIONS = [
  { label: '1 hr', hours: 1 },
  { label: '2 hr', hours: 2 },
  { label: '4 hr', hours: 4 },
  { label: '8 hr', hours: 8 },
  { label: '1 day', hours: 14 },
  { label: '3 days', hours: 42 },
  { label: '1 week', hours: 98 },
  { label: 'All', hours: Infinity },
];

export function windowSeconds(hours) {
  return (hours * 60) / CONFIG.minutesPerSimSecond;
}

// Time span (sim-seconds) the charts show for a window option.
export function windowSpan(idx, samples, now) {
  const opt = WINDOW_OPTIONS[idx] || WINDOW_OPTIONS[0];
  if (isFinite(opt.hours)) return windowSeconds(opt.hours);
  const first = samples.length ? samples[0].time - CONFIG.chartSampleInterval : 0;
  return Math.max(now - first, CONFIG.chartSampleInterval * 4);
}

// Group samples that fall inside [now - span, now] into bins anchored to absolute
// time, so bins don't reshuffle as time moves. Flows are summed; "inLine" is averaged.
export function binSamples(samples, span, now, maxBins) {
  const interval = CONFIG.chartSampleInterval;
  const binDur = interval * Math.max(1, Math.ceil(span / (Math.max(1, maxBins) * interval)));
  const tMin = now - span;
  const bins = [];
  let cur = null;
  for (const s of samples) {
    const mid = s.time - interval / 2;
    if (s.time < tMin) continue;
    const b = Math.floor(mid / binDur);
    if (!cur || cur.b !== b) {
      cur = {
        b, t0: b * binDur, t1: (b + 1) * binDur, n: 0,
        served: 0, redirected: 0, left: 0, stayedHome: 0, inLine: 0,
        waitSum: 0, waitN: 0, travelSum: 0, travelN: 0,
        modifiers: s.modifiers || [], hour: s.hour,
      };
      bins.push(cur);
    }
    cur.n++;
    cur.served += s.served || 0;
    cur.redirected += s.redirected || 0;
    cur.left += s.left || 0;
    cur.stayedHome += s.stayedHome || 0;
    cur.inLine += s.inLine || 0;
    cur.waitSum += s.waitSum || 0;
    cur.waitN += s.waitN || 0;
    cur.travelSum += s.travelSum || 0;
    cur.travelN += s.travelN || 0;
    cur.modifiers = s.modifiers || [];
  }
  for (const b of bins) b.inLine = b.n ? b.inLine / b.n : 0;
  return { bins, binDur };
}
