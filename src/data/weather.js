// Weather effects and the daily weather roll, read from config/weather.yaml.
// The effects apply to the daily rolled weather and to weather forced by a modifier.
import { setting } from '../config.js';

function readEffect(name, e) {
  const where = `config/weather.yaml: effects.${name}`;
  const num = key => {
    if (typeof e?.[key] !== 'number') throw new Error(`${where}: "${key}" must be a number`);
    return e[key];
  };
  const meanSd = key => {
    const v = e?.[key];
    if (typeof v?.mean !== 'number' || typeof v?.sd !== 'number') throw new Error(`${where}: "${key}" must be { mean, sd }`);
    return [v.mean, v.sd];
  };
  return {
    demand: num('goes_out_probability'),       // share of people in need who still set out
    travel: meanSd('travel_range_multiplier'), // [mean, sd], drawn per person
    patience: meanSd('patience_multiplier'),   // [mean, sd], drawn per person
    speed: num('walking_speed_multiplier'),
  };
}

const effects = setting('weather', 'effects');
export const WEATHER_EFFECTS = Object.fromEntries(Object.entries(effects).map(([name, e]) => [name, readEffect(name, e)]));
if (!WEATHER_EFFECTS.clear) throw new Error('config/weather.yaml: effects must include "clear"');

// [condition, probability] pairs for the daily roll
const odds = setting('weather', 'daily_probability');
export const DAILY_WEATHER = Object.entries(odds);
const total = DAILY_WEATHER.reduce((s, [, p]) => s + p, 0);
if (Math.abs(total - 1) > 0.001) throw new Error(`config/weather.yaml: daily_probability must add up to 1 (adds up to ${total})`);
for (const [name] of DAILY_WEATHER) {
  if (!WEATHER_EFFECTS[name]) throw new Error(`config/weather.yaml: daily_probability names "${name}", which has no entry under effects`);
}

export const WEATHER_LABELS = {
  clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy',
  rain: 'Rain', snow: 'Snow', heat: 'Heat wave', wind: 'High wind',
};
