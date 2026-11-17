#!/usr/bin/env node
// Runs scenarios without the UI. Every scenario uses the same seeds, so each seed
// gives the same pantries, weather and arrivals, and the scenarios can be compared
// pair by pair.
//
//   npm run batch
//   npm run batch -- --map bronx --days 5 --seeds 20
//   npm run batch -- --scenarios baseline,load_balancing,weather_snow,weather_snow+load_balancing
//   npm run batch -- --csv results.csv
//
// Options
//   --map        manhattan | brooklyn | bronx | queens | staten-island   (default manhattan)
//   --days       simulated days per run                                   (default 14)
//   --seeds      how many seeds, or a range like 5-12                     (default 8)
//   --scenarios  comma-separated; join modifier ids with "+"; "baseline" is no modifiers
//   --csv        also write one row per run to this file

import { createServer } from 'vite';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { map: 'manhattan', days: 14, seeds: '8', scenarios: 'baseline,load_balancing', csv: null };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(\w+)$/.exec(argv[i]);
    if (!m || !(m[1] in out)) { console.error(`Unknown option: ${argv[i]}`); process.exit(1); }
    out[m[1]] = argv[++i];
  }
  const range = /^(\d+)-(\d+)$/.exec(String(out.seeds));
  out.seedList = range
    ? Array.from({ length: +range[2] - +range[1] + 1 }, (_, k) => +range[1] + k)
    : Array.from({ length: +out.seeds }, (_, k) => k + 1);
  out.days = +out.days;
  out.scenarioList = String(out.scenarios).split(',').map(s => s.trim()).filter(Boolean);
  return out;
}

const args = parseArgs(process.argv.slice(2));
const server = await createServer({
  root, appType: 'custom', logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
});
const eng = await server.ssrLoadModule('/src/simulation/engine.js');
const store = await server.ssrLoadModule('/src/data/cityStore.js');
const { UNMET_REASONS } = await server.ssrLoadModule('/src/data/reasons.js');
const { simSecondsToMinutes } = await server.ssrLoadModule('/src/config.js');
const s = eng.state;

if (!store.getCityIndex().some(c => c.slug === args.map)) {
  console.error(`Unknown map "${args.map}". Maps: ${store.getCityIndex().map(c => c.slug).join(', ')}`);
  await server.close();
  process.exit(1);
}
await store.loadCity(args.map);
eng.initModifiers();
const known = new Set(s.modifiers.map(m => m.id));
for (const sc of args.scenarioList) {
  for (const id of sc === 'baseline' ? [] : sc.split('+')) {
    if (!known.has(id)) {
      console.error(`Unknown modifier "${id}". Modifiers: ${[...known].join(', ')}`);
      await server.close();
      process.exit(1);
    }
  }
}

function runOnce(scenario, seed) {
  eng.setSeed(seed);
  eng.initModifiers();
  eng.initSim(s.params);
  for (const id of scenario === 'baseline' ? [] : scenario.split('+')) eng.toggleModifier(id);
  while (s.clock.day <= args.days) eng.stepSim();
  const st = s.stats;
  const left = st.leftNoFood + st.leftTooLong;
  const need = st.served + left + st.stayedHome; // everyone who needed food, including those who stayed home
  return {
    scenario, seed,
    needMet: st.served / Math.max(1, need),
    need: need / args.days,
    served: st.served / args.days,
    left: left / args.days,
    stayedHome: st.stayedHome / args.days,
    reasons: Object.fromEntries(UNMET_REASONS.map(r => [r.id, st.reasons[r.id] / args.days])),
    redirected: st.redirected / args.days,
    km: st.totalDist / Math.max(1, st.served),
    wait: simSecondsToMinutes(st.totalWait / Math.max(1, st.waitN)),      // minutes in line
    walk: simSecondsToMinutes(st.totalTravel / Math.max(1, st.travelN)),  // minutes walking
    hh: eng.getHouseholdStats(),
  };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : 0; };

const t0 = Date.now();
const results = {};
for (const sc of args.scenarioList) results[sc] = args.seedList.map(seed => runOnce(sc, seed));

