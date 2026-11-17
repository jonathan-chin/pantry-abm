// The modifier toggles, read from config/modifiers.yaml.
//   replacement  swaps the routing rule (only one active at a time)
//   additive     stacks on top of whatever else is on; may carry a need multiplier
//   weather      forces the day's weather (only one active at a time)
import { setting } from '../config.js';
import { WEATHER_EFFECTS } from './weather.js';

const TYPES = ['replacement', 'additive', 'weather'];

function readModifier(m, i) {
  const where = `config/modifiers.yaml: modifiers[${i}]`;
  for (const key of ['id', 'label', 'type', 'color']) {
    if (typeof m?.[key] !== 'string') throw new Error(`${where}: "${key}" must be text`);
  }
  if (!TYPES.includes(m.type)) throw new Error(`${where}: type must be one of ${TYPES.join(', ')}`);
  if (m.type === 'weather' && !WEATHER_EFFECTS[m.weather]) {
    throw new Error(`${where}: weather "${m.weather}" has no entry under effects in config/weather.yaml`);
  }
  if (m.need_multiplier !== undefined && typeof m.need_multiplier !== 'number') {
    throw new Error(`${where}: "need_multiplier" must be a number`);
  }
  return {
    id: m.id, label: m.label, type: m.type, color: m.color,
    description: m.description || '',
    weather: m.weather,
    needMultiplier: m.need_multiplier ?? 1,
  };
}

const list = setting('modifiers', 'modifiers');
if (!Array.isArray(list)) throw new Error('config/modifiers.yaml: "modifiers" must be a list');

export const MODIFIERS = list.map(readModifier);

export const MODIFIER_GROUPS = [
  { title: 'Routing', types: ['replacement'] },
  { title: 'Demand', types: ['additive'] },
  { title: 'Weather', types: ['weather'] },
];

const BY_ID = Object.fromEntries(MODIFIERS.map(m => [m.id, m]));
export function modifierColor(id) { return BY_ID[id]?.color || '#94a3b8'; }
export function modifierLabel(id) { return BY_ID[id]?.label || id; }
