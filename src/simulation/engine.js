import { CONFIG, perHourToPerSimSecond } from '../config.js';
import { MODIFIERS } from '../data/modifiers.js';
import { LAYERS } from '../data/layers.js';
import { WEATHER_EFFECTS, DAILY_WEATHER } from '../data/weather.js';
import { distanceKm } from '../utils/geo.js';
import { getCity, getAdjacency } from '../data/cityStore.js';
import { findNearestNode, aStar, pathPosition, computeSegLengths } from '../utils/pathfinding.js';
import { WINDOW_OPTIONS, windowSeconds } from '../utils/window.js';
import { loadPref, savePref } from '../utils/prefs.js';
import { rng, seedRng, normalizeSeed } from '../utils/rng.js';
import { UNMET_REASONS, REASON_KIND, emptyReasons } from '../data/reasons.js';
import { MinHeap } from '../utils/heap.js';
import { createHousehold, hrand, lifeRand, randomUsualMinute, NEED_START_MIN, NEED_END_MIN } from './households.js';

export { MODIFIERS };

let nextPantryId = 1;

// Households waiting for their need to come due, keyed by the need-clock value at
// which it does; and households with a trip planned, keyed by its clock time.
let needHeap = new MinHeap();
let attemptHeap = new MinHeap();
let nextHouseholdId = 1;
const NEED_WINDOW_MINUTES = NEED_END_MIN - NEED_START_MIN;

function emptyHouseholds() {
  return {
    list: [],        // every active household (retired ones are dropped now and then)
    active: 0,
    needClock: 0,    // advances by 1 per day at normal need; multipliers speed it up or slow it down
    total: 0,        // every household that has ever been in the pool
    joined: 0,       // joined after the start
    retired: 0,      // stopped needing pantry food
    gaveUp: 0,       // left after too many days in a row without food
    everWaited3: 0,  // households that have gone 3 or more days in a row without food
  };
}
let listeners = new Set();
let stateVersion = 0;
let lastNotifyTime = 0;
const NOTIFY_INTERVAL = 200;

// Development only. The simulation's state lives in this module. If the dev server swapped
// a changed copy into a page that is already open, the page would hold two simulations,
// each feeding different parts of the screen (a heatmap from one, the map from the other).
// So when this file, or anything it depends on, changes, reload the page instead.
if (import.meta.hot && typeof window !== 'undefined') {
  import.meta.hot.accept(() => window.location.reload());
}

export function getVersion() { return stateVersion; }

const DEFAULT_WINDOW_IDX = (() => {
  const want = CONFIG.defaultWindowHours === 'all' ? Infinity : CONFIG.defaultWindowHours;
  const i = WINDOW_OPTIONS.findIndex(o => o.hours === want);
  if (i < 0) throw new Error(`config/simulation.yaml: charts.default_window_hours must be one of ${WINDOW_OPTIONS.map(o => (isFinite(o.hours) ? o.hours : 'all')).join(', ')}`);
  return i;
})();

function startClock() {
  return { hour: Math.floor(CONFIG.startHour), minute: (CONFIG.startHour % 1) * 60, day: 1, weekday: CONFIG.startWeekday };
}

// Which optional map layers are on: the saved choice if there is one, else the default.
function startLayers() {
  const saved = loadPref('layers', {});
  return Object.fromEntries(LAYERS.map(l => [l.id, typeof saved[l.id] === 'boolean' ? saved[l.id] : l.on]));
}

// Flows during one chart sample. "left" set out and came back without food;
// "stayedHome" needed food but never set out. r_<reason> counts each cause.
function emptyAcc() {
  const acc = { served: 0, redirected: 0, left: 0, stayedHome: 0, waitSum: 0, waitN: 0, travelSum: 0, travelN: 0, distSum: 0 };
  for (const r of UNMET_REASONS) acc['r_' + r.id] = 0;
  return acc;
}

// Need = served + leftNoFood + leftTooLong + stayedHome.
function emptyStats() {
  return {
    served: 0, leftNoFood: 0, leftTooLong: 0, stayedHome: 0, redirected: 0,
    totalDist: 0, totalWait: 0, waitN: 0, totalTravel: 0, travelN: 0,
    reasons: emptyReasons(),
  };
}

export const state = {
  running: false,
  speed: CONFIG.initialSpeed,
  modifiers: [],
  pantries: [],
  agents: [],
  simTime: 0,
  clock: startClock(),
  weather: { condition: 'clear', wind: 'calm' },

  shock: { active: false, remaining: 0, severity: 1, variance: 0 },

  stats: emptyStats(),

  // One sample per chartSampleInterval sim-seconds; each holds the flows for that interval.
  chart: { samples: [], sampleTimer: 0, acc: emptyAcc() },

  // Heatmap counts: met / unmet outcomes at each agent's starting cell. The map draws the unmet ones.
  heat: null,

  households: emptyHouseholds(),

  events: [],
  runs: [],
  currentRunId: 0,

  params: {
    pantryCount: CONFIG.initialPantryCount,
    capacity: CONFIG.initialCapacity,
    householdCount: CONFIG.initialHouseholdCount,         // households in the pool; applied on Reset
    variance: CONFIG.initialVariance,
    serviceRatePerHour: CONFIG.initialServiceRatePerHour, // people each open pantry serves per hour
    shockVariance: CONFIG.initialShockVariance,
  },

  seed: CONFIG.initialSeed,     // used by the next Reset
  runSeed: CONFIG.initialSeed,  // the seed the current run started from
  stepAlpha: 0,                 // how far the display is between two steps (0–1)

  view: { windowIdx: clampWindowIdx(loadPref('windowIdx', DEFAULT_WINDOW_IDX)) },
  layers: startLayers(),

  inspecting: null,
  addingPantry: false,
  removingPantry: false,
  closingPantry: false,
  hiddenChartBands: {},
};