console.log(`\n${args.map} · ${args.days} days per run · seeds ${args.seedList[0]}–${args.seedList.at(-1)} (${args.seedList.length} runs per scenario)\n`);
const width = Math.max(10, ...args.scenarioList.map(x => x.length)) + 2;
console.log('Per day. "left" set out and came back without food; "stayed home" needed food but never set out.\n');
console.log(`${'scenario'.padEnd(width)}need met        need   served   left   stayed home   redirected   avg km   walk min   wait min`);
for (const sc of args.scenarioList) {
  const r = results[sc];
  const f = k => mean(r.map(x => x[k]));
  console.log(sc.padEnd(width)
    + `${(100 * f('needMet')).toFixed(1)}% ± ${(100 * sd(r.map(x => x.needMet))).toFixed(1)}`.padEnd(16)
    + f('need').toFixed(0).padStart(4) + f('served').toFixed(0).padStart(9) + f('left').toFixed(0).padStart(7)
    + f('stayedHome').toFixed(0).padStart(14) + f('redirected').toFixed(0).padStart(13)
    + f('km').toFixed(2).padStart(9) + f('walk').toFixed(1).padStart(11) + f('wait').toFixed(1).padStart(11));
}

console.log('\nHouseholds\n');
console.log(`${'scenario'.padEnd(width)}at end   waiting 3+ days at end   ever waited 3+ days   gave up per day   retired per day`);
for (const sc of args.scenarioList) {
  const r = results[sc];
  const g = fn => mean(r.map(x => fn(x.hh)));
  console.log(sc.padEnd(width)
    + g(h => h.households).toFixed(0).padStart(6)
    + g(h => h.waiting3).toFixed(0).padStart(25)
    + `${(100 * g(h => h.everWaited3 / h.total)).toFixed(1)}%`.padStart(22)
    + g(h => h.gaveUp / args.days).toFixed(1).padStart(18)
    + g(h => h.retired / args.days).toFixed(1).padStart(18));
}

console.log('\nUnmet need per day, by cause\n');
const shown = UNMET_REASONS.filter(r => args.scenarioList.some(sc => mean(results[sc].map(x => x.reasons[r.id])) >= 0.5));
console.log(''.padEnd(width) + shown.map(r => r.label.padStart(r.label.length + 3)).join(''));
for (const sc of args.scenarioList) {
  console.log(sc.padEnd(width) + shown.map(r => mean(results[sc].map(x => x.reasons[r.id])).toFixed(0).padStart(r.label.length + 3)).join(''));
}

const base = results[args.scenarioList[0]];
if (args.scenarioList.length > 1) {
  console.log(`\nChange against "${args.scenarioList[0]}", paired by seed (mean ± sd of the differences)\n`);
  console.log(`${'scenario'.padEnd(width)}need met (points)     served/day        avg km            gave up/day       waiting 3+ at end`);
  for (const sc of args.scenarioList.slice(1)) {
    const d = k => results[sc].map((x, i) => x[k] - base[i][k]);
    const fmt = (a, digits, scale = 1) => `${mean(a) >= 0 ? '+' : ''}${(scale * mean(a)).toFixed(digits)} ± ${(scale * sd(a)).toFixed(digits)}`;
    const dh = fn => results[sc].map((x, i) => fn(x.hh) - fn(base[i].hh));
    console.log(sc.padEnd(width) + fmt(d('needMet'), 1, 100).padEnd(22) + fmt(d('served'), 0).padEnd(18) + fmt(d('km'), 2).padEnd(18)
      + fmt(dh(h => h.gaveUp / args.days), 1).padEnd(18) + fmt(dh(h => h.waiting3), 0));
  }
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (args.csv) {
  const rows = ['map,days,scenario,seed,need_met,need_per_day,served_per_day,left_per_day,stayed_home_per_day,redirected_per_day,avg_distance_km,avg_walk_minutes,avg_wait_minutes,households_at_end,waiting_3plus_days_at_end,ever_waited_3plus_days_share,gave_up_per_day,retired_per_day,joined_per_day,' + UNMET_REASONS.map(r => `unmet_${r.id}_per_day`).join(',')];
  for (const sc of args.scenarioList) {
    for (const x of results[sc]) {
      rows.push([args.map, args.days, sc, x.seed, x.needMet.toFixed(4), x.need.toFixed(1), x.served.toFixed(1), x.left.toFixed(1),
        x.stayedHome.toFixed(1), x.redirected.toFixed(1), x.km.toFixed(3), x.walk.toFixed(2), x.wait.toFixed(2),
        x.hh.households, x.hh.waiting3, (x.hh.everWaited3 / x.hh.total).toFixed(4), (x.hh.gaveUp / args.days).toFixed(2),
        (x.hh.retired / args.days).toFixed(2), (x.hh.joined / args.days).toFixed(2),
        ...UNMET_REASONS.map(r => x.reasons[r.id].toFixed(1))].join(','));
    }
  }
  writeFileSync(args.csv, rows.join('\n') + '\n');
  console.log(`wrote ${args.csv}`);
}

await server.close();
