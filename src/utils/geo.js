import { CONFIG } from '../config.js';
import { rng } from './rng.js';

let _city = null;
let _zoneHomes = [];
let _zoneWeights = [];

export function setActiveCity(city) {
  _city = city;
  _zoneHomes = [];
  _zoneWeights = [];
  if (!city) return;
  for (const z of city.zones || []) {
    const r2 = z.r * z.r;
    const list = city.homes.filter(i => {
      const [x, y] = city.nodes[i];
      return (x - z.x) ** 2 + (y - z.y) ** 2 <= r2;
    });
    if (list.length) {
      _zoneHomes.push(list);
      _zoneWeights.push(z.w);
    }
  }
}

// Straight-line distance in km between two map points.
export function distanceKm(a, b) {
  const k = _city?.kmPerUnit ?? 0.005;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * k;
}

// A starting point for a new agent: usually inside a demand zone, sometimes
// (spawnScatterChance) anywhere with a street on dry land.
export function randomHome() {
  if (!_city || !_city.homes?.length) return { pos: [400, 400], node: null };
  let list = _city.homes;
  if (_zoneHomes.length && rng.arrivals() >= CONFIG.spawnScatterChance) {
    const total = _zoneWeights.reduce((s, w) => s + w, 0);
    let r = rng.arrivals() * total;
    let zi = 0;
    for (; zi < _zoneWeights.length - 1; zi++) {
      r -= _zoneWeights[zi];
      if (r <= 0) break;
    }
    list = _zoneHomes[zi];
  }
  const node = list[Math.floor(rng.arrivals() * list.length)];
  const [x, y] = _city.nodes[node];
  return { pos: [x + (rng.arrivals() - 0.5) * 6, y + (rng.arrivals() - 0.5) * 6], node };
}