function clampWindowIdx(i) {
  return Number.isInteger(i) && i >= 0 && i < WINDOW_OPTIONS.length ? i : DEFAULT_WINDOW_IDX;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  stateVersion++;
  for (const fn of listeners) fn();
}

export function getActiveModifiers() {
  return state.modifiers.filter(m => m.active);
}

function isReplacementModActive() {
  return getActiveModifiers().some(m => m.type === 'replacement');
}

// The weather agents actually experience: a weather modifier overrides the daily roll.
export function getEffectiveWeather() {
  const forced = getActiveModifiers().find(m => m.type === 'weather');
  return forced ? forced.weather : state.weather.condition;
}

function weatherEffect() {
  return WEATHER_EFFECTS[getEffectiveWeather()] || WEATHER_EFFECTS.clear;
}

// Per-trip multiplier drawn from N(mean, sd), clamped to something sensible.
function sampleMult(h, [mean, sd]) {
  // always drawn, so a household's random stream stays in step whatever the weather
  const u = 1 - hrand(h), v = hrand(h);
  if (!sd) return mean;
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(CONFIG.multiplierLimits[0], Math.min(CONFIG.multiplierLimits[1], mean + z * sd));
}

export function toggleModifier(id) {
  const mod = state.modifiers.find(m => m.id === id);
  if (!mod) return;
  const exclusive = mod.type === 'replacement' || mod.type === 'weather';
  if (exclusive && !mod.active) {
    state.modifiers.forEach(m => { if (m.type === mod.type) m.active = false; });
  }
  mod.active = !mod.active;
  notify();
}

// routine: part of the daily rhythm (pantries opening and closing by their hours),
// which the charts draw as one quiet marker per morning or evening.
export function logEvent(type, detail = '', routine = false) {
  state.events.push({ time: state.simTime, type, detail, routine, runId: state.currentRunId });
}

export function createPantry(x, y, name, capacity) {
  const id = nextPantryId++;
  const shift = (Math.floor(rng.world() * 3) - 1) * CONFIG.hoursJitter; // -1, 0 or +1 times the jitter
  const city = getCity();
  const p = {
    id, name, lat: x, lng: y,
    node: city ? findNearestNode(city.nodes, x, y) : 0,
    capacity, stock: capacity,
    restockTimer: CONFIG.restockHeadStartMin + rng.world() * (CONFIG.restockHeadStartMax - CONFIG.restockHeadStartMin),
    nextRestock: 0, restockAmt: 0,
    queue: [], serviceTimer: 0,
    closed: false,
    closedReason: null, // 'hours' | 'manual'
    manuallyClosed: false,
    openHour: CONFIG.defaultOpenHour + shift,
    closeHour: CONFIG.defaultCloseHour + shift,
    shake: 0,
    stats: { served: 0, leftNoFood: 0, leftTooLong: 0, avgWait: 0, waitSum: 0, waitN: 0, stockOuts: 0 },
  };
  scheduleRestock(p);
  return p;
}

function scheduleRestock(p) {
  p.nextRestock = CONFIG.restockMinInterval + rng.world() * (CONFIG.restockMaxInterval - CONFIG.restockMinInterval);
  p.restockAmt = Math.max(1, Math.round(CONFIG.restockMinAmt + rng.world() * (CONFIG.restockMaxAmt - CONFIG.restockMinAmt)));
}

