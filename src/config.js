// Reads the YAML files in config/ and converts them, once, into the units the
// engine works in. Settings live in the YAML; this file only loads and converts.
//
// The engine's own time unit is the "sim-second": one real second at 1x speed.
// The YAML uses real-world units (minutes, hours, km/h, people per hour), and every
// name there ends with its unit.
import YAML from 'yaml';
import simulationText from '../config/simulation.yaml?raw';
import agentsText from '../config/agents.yaml?raw';
import pantriesText from '../config/pantries.yaml?raw';
import weatherText from '../config/weather.yaml?raw';
import modifiersText from '../config/modifiers.yaml?raw';
import displayText from '../config/display.yaml?raw';
import { randomSeed } from './utils/rng.js';

export const CONFIG_FILES = [
  { id: 'simulation', file: 'simulation.yaml', text: simulationText },
  { id: 'agents', file: 'agents.yaml', text: agentsText },
  { id: 'pantries', file: 'pantries.yaml', text: pantriesText },
  { id: 'weather', file: 'weather.yaml', text: weatherText },
  { id: 'modifiers', file: 'modifiers.yaml', text: modifiersText },
  { id: 'display', file: 'display.yaml', text: displayText },
];

const docs = {};
for (const f of CONFIG_FILES) {
  try {
    docs[f.id] = YAML.parse(f.text) || {};
  } catch (err) {
    throw new Error(`config/${f.file}: ${err.message}`);
  }
}

// ---- Getters that fail with a message naming the file and the setting ----
export function setting(id, path) {
  let v = docs[id];
  for (const k of path.split('.')) v = v == null ? undefined : v[k];
  if (v === undefined) throw new Error(`config/${id}.yaml: "${path}" is missing`);
  return v;
}

export function settingNumber(id, path, { min = -Infinity, max = Infinity } = {}) {
  const v = setting(id, path);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`config/${id}.yaml: "${path}" must be a number (got ${JSON.stringify(v)})`);
  if (v < min || v > max) throw new Error(`config/${id}.yaml: "${path}" must be between ${min} and ${max} (got ${v})`);
  return v;
}

export function settingRange(id, path, opts) {
  const v = setting(id, path);
  if (!Array.isArray(v) || v.length !== 2 || v.some(x => typeof x !== 'number') || v[0] > v[1]) {
    throw new Error(`config/${id}.yaml: "${path}" must be [low, high] (got ${JSON.stringify(v)})`);
  }
  if (opts?.min !== undefined && v[0] < opts.min) throw new Error(`config/${id}.yaml: "${path}" must not go below ${opts.min}`);
  return v;
}

export function settingBool(id, path) {
  const v = setting(id, path);
  if (typeof v !== 'boolean') throw new Error(`config/${id}.yaml: "${path}" must be true or false (got ${JSON.stringify(v)})`);
  return v;
}

// ---- Unit conversion ----
export const METERS_PER_MAP_UNIT = 5;
const MIN_PER_SIM_SECOND = settingNumber('simulation', 'clock.sim_minutes_per_real_second_at_1x', { min: 0.01 });

export const minutesToSimSeconds = minutes => minutes / MIN_PER_SIM_SECOND;
export const simSecondsToMinutes = simSeconds => simSeconds * MIN_PER_SIM_SECOND;
export const perMinuteToPerSimSecond = rate => rate * MIN_PER_SIM_SECOND;
export const perHourToPerSimSecond = rate => (rate / 60) * MIN_PER_SIM_SECOND;

const S = 'simulation', A = 'agents', P = 'pantries', W = 'weather', D = 'display';
const hour = (id, path) => settingNumber(id, path, { min: 0, max: 24 });
const prob = (id, path) => settingNumber(id, path, { min: 0, max: 1 });

// The seed a fresh load starts from: the word "random" for a new one each time, or a whole number.
function startingSeed(id, path) {
  if (setting(id, path) === 'random') return randomSeed();
  return settingNumber(id, path, { min: 0 });
}

const strandedWait = settingRange(A, 'patience.stranded_wait_minutes', { min: 0 });
const restockInterval = settingRange(P, 'restock.interval_minutes', { min: 0.01 });
const restockAmount = settingRange(P, 'restock.amount_packages', { min: 0 });
const restockHeadStart = settingRange(P, 'restock.first_delivery_head_start_minutes', { min: 0 });

