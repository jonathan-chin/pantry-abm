import { UNMET_REASONS, needTotal } from '../data/reasons.js';
import { simSecondsToMinutes as toMin } from '../config.js';

export function generateCSV(runs, allEvents) {
  const headers = [
    'run_id', 'modifiers', 'time_minutes', 'served', 'redirected', 'left', 'stayed_home', 'in_line',
  ];
  const rows = [
    '# NYC Pantry ABM: proof of concept. Nothing here is real data; results are illustrative.',
    headers.join(','),
  ];

  for (const run of runs) {
    const modStr = run.modifiers.join('+') || 'baseline';
    for (const s of run.samples) {
      rows.push([
        run.id, modStr, toMin(s.time).toFixed(1),
        s.served, s.redirected, s.left, s.stayedHome ?? 0, s.inLine,
      ].join(','));
    }
  }

  rows.push('');
  rows.push('# Events');
  rows.push('run_id,time_minutes,type,detail');
  for (const e of allEvents) {
    rows.push([e.runId, toMin(e.time).toFixed(1), e.type, `"${e.detail}"`].join(','));
  }

  rows.push('');
  rows.push('# Run summaries');
  rows.push('run_id,seed,modifiers,run_minutes,need,served,left_no_food,left_too_long,stayed_home,redirected,avg_distance_km,avg_wait_minutes,' + UNMET_REASONS.map(r => 'unmet_' + r.id).join(',')
    + ',households,households_in_need,waiting_1plus_days,waiting_3plus_days,gave_up,retired,joined,ever_waited_3plus_days');
  for (const run of runs) {
    const s = run.stats;
    const modStr = run.modifiers.join('+') || 'baseline';
    const avgDist = s.served > 0 ? (s.totalDist / s.served).toFixed(2) : '0';
    const avgWait = s.waitN > 0 ? toMin(s.totalWait / s.waitN).toFixed(2) : '0';
    rows.push([
      run.id, run.seed ?? '', modStr, toMin(run.simTime).toFixed(1),
      needTotal(s), s.served, s.leftNoFood, s.leftTooLong, s.stayedHome ?? 0, s.redirected,
      avgDist, avgWait,
      ...UNMET_REASONS.map(r => s.reasons?.[r.id] ?? 0),
      ...['households', 'inNeed', 'waiting1', 'waiting3', 'gaveUp', 'retired', 'joined', 'everWaited3'].map(k => run.households?.[k] ?? ''),
    ].join(','));
  }

  rows.push('');
  rows.push('# Pantry performance');
  rows.push('run_id,pantry_id,name,served,left_no_food,left_too_long,avg_wait_minutes,stock_outs');
  for (const run of runs) {
    for (const p of run.pantries || []) {
      rows.push([
        run.id, p.id, `"${String(p.name).replace(/"/g, '""')}"`,
        p.served, p.leftNoFood, p.leftTooLong,
        p.waitN > 0 ? toMin(p.waitSum / p.waitN).toFixed(2) : '0',
        p.stockOuts,
      ].join(','));
    }
  }

  return rows.join('\n');
}

export function downloadCSV(content, filename = 'simulation-data.csv') {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
