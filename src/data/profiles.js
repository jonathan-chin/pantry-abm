// Behavior profiles, read from config/agents.yaml.
import { setting } from '../config.js';
import { rng } from '../utils/rng.js';

const NO_LIMIT_KM = 99;

function readProfile(p, i) {
  const where = `config/agents.yaml: profiles[${i}]`;
  const need = (key, type) => {
    if (typeof p[key] !== type) throw new Error(`${where}: "${key}" must be a ${type} (got ${JSON.stringify(p[key])})`);
    return p[key];
  };
  const maxKm = p.max_trip_km;
  if (maxKm !== null && typeof maxKm !== 'number') throw new Error(`${where}: "max_trip_km" must be a number or null`);
  return {
    id: need('id', 'string'),
    w: need('share_weight', 'number'),
    knowsClosed: need('knows_opening_hours', 'boolean'),
    maxKm: maxKm === null ? NO_LIMIT_KM : maxKm, // 99 means "no limit of their own"
    queues: need('weighs_lines', 'boolean'),
    habit: need('picks_from_habit', 'boolean'),
    comply: need('follows_redirection_probability', 'number'),
  };
}

const list = setting('agents', 'profiles');
if (!Array.isArray(list) || !list.length) throw new Error('config/agents.yaml: "profiles" must be a list with at least one profile');

export const PROFILES = list.map(readProfile);

export function pickProfile() {
  const totalW = PROFILES.reduce((s, p) => s + p.w, 0);
  let r = rng.arrivals() * totalW;
  for (const p of PROFILES) {
    r -= p.w;
    if (r <= 0) return p;
  }
  return PROFILES[0];
}