// Values below are in engine units: sim-seconds for time, km for distance,
// map units for positions. The comment on each line names the YAML setting.
export const CONFIG = {
  minutesPerSimSecond: MIN_PER_SIM_SECOND,

  // simulation.yaml
  startHour: hour(S, 'clock.start_hour_24h'),
  startWeekday: settingNumber(S, 'clock.start_weekday_1_to_7', { min: 1, max: 7 }),
  nightResumeHour: hour(S, 'clock.day_starts_hour_24h'),
  nightSkipHour: hour(S, 'clock.day_ends_hour_24h'),
  initialSpeed: settingNumber(S, 'speed.initial_multiplier', { min: 0.01 }),
  minSpeed: settingNumber(S, 'speed.min_multiplier', { min: 0.01 }),
  maxSpeed: settingNumber(S, 'speed.max_multiplier', { min: 0.01 }),
  simStep: minutesToSimSeconds(settingNumber(S, 'stepping.step_minutes', { min: 0.001 })),
  maxStepsPerFrame: settingNumber(S, 'stepping.max_steps_per_frame', { min: 1 }),
  initialSeed: startingSeed(S, 'randomness.initial_seed'),
  chartSampleInterval: minutesToSimSeconds(settingNumber(S, 'charts.sample_interval_minutes', { min: 0.01 })),
  chartMaxSamples: settingNumber(S, 'charts.max_samples', { min: 10 }),
  defaultWindowHours: setting(S, 'charts.default_window_hours'),

  // agents.yaml
  initialHouseholdCount: settingNumber(A, 'households.count', { min: 1 }),
  needIntervalMean: settingNumber(A, 'households.need_interval_days.mean', { min: 0.1 }),
  needIntervalSd: settingNumber(A, 'households.need_interval_days.sd', { min: 0 }),
  minNeedInterval: settingNumber(A, 'households.min_need_interval_days', { min: 0.1 }),
  needIntervalVariation: settingNumber(A, 'households.need_interval_variation_share', { min: 0, max: 0.9 }),
  usualTimeJitterMinutes: settingNumber(A, 'households.usual_time_jitter_minutes', { min: 0 }),
  flexibleShare: prob(A, 'households.flexible_schedule_share'),
  avoidAfterFailureDays: settingNumber(A, 'households.avoid_after_failure_days', { min: 0 }),
  givesUpAfterDays: settingNumber(A, 'households.gives_up_after_days_waiting', { min: 1 }),
  retireProbabilityPerDay: prob(A, 'households.retire_probability_per_day'),
  newHouseholdsPerDay: settingNumber(A, 'households.new_households_per_day', { min: 0 }),
  spawnScatterChance: prob(A, 'households.lives_outside_demand_zones_share'),
  spawnStartHour: hour(A, 'need.start_hour_24h'),
  spawnEndHour: hour(A, 'need.end_hour_24h'),
  weekdaySpawnMultiplier: settingNumber(A, 'need.weekday_multiplier', { min: 0 }),
  weekendSpawnMultiplier: settingNumber(A, 'need.weekend_multiplier', { min: 0 }),
  travelSpeed: perHourToPerSimSecond(settingNumber(A, 'movement.walking_speed_km_per_hour', { min: 0.1 })), // km per sim-second
  maxWalkKm: settingNumber(A, 'movement.max_walk_km', { min: 0 }),
  minTripTime: minutesToSimSeconds(settingNumber(A, 'movement.min_trip_minutes', { min: 0 })),
  maxQueueWait: minutesToSimSeconds(settingNumber(A, 'patience.max_wait_in_line_minutes', { min: 0 })),
  queueLeaveChance: perMinuteToPerSimSecond(prob(A, 'patience.give_up_probability_per_minute')),
  strandedWaitMin: minutesToSimSeconds(strandedWait[0]),
  strandedWaitMax: minutesToSimSeconds(strandedWait[1]),
  wellbeingDecayTravel: perMinuteToPerSimSecond(settingNumber(A, 'wellbeing.loss_per_minute_walking', { min: 0 })),
  wellbeingDecayQueue: perMinuteToPerSimSecond(settingNumber(A, 'wellbeing.loss_per_minute_in_line', { min: 0 })),
  wellbeingStrandedMultiplier: settingNumber(A, 'wellbeing.stranded_loss_multiplier', { min: 0 }),
  choice: {
    habitNearestCount: settingNumber(A, 'choice.habit.picks_among_nearest_count', { min: 1 }),
    weigherNearestCount: settingNumber(A, 'choice.line_weigher.considers_nearest_count', { min: 1 }),
    weigherDistancePenaltyPerKm: settingNumber(A, 'choice.line_weigher.distance_penalty_per_km', { min: 0 }),
    weigherLinePenaltyPerPerson: settingNumber(A, 'choice.line_weigher.line_penalty_per_person', { min: 0 }),
    balanceRedirectBelowStockShare: prob(A, 'choice.load_balancing.redirect_when_stock_share_below'),
    balanceDistancePenaltyPerKm: settingNumber(A, 'choice.load_balancing.distance_penalty_per_km', { min: 0 }),
    balanceLinePenaltyPerPerson: settingNumber(A, 'choice.load_balancing.line_penalty_per_person', { min: 0 }),
    balanceNoiseRange: settingRange(A, 'choice.load_balancing.noise_multiplier_range', { min: 0 }),
  },

  // pantries.yaml
  initialPantryCount: settingNumber(P, 'count', { min: 1 }),
  initialCapacity: settingNumber(P, 'capacity_packages', { min: 1 }),
  initialVariance: settingNumber(P, 'capacity_variance_percent', { min: 0, max: 100 }),
  minCapacity: settingNumber(P, 'min_capacity_packages', { min: 1 }),
  initialServiceRatePerHour: settingNumber(P, 'service_rate_people_per_hour', { min: 0.1 }),
  defaultOpenHour: hour(P, 'hours.open_hour_24h'),
  defaultCloseHour: hour(P, 'hours.close_hour_24h'),
  hoursJitter: settingNumber(P, 'hours.jitter_hours', { min: 0 }),
  startsFullEachDay: settingBool(P, 'restock.starts_full_each_day'),
  restockMinInterval: minutesToSimSeconds(restockInterval[0]),
  restockMaxInterval: minutesToSimSeconds(restockInterval[1]),
  restockMinAmt: restockAmount[0],
  restockMaxAmt: restockAmount[1],
  restockHeadStartMin: minutesToSimSeconds(restockHeadStart[0]),
  restockHeadStartMax: minutesToSimSeconds(restockHeadStart[1]),
  // a simulated day is the active hours between day_starts and day_ends
  shockDuration: minutesToSimSeconds(settingNumber(P, 'shock.duration_days', { min: 0.01 })
    * (hour(S, 'clock.day_ends_hour_24h') - hour(S, 'clock.day_starts_hour_24h')) * 60),
  shockNewHouseholds: settingNumber(P, 'shock.new_households_at_start_count', { min: 0 }),
  shockSeverity: settingNumber(P, 'shock.need_multiplier_at_start', { min: 0 }),
  initialShockVariance: settingNumber(P, 'shock.variance_percent', { min: 0, max: 100 }),

  // weather.yaml (the per-condition effects are read in src/data/weather.js)
  multiplierLimits: settingRange(W, 'per_person_multiplier_limits', { min: 0 }),
  winterStartsDay: settingNumber(W, 'winter.starts_day_of_year', { min: 0, max: 366 }),
  winterEndsDay: settingNumber(W, 'winter.ends_day_of_year', { min: 0, max: 366 }),
  rainBecomesSnowChance: prob(W, 'winter.rain_becomes_snow_probability'),

  // display.yaml (times are sim-seconds, which is what "seconds at 1x" means)
  agentRadius: settingNumber(D, 'agents.radius_px', { min: 0.5 }),
  agentRingWidth: settingNumber(D, 'agents.ring_width_px', { min: 0 }),
  agentOpacity: prob(D, 'agents.opacity_0_to_1'),
  lingerTime: settingNumber(D, 'agents.served_linger_seconds_at_1x', { min: 0 }),
  fadeTime: settingNumber(D, 'agents.served_fade_seconds_at_1x', { min: 0.01 }),
  walkAwayTime: settingNumber(D, 'agents.walk_away_seconds_at_1x', { min: 0.01 }),
  strandedFadeTime: settingNumber(D, 'agents.stay_home_fade_seconds_at_1x', { min: 0.01 }),
  waggleAmplitude: settingNumber(D, 'agents.waggle_amplitude_map_units', { min: 0 }),
  waggleSpeed: settingNumber(D, 'agents.waggle_speed_radians_per_second_at_1x', { min: 0 }),
  pantryShakeDuration: settingNumber(D, 'pantries.shake_seconds_at_1x', { min: 0.01 }),
  pantryShakeDecay: settingNumber(D, 'pantries.shake_cycles_per_second_at_1x', { min: 0 }),
  eventMarkerWidth: settingNumber(D, 'charts.event_marker_width_px', { min: 0.5 }),
  routineEventGroupGap: minutesToSimSeconds(settingNumber(D, 'charts.routine_event_group_gap_minutes', { min: 0 })),
  heatmapCell: settingNumber(D, 'heatmap.cell_meters', { min: METERS_PER_MAP_UNIT }) / METERS_PER_MAP_UNIT, // map units
  heatmapBlurCells: settingNumber(D, 'heatmap.blur_meters', { min: 1 }) / settingNumber(D, 'heatmap.cell_meters', { min: METERS_PER_MAP_UNIT }),
  heatmapOpacity: prob(D, 'heatmap.opacity_0_to_1'),
};