function assignPantry(h, travelMult) {
  const { home, profile } = h;
  if (state.pantries.length === 0) return { gaveUp: true, profile };
  const open = state.pantries.filter(p => !p.closed);

  // Profiles that know opening hours only consider open pantries, and stay home
  // when everything is closed. The others may walk to a closed pantry.
  let candidates;
  if (profile.knowsClosed) {
    if (open.length === 0) return { stayHome: true, profile };
    candidates = open;
  } else {
    candidates = state.pantries;
  }

  // Memory: skip pantries that failed this household recently, if there is another choice.
  const today = state.clock.day;
  const notAvoided = candidates.filter(p => !(h.avoid.get(p.id) > today));
  if (notAvoided.length) candidates = notAvoided;

  const withDist = candidates.map(p => ({ pantry: p, dist: distanceKm(home, [p.lat, p.lng]) })).sort((a, b) => a.dist - b.dist);

  // Weather shrinks everyone's range, including profiles with no limit of their own.
  const maxKm = (profile.maxKm >= 99 ? CONFIG.maxWalkKm : profile.maxKm) * travelMult;
  if (!withDist.some(c => c.dist <= maxKm)) return { gaveUp: true, profile };

  const useLoadBalancing = isReplacementModActive();

  if (!useLoadBalancing || rng.behavior() > profile.comply) {
    if (profile.habit) {
      // Habit: back to wherever they last got food, if that is still an option
      const usual = h.lastGood != null && withDist.find(c => c.pantry.id === h.lastGood);
      if (usual) return { pantry: usual.pantry, dist: usual.dist, nudged: false, profile };
      const top5 = withDist.slice(0, Math.min(CONFIG.choice.habitNearestCount, withDist.length));
      const pick = top5[Math.floor(rng.behavior() * top5.length)];
      return { pantry: pick.pantry, dist: pick.dist, nudged: false, profile };
    }

    if (profile.queues) {
      const ch = CONFIG.choice;
      const scored = withDist.slice(0, ch.weigherNearestCount).map(c => ({
        ...c,
        score: (c.pantry.stock / c.pantry.capacity)
          / (1 + c.dist * ch.weigherDistancePenaltyPerKm)
          / (1 + c.pantry.queue.length * ch.weigherLinePenaltyPerPerson),
      }));
      scored.sort((a, b) => b.score - a.score);
      return { pantry: scored[0].pantry, dist: scored[0].dist, nudged: false, profile };
    }

    const nearest = withDist[0];
    return { pantry: nearest.pantry, dist: nearest.dist, nudged: false, profile };
  }

  // Load balancing knows which pantries are open, even for agents who don't.
  // ASSUMPTION: it also sees every pantry's stock and line, live and without error.
  // That's fine for now; how much worse it does with stale or partial data is an
  // open question (see README, "Assumptions").
  const openDist = withDist.filter(c => !c.pantry.closed);
  const balanced = openDist.length ? openDist : withDist;
  const nearest = balanced[0];

  const ch = CONFIG.choice;
  if (nearest.pantry.stock >= nearest.pantry.capacity * ch.balanceRedirectBelowStockShare) {
    return { pantry: nearest.pantry, dist: nearest.dist, nudged: false, profile };
  }

  const withStock = balanced.filter(c => c.pantry.stock >= 1);
  if (withStock.length === 0) {
    return { pantry: nearest.pantry, dist: nearest.dist, nudged: false, profile };
  }

  const scores = withStock.map(({ pantry, dist }) => {
    const stockScore = pantry.stock / pantry.capacity;
    const distPenalty = 1 / (1 + dist * ch.balanceDistancePenaltyPerKm);
    const queuePenalty = 1 / (1 + pantry.queue.length * ch.balanceLinePenaltyPerPerson);
    const noise = ch.balanceNoiseRange[0] + rng.behavior() * (ch.balanceNoiseRange[1] - ch.balanceNoiseRange[0]);
    return { pantry, dist, score: stockScore * stockScore * distPenalty * queuePenalty * noise };
  });

  const total = scores.reduce((s, x) => s + x.score, 0);
  let r = rng.behavior() * total;
  for (const s of scores) {
    r -= s.score;
    if (r <= 0) return { pantry: s.pantry, dist: s.dist, nudged: s.pantry !== nearest.pantry, profile };
  }
  return { pantry: nearest.pantry, dist: nearest.dist, nudged: false, profile };
}

// ---------- Households: need, trips, memory and turnover ----------

function addHousehold(dueNow) {
  const hh = state.households;
  const h = createHousehold(nextHouseholdId++, state.runSeed);
  hh.list.push(h);
  hh.active++;
  hh.total++;
  if (dueNow) {
    h.inNeed = true;
    scheduleAttempt(h, state.clock.day);
  } else {
    // start somewhere in the middle of a cycle, so needs are spread over the days
    h.dueAt = hh.needClock + rng.arrivals() * h.intervalDays;
    needHeap.push(h.dueAt, h);
  }
  return h;
}

function clockMinutes() {
  return state.clock.hour * 60 + state.clock.minute;
}

// Plan the household's next trip: its usual time of day, give or take, on `day`
// or the day after if that time has already passed.
function scheduleAttempt(h, day) {
  const jitter = (hrand(h) * 2 - 1) * CONFIG.usualTimeJitterMinutes;
  const minute = Math.max(NEED_START_MIN, Math.min(NEED_END_MIN - 1, h.usualMinute + jitter));
  let d = Math.max(day, state.clock.day);
  if (d === state.clock.day && minute <= clockMinutes()) d++;
  attemptHeap.push(d * 1440 + minute, h);
}

function exitHousehold(h, how) {
  h.active = false;
  h.inNeed = false;
  state.households.active--;
  state.households[how]++;
}

// The household got food: the need is met and the next one comes due a cycle later.
function householdServed(h, pantry) {
  const hh = state.households;
  h.timesServed++;
  h.inNeed = false;
  h.daysWaiting = 0;
  h.lastGood = pantry.id;
  const v = CONFIG.needIntervalVariation;
  h.dueAt = hh.needClock + h.intervalDays * (1 - v + 2 * v * hrand(h));
  needHeap.push(h.dueAt, h);
}

