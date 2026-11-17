// Households are the people in the model. Each has a home, a behavior profile,
// a need for food that comes due every so often, a usual time of day to go out,
// and a memory of how recent trips went. Settings are in config/agents.yaml.
import { CONFIG } from '../config.js';
import { pickProfile } from '../data/profiles.js';
import { randomHome } from '../utils/geo.js';
import { rng, streamSeed } from '../utils/rng.js';

export const NEED_START_MIN = CONFIG.spawnStartHour * 60;
export const NEED_END_MIN = CONFIG.spawnEndHour * 60;

// Every household has two small random streams of its own, so what happens to one
// household doesn't shift the random numbers of another:
//   rngChoice  its day-to-day draws (when it sets out, whether weather keeps it home)
//   rngLife    whether it retires; this one never depends on the scenario
function next(h, key) {
  const a = (h[key] = (h[key] + 0x6D2B79F5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const hrand = h => next(h, 'rngChoice');
export const lifeRand = h => next(h, 'rngLife');

// A new time of day to set out, anywhere in the need window.
export function randomUsualMinute(h) {
  return NEED_START_MIN + hrand(h) * (NEED_END_MIN - NEED_START_MIN);
}

// Draws come from the "arrivals" stream in a fixed order, so the same seed gives
// the same population whatever the scenario.
export function createHousehold(id, runSeed) {
  const { pos, node } = randomHome();
  const profile = pickProfile();
  const u = 1 - rng.arrivals(), v = rng.arrivals();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const intervalDays = Math.max(CONFIG.minNeedInterval, CONFIG.needIntervalMean + z * CONFIG.needIntervalSd);
  const usualMinute = NEED_START_MIN + rng.arrivals() * (NEED_END_MIN - NEED_START_MIN);
  const flexible = rng.arrivals() < CONFIG.flexibleShare;
  return {
    id, home: pos, node, profile,
    intervalDays,          // days between needs
    usualMinute,           // minute of the day they usually set out
    flexible,              // picks a new time after finding pantries closed
    rngChoice: streamSeed(runSeed, id * 2 + 11),
    rngLife: streamSeed(runSeed, id * 2 + 12),
    active: true,          // false once retired or given up
    inNeed: false,         // has a need that hasn't been met yet
    dueAt: 0,              // need-clock value at which the next need comes due
    daysWaiting: 0,        // days in a row without food for the current need
    timesServed: 0,
    timesUnmet: 0,
    lastGood: null,        // id of the pantry where they last got food
    avoid: new Map(),      // pantry id -> day until which they stay away
    routes: new Map(),     // pantry id -> walking route from home
  };
}
