import { buildAdjacency } from '../utils/pathfinding.js';
import { setActiveCity } from '../utils/geo.js';
import cityIndex from './cityIndex.json';

let currentCity = null;
let adjacency = null;

const cityCache = new Map();

export function getCityIndex() {
  return cityIndex;
}

export function getCity() {
  return currentCity;
}

export function getAdjacency() {
  return adjacency;
}

export async function loadCity(slug) {
  if (cityCache.has(slug)) {
    currentCity = cityCache.get(slug);
  } else {
    const mod = await import(`./cities/${slug}.json`);
    currentCity = mod.default;
    cityCache.set(slug, currentCity);
  }
  adjacency = buildAdjacency(currentCity.nodes, currentCity.edges);
  setActiveCity(currentCity);
  return currentCity;
}

export async function loadDefaultCity() {
  if (cityIndex.length > 0) {
    return loadCity(cityIndex[0].slug);
  }
  return null;
}