// The household went without today. The need carries over: it tries again tomorrow,
// remembers a pantry that failed it, may change its time of day, and eventually gives up.
function householdUnmet(h, reason, pantry) {
  if (!h.active) return;
  const hh = state.households;
  h.timesUnmet++;
  h.daysWaiting++;
  if (h.daysWaiting === 3) hh.everWaited3++;
  if (pantry) h.avoid.set(pantry.id, state.clock.day + CONFIG.avoidAfterFailureDays);
  if (h.daysWaiting >= CONFIG.givesUpAfterDays) {
    exitHousehold(h, 'gaveUp');
    return;
  }
  if (h.flexible && (reason === 'closed' || reason === 'nothing_open')) h.usualMinute = randomUsualMinute(h);
  scheduleAttempt(h, state.clock.day + 1);
}

// Each morning some households retire and new ones join.
function startOfDay() {
  const hh = state.households;
  for (const h of hh.list) {
    if (h.active && lifeRand(h) < CONFIG.retireProbabilityPerDay) exitHousehold(h, 'retired');
  }
  if (hh.list.length > hh.active * 1.25 + 200) hh.list = hh.list.filter(h => h.active);

  const whole = Math.floor(CONFIG.newHouseholdsPerDay);
  const n = whole + (rng.arrivals() < CONFIG.newHouseholdsPerDay - whole ? 1 : 0);
  for (let i = 0; i < n; i++) addHousehold(true); // people join because they need food now
  hh.joined += n;
}

// Walking route from the household's home to a pantry, remembered for next time.
function routeFor(h, pantry) {
  let r = h.routes.get(pantry.id);
  if (r) return r;
  const city = getCity();
  const adj = getAdjacency();
  if (!city || !adj) return null;
  const startNode = h.node ?? findNearestNode(city.nodes, h.home[0], h.home[1]);
  const routeNodes = aStar(city.nodes, adj, startNode, pantry.node);
  const path = [[...h.home], ...routeNodes, [pantry.lat, pantry.lng]];
  const segLengths = computeSegLengths(path);
  const pathLen = segLengths.reduce((x, y) => x + y, 0);
  // Walk the street network, not the crow-flies line (matters across rivers).
  r = { path, segLengths, pathLen, km: pathLen * (city.kmPerUnit || 0.005) };
  h.routes.set(pantry.id, r);
  return r;
}

// One trip by a household that needs food. It always ends in exactly one outcome:
// served, left without food, or stayed home.
function attempt(h) {
  const fx = weatherEffect();
  const goesOut = hrand(h);
  const travelMult = sampleMult(h, fx.travel);
  const patience = sampleMult(h, fx.patience);

  const base = {
    household: h, home: h.home, pos: [...h.home], profile: h.profile,
    wellbeing: Math.max(0.25, 1 - 0.1 * h.daysWaiting), // the longer they've gone without, the redder the dot
    queueTime: 0, travelTime: 0,
    travelMult, patience, speedMult: fx.speed,
  };

  // Weather keeps a share of people home. Their need still counts.
  if (goesOut >= fx.demand) { stayHome(base, 'weather'); return; }

  const assignment = assignPantry(h, travelMult);
  // Knows opening hours, and nothing is open right now.
  if (assignment.stayHome) { stayHome(base, 'nothing_open'); return; }

  if (assignment.gaveUp) {
    // Too far from any pantry: waggle in place, then time out.
    state.agents.push({
      ...base,
      state: 'stranded', targetPantry: null, travelDist: 0, nudged: false,
      strandedTimer: CONFIG.strandedWaitMin + hrand(h) * (CONFIG.strandedWaitMax - CONFIG.strandedWaitMin),
      wagglePhase: hrand(h) * Math.PI * 2,
      path: null, segLengths: null, pathLen: 0,
    });
    return;
  }

  const route = routeFor(h, assignment.pantry);
  state.agents.push({
    ...base,
    targetPantry: assignment.pantry,
    travelDist: route ? route.km : assignment.dist,
    nudged: assignment.nudged,
    progress: 0, state: 'traveling',
    lingerTimer: 0,
    leaveReason: null,
    path: route?.path || null, segLengths: route?.segLengths || null, pathLen: route?.pathLen || 0,
  });
}

export function getHouseholdStats() {
  const hh = state.households;
  let inNeed = 0, waiting1 = 0, waiting3 = 0, longestWait = 0;
  for (const h of hh.list) {
    if (!h.active || !h.inNeed) continue;
    inNeed++;
    if (h.daysWaiting >= 1) waiting1++;
    if (h.daysWaiting >= 3) waiting3++;
    if (h.daysWaiting > longestWait) longestWait = h.daysWaiting;
  }
  return {
    households: hh.active, inNeed, waiting1, waiting3, longestWait,
    total: hh.total, joined: hh.joined, retired: hh.retired, gaveUp: hh.gaveUp, everWaited3: hh.everWaited3,
  };
}

// A person who needed food but never set out: shown briefly at home, then fades.
function stayHome(base, reason) {
  const a = {
    ...base, state: 'timed_out', leaveReason: reason, targetPantry: null, travelDist: 0, nudged: false,
    lingerTimer: CONFIG.strandedFadeTime, path: null, segLengths: null, pathLen: 0,
  };
  state.agents.push(a);
  countUnmet(a, reason);
}

// Record one unmet need, by cause. Pass the pantry when one was involved.
function countUnmet(a, reason, pantry) {
  const st = state.stats, acc = state.chart.acc;
  if (REASON_KIND[reason] === 'stayedHome') {
    st.stayedHome++;
    acc.stayedHome++;
  } else {
    if (reason === 'too_long') st.leftTooLong++; else st.leftNoFood++;
    acc.left++;
    if (pantry) { if (reason === 'too_long') pantry.stats.leftTooLong++; else pantry.stats.leftNoFood++; }
  }
  st.reasons[reason]++;
  acc['r_' + reason]++;
  recordOutcome(a, false);
  if (a.household) householdUnmet(a.household, reason, pantry);
}

// Turned away at a pantry: walk a short way back along the streets they came by, fading out.
function sendAway(a, reason) {
  a.state = 'leaving';
  a.leaveReason = reason;
  a.back = 0; // share of the trip walked back so far
  // Earlier versions picked a random direction here. These two unused draws keep
  // a seed producing exactly the same run as before.
  rng.behavior(); rng.behavior();
  a.lingerTimer = CONFIG.walkAwayTime;
}

// Where an agent is along its trip: 0 at home, 1 at the pantry.
function tripPosition(a, t) {
  if (a.path && a.segLengths) return pathPosition(a.path, a.segLengths, a.pathLen, t);
  return [
    a.home[0] + (a.targetPantry.lat - a.home[0]) * t,
    a.home[1] + (a.targetPantry.lng - a.home[1]) * t,
  ];
}

// Sim-seconds the whole trip takes at this agent's walking speed.
function tripTime(a) {
  return Math.max(CONFIG.minTripTime, a.travelDist / (CONFIG.travelSpeed * (a.speedMult ?? 1)));
}

function recordOutcome(a, met) {
  const h = state.heat;
  if (!h || !a.home) return;
  const c = Math.floor(a.home[0] / h.cell), r = Math.floor(a.home[1] / h.cell);
  if (c < 0 || r < 0 || c >= h.cols || r >= h.rows) return;
  (met ? h.met : h.unmet)[r * h.cols + c]++;
  h.version++;
}

function getShockMultiplier() {
  if (!state.shock.active) return 1;
  const decay = state.shock.remaining / CONFIG.shockDuration;
  const base = 1 + (state.shock.severity - 1) * decay;
  if (state.params.shockVariance <= 0) return base;
  const v = state.params.shockVariance / 100;
  const noise = Math.sin(state.simTime * 3.7) * Math.cos(state.simTime * 7.1) * 0.5
    + Math.sin(state.simTime * 13.3) * 0.3 + Math.cos(state.simTime * 1.9) * 0.2;
  return Math.max(0.5, base + (base - 1) * noise * v * 2);
}

function nextDay() {
  state.clock.day++;
  state.clock.weekday = (state.clock.weekday % 7) + 1;
}

function advanceClock(simMinutes) {
  const c = state.clock;
  c.minute += simMinutes;
  while (c.minute >= 60) {
    c.minute -= 60;
    c.hour++;
    if (c.hour >= 24) {
      c.hour = 0;
      nextDay();
    }
  }

  // Skip overnight: fast-forward from nightSkipHour to nightResumeHour
  const h = c.hour + c.minute / 60;
  if (h >= CONFIG.nightSkipHour || h < CONFIG.nightResumeHour) {
    // Anyone still out at night goes home without food (and tries again tomorrow),
    // then the map is cleared. This runs before the day number changes.
    for (const a of state.agents) {
      if (a.state === 'stranded') countUnmet(a, 'too_far');
      else if (a.state === 'traveling') countUnmet(a, 'night');
      else if (a.state === 'queued') countUnmet(a, 'night');
    }
    state.agents = [];
    for (const p of state.pantries) p.queue = [];
    if (h >= CONFIG.nightSkipHour) nextDay();
    c.hour = CONFIG.nightResumeHour;
    c.minute = 0;
    rollWeather();
    startOfDay();
  }
}

// Open/close pantries by their hours. A pantry that opens for the day starts full.
function updatePantryHours() {
  const h = state.clock.hour + state.clock.minute / 60;
  for (const p of state.pantries) {
    if (p.manuallyClosed) continue;
    const shouldBeOpen = h >= p.openHour && h < p.closeHour;
    if (p.closed && shouldBeOpen) {
      p.closed = false;
      p.closedReason = null;
      if (CONFIG.startsFullEachDay) {
        p.stock = p.capacity;
        p.restockTimer = 0;
        scheduleRestock(p);
      }
      logEvent('pantry_reopened', `id=${p.id} (hours)`, true);
    } else if (!p.closed && !shouldBeOpen) {
      p.closed = true;
      p.closedReason = 'hours';
      closePantryQueues(p);
      logEvent('pantry_closed', `id=${p.id} (hours)`, true);
    }
  }
}

// Called every frame with the real seconds that passed. The simulation itself
// advances in fixed steps, so a run doesn't depend on frame rate and a seed
// replays exactly.
export const SIM_STEP = CONFIG.simStep;
let stepBacklog = 0;

export function updateSim(dt) {
  if (!state.running) return;
  stepBacklog += dt * state.speed;
  let n = 0;
  while (stepBacklog >= SIM_STEP && n < CONFIG.maxStepsPerFrame) {
    stepSim();
    stepBacklog -= SIM_STEP;
    n++;
  }
  if (n === CONFIG.maxStepsPerFrame) stepBacklog = 0; // fell behind; don't try to catch up
  state.stepAlpha = stepBacklog / SIM_STEP;

  const now = performance.now();
  if (now - lastNotifyTime > NOTIFY_INTERVAL) {
    lastNotifyTime = now;
    notify();
  }
}

// One fixed step of simulated time (SIM_STEP sim-seconds).
export function stepSim() {
  const scaledDt = SIM_STEP;
  state.simTime += scaledDt;
  const acc = state.chart.acc;

  advanceClock(scaledDt * CONFIG.minutesPerSimSecond);
  updatePantryHours();

  if (state.shock.active) {
    state.shock.remaining -= scaledDt;
    if (state.shock.remaining <= 0) {
      state.shock.active = false;
      logEvent('shock_end');
    }
  }

  // Need comes due during the need window. The need clock gains one day per day;
  // weekends, modifiers and a shock make it run slower or faster. Weather doesn't
  // change it: it keeps people home instead (see attempt).
  const hh = state.households;
  const currentH = state.clock.hour + state.clock.minute / 60;
  if (currentH >= CONFIG.spawnStartHour && currentH < CONFIG.spawnEndHour) {
    const isWeekend = state.clock.weekday >= 6;
    const dayMultiplier = isWeekend ? CONFIG.weekendSpawnMultiplier : CONFIG.weekdaySpawnMultiplier;
    const needMultiplier = getActiveModifiers().reduce((m, mod) => m * (mod.needMultiplier ?? 1), 1);
    const needSpeed = getShockMultiplier() * dayMultiplier * needMultiplier;
    hh.needClock += needSpeed * (scaledDt * CONFIG.minutesPerSimSecond) / NEED_WINDOW_MINUTES;
    while (needHeap.size && needHeap.peekKey() <= hh.needClock) {
      const h = needHeap.pop();
      if (!h.active || h.inNeed) continue;
      h.inNeed = true;
      h.daysWaiting = 0;
      scheduleAttempt(h, state.clock.day);
    }
  }

  // Households whose planned time has come set out now.
  const nowKey = state.clock.day * 1440 + clockMinutes();
  while (attemptHeap.size && attemptHeap.peekKey() <= nowKey) {
    const h = attemptHeap.pop();
    if (h.active && h.inNeed) attempt(h);
  }

  for (const p of state.pantries) {
    if (p.closed) continue;
    p.restockTimer += scaledDt;
    if (p.restockTimer >= p.nextRestock) {
      p.restockTimer = 0;
      const wasEmpty = p.stock < 1;
      p.stock = Math.min(p.capacity, p.stock + p.restockAmt);
      if (wasEmpty && p.stock >= 1) p.shake = CONFIG.pantryShakeDuration;
      scheduleRestock(p);
    }
    if (p.shake > 0) p.shake -= scaledDt;
  }

  const serviceInterval = 1 / perHourToPerSimSecond(state.params.serviceRatePerHour);
  for (const p of state.pantries) {
    if (p.closed || p.queue.length === 0) { p.serviceTimer = 0; continue; }
    p.serviceTimer += scaledDt;
    while (p.serviceTimer >= serviceInterval && p.queue.length > 0) {
      p.serviceTimer -= serviceInterval;
      const a = p.queue.shift();
      if (p.stock >= 1) {
        p.stock -= 1;
        a.state = 'served';
        state.stats.served++;
        state.stats.totalDist += a.travelDist;
        state.stats.totalWait += a.queueTime;
        state.stats.waitN++;
        acc.served++;
        acc.distSum += a.travelDist;
        acc.waitSum += a.queueTime;
        acc.waitN++;
        p.stats.served++;
        p.stats.waitSum += a.queueTime;
        p.stats.waitN++;
        recordOutcome(a, true);
        if (a.household) householdServed(a.household, p);
        a.lingerTimer = CONFIG.lingerTime + CONFIG.fadeTime;
      } else {
        sendAway(a, 'no_food');
        countUnmet(a, 'no_food', p);
        p.stats.stockOuts++;
        p.shake = CONFIG.pantryShakeDuration;
      }
    }
  }

  // Back-of-line departure (weather lowers each agent's patience)
  for (const p of state.pantries) {
    for (let i = p.queue.length - 1; i >= 0; i--) {
      const a = p.queue[i];
      a.queueTime += scaledDt;
      a.wellbeing -= CONFIG.wellbeingDecayQueue * scaledDt;
      if (a.queueTime > CONFIG.maxQueueWait * (a.patience ?? 1) && rng.behavior() < CONFIG.queueLeaveChance * scaledDt) {
        p.queue.splice(i, 1);
        sendAway(a, 'too_long');
        countUnmet(a, 'too_long', p);
      }
    }
  }

  for (let i = state.agents.length - 1; i >= 0; i--) {
    const a = state.agents[i];
    // where the agent was a step ago, so the map can draw smooth motion between steps
    a.px = a.pos[0];
    a.py = a.pos[1];

    if (a.state === 'traveling') {
      a.progress += scaledDt / tripTime(a);
      a.travelTime += scaledDt;
      a.wellbeing -= CONFIG.wellbeingDecayTravel * scaledDt;

      if (a.progress >= 1) {
        if (a.targetPantry.closed) {
          sendAway(a, 'closed');
          countUnmet(a, 'closed', a.targetPantry);
        } else {
          a.state = 'queued';
          a.pos = [a.targetPantry.lat, a.targetPantry.lng];
          a.targetPantry.queue.push(a);
          if (a.nudged) { state.stats.redirected++; acc.redirected++; }
          state.stats.totalTravel += a.travelTime;
          state.stats.travelN++;
          acc.travelSum += a.travelTime;
          acc.travelN++;
        }
      } else {
        a.pos = tripPosition(a, Math.min(a.progress, 1));
      }
    } else if (a.state === 'queued') {
      // position updated in render
    } else if (a.state === 'stranded') {
      a.strandedTimer -= scaledDt;
      a.wellbeing -= CONFIG.wellbeingDecayTravel * scaledDt * CONFIG.wellbeingStrandedMultiplier;
      if (a.strandedTimer <= 0) {
        a.state = 'timed_out';
        a.leaveReason = 'too_far';
        a.lingerTimer = CONFIG.strandedFadeTime;
        countUnmet(a, 'too_far');
      }
    } else if (a.state === 'timed_out') {
      a.lingerTimer -= scaledDt;
      if (a.lingerTimer <= 0) {
        state.agents.splice(i, 1);
        continue;
      }
    } else if (a.state === 'leaving') {
      // back the way they came, at their own walking speed
      a.lingerTimer -= scaledDt;
      a.back = Math.min(1, a.back + scaledDt / tripTime(a));
      a.pos = tripPosition(a, 1 - a.back);
      if (a.lingerTimer <= 0 || a.back >= 1) {
        state.agents.splice(i, 1);
        continue;
      }
    } else if (a.state === 'served') {
      a.lingerTimer -= scaledDt;
      if (a.lingerTimer <= 0) {
        state.agents.splice(i, 1);
        continue;
      }
    }
  }

  // Chart sampling
  state.chart.sampleTimer += scaledDt;
  if (state.chart.sampleTimer >= CONFIG.chartSampleInterval) {
    state.chart.sampleTimer = 0;
    takeSample();
  }
}

function takeSample() {
  const inLine = state.pantries.reduce((s, p) => s + p.queue.length, 0);
  state.chart.samples.push({
    ...state.chart.acc,
    inLine,
    time: state.simTime,
    hour: state.clock.hour + state.clock.minute / 60,
    day: state.clock.day,
    weekday: state.clock.weekday,
    weather: getEffectiveWeather(),
    modifiers: getActiveModifiers().map(m => m.id),
  });
  if (state.chart.samples.length > CONFIG.chartMaxSamples) {
    state.chart.samples.shift();
  }
  state.chart.acc = emptyAcc();
}

// Totals over the selected window ("All" uses the run's cumulative stats).
export function getWindowStats() {
  const opt = WINDOW_OPTIONS[state.view.windowIdx];
  const s = state.stats;
  if (!isFinite(opt.hours)) {
    return {
      served: s.served, left: s.leftNoFood + s.leftTooLong, stayedHome: s.stayedHome, redirected: s.redirected,
      distSum: s.totalDist, waitSum: s.totalWait, waitN: s.waitN, travelSum: s.totalTravel, travelN: s.travelN,
      reasons: { ...s.reasons },
    };
  }
  const tMin = state.simTime - windowSeconds(opt.hours);
  const out = { ...state.chart.acc };
  for (const smp of state.chart.samples) {
    if (smp.time < tMin) continue;
    for (const k in out) out[k] += smp[k] || 0;
  }
  out.reasons = Object.fromEntries(UNMET_REASONS.map(r => [r.id, out['r_' + r.id]]));
  return out;
}

export function setWindowIdx(idx) {
  state.view.windowIdx = clampWindowIdx(idx);
  savePref('windowIdx', state.view.windowIdx);
  notify();
}

export function setLayer(name, on) {
  if (!(name in state.layers)) return;
  state.layers[name] = !!on;
  savePref('layers', state.layers);
  notify();
}

// Jump the clock to a weekday and time of day (minutes after midnight).
// Times are kept inside the active hours, since nights are skipped.
export function setClock(weekday, minutesOfDay) {
  const lo = CONFIG.nightResumeHour * 60;
  const hi = CONFIG.nightSkipHour * 60 - 1;
  const m = Math.max(lo, Math.min(hi, Math.round(minutesOfDay)));
  const c = state.clock;
  if (weekday !== c.weekday) {
    c.day += (weekday - c.weekday + 7) % 7;
    c.weekday = weekday;
  }
  c.hour = Math.floor(m / 60);
  c.minute = m % 60;
  updatePantryHours();
  notify();
}

export function setSeed(seed) {
  state.seed = normalizeSeed(seed);
  notify();
}

export function initSim(params) {
  state.runSeed = seedRng(state.seed);
  stepBacklog = 0;
  state.stepAlpha = 0;
  state.running = false;
  state.simTime = 0;
  state.clock = startClock();
  state.weather = { condition: 'clear', wind: 'calm' };
  state.agents = [];
  state.events = [];
  state.inspecting = null;
  state.shock = { active: false, remaining: 0, severity: CONFIG.shockSeverity, variance: 0 };
  state.stats = emptyStats();
  state.chart = { samples: [], sampleTimer: 0, acc: emptyAcc() };

  Object.assign(state.params, params);
  nextPantryId = 1;

  const city = getCity();
  if (city) {
    const cell = CONFIG.heatmapCell;
    const cols = Math.ceil(city.size[0] / cell), rows = Math.ceil(city.size[1] / cell);
    state.heat = { cell, cols, rows, met: new Float32Array(cols * rows), unmet: new Float32Array(cols * rows), version: 0 };
  } else {
    state.heat = null;
  }

  const pool = city ? [...city.pantryPool] : [];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.world() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.pantries = pool.slice(0, state.params.pantryCount).map(d => {
    const v = state.params.variance / 100;
    const cap = Math.max(CONFIG.minCapacity, Math.round(state.params.capacity * (1 + (rng.world() - 0.5) * v * 2)));
    return createPantry(d.x, d.y, d.name, cap);
  });

  // The household pool. Needs start spread across each household's cycle.
  needHeap = new MinHeap();
  attemptHeap = new MinHeap();
  nextHouseholdId = 1;
  state.households = emptyHouseholds();
  if (city) for (let i = 0; i < state.params.householdCount; i++) addHousehold(false);

  state.currentRunId++;
  notify();
}

export function triggerShock() {
  state.shock.active = true;
  state.shock.remaining = CONFIG.shockDuration;
  state.shock.severity = CONFIG.shockSeverity;
  if (getCity()) {
    for (let i = 0; i < CONFIG.shockNewHouseholds; i++) addHousehold(true);
    state.households.joined += CONFIG.shockNewHouseholds;
  }
  logEvent('shock', `severity=${CONFIG.shockSeverity.toFixed(1)} new_households=${CONFIG.shockNewHouseholds}`);
  notify();
}

export function addPantryAt(x, y, capacity) {
  const p = createPantry(x, y, `Site ${nextPantryId}`, capacity);
  state.pantries.push(p);
  logEvent('pantry_added', `id=${p.id}`);
  notify();
  return p;
}

export function removePantry(pantryId) {
  const idx = state.pantries.findIndex(p => p.id === pantryId);
  if (idx === -1) return;
  const p = state.pantries[idx];
  closePantryQueues(p);
  for (const a of state.agents) {
    if (a.state === 'traveling' && a.targetPantry === p) {
      sendAway(a, 'closed');
      countUnmet(a, 'closed');
    }
  }
  state.pantries.splice(idx, 1);
  logEvent('pantry_removed', `id=${pantryId} name=${p.name}`);
  if (state.inspecting === pantryId) state.inspecting = null;
  notify();
}

export function togglePantryClosed(pantryId) {
  const p = state.pantries.find(p => p.id === pantryId);
  if (!p) return;
  p.manuallyClosed = !p.manuallyClosed;
  p.closed = p.manuallyClosed;
  p.closedReason = p.manuallyClosed ? 'manual' : null;
  if (p.closed) {
    closePantryQueues(p);
    logEvent('pantry_closed', `id=${pantryId}`);
  } else {
    logEvent('pantry_reopened', `id=${pantryId}`);
  }
  notify();
}

const WIND_LEVELS = ['calm', 'breezy', 'windy'];

// The daily weather roll (odds and the winter rule are in config/weather.yaml).
function rollWeather() {
  let r = rng.world();
  let condition = DAILY_WEATHER[0][0];
  for (const [name, probability] of DAILY_WEATHER) {
    r -= probability;
    if (r <= 0) { condition = name; break; }
  }
  const dayOfYear = ((state.clock.day - 1) % 365);
  const { winterStartsDay: from, winterEndsDay: to } = CONFIG;
  const winter = from > to ? (dayOfYear > from || dayOfYear < to) : (dayOfYear > from && dayOfYear < to);
  if (winter) {
    if (condition === 'rain' && rng.world() < CONFIG.rainBecomesSnowChance) condition = 'snow';
  } else if (condition === 'snow') {
    condition = 'rain';
  }
  state.weather.condition = condition;
  state.weather.wind = WIND_LEVELS[Math.floor(rng.world() * 3)];
}

// Everyone waiting is sent home without food and counted as having left.
function closePantryQueues(p) {
  for (const a of p.queue) {
    sendAway(a, 'closed');
    countUnmet(a, 'closed', p);
  }
  p.queue = [];
}

export function saveCurrentRun() {
  state.runs.push({
    id: state.currentRunId,
    seed: state.runSeed,
    modifiers: getActiveModifiers().map(m => m.id),
    stats: { ...state.stats, reasons: { ...state.stats.reasons } },
    samples: [...state.chart.samples],
    pantries: state.pantries.map(p => ({ id: p.id, name: p.name, ...p.stats })),
    households: getHouseholdStats(),
    events: [...state.events],
    simTime: state.simTime,
  });
}

export function initModifiers() {
  state.modifiers = MODIFIERS.map(m => ({ ...m, active: false }));
}
