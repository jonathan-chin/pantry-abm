// Seeded random numbers. Same seed and same settings give the same run.
//
// There are three independent streams, so two scenarios run with the same seed
// share the same world and the same people, and differ only in what they change:
//   world     which pantry sites, their sizes and hours, restocks, daily weather
//   arrivals  where each new agent starts and which profile they have
//   behavior  the choices agents make along the way
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function mix(seed, salt) {
  let h = (seed ^ Math.imul(salt, 0x9E3779B9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const rng = {
  world: mulberry32(mix(1, 1)),
  arrivals: mulberry32(mix(1, 2)),
  behavior: mulberry32(mix(1, 3)),
};

export function seedRng(seed) {
  const s = normalizeSeed(seed);
  rng.world = mulberry32(mix(s, 1));
  rng.arrivals = mulberry32(mix(s, 2));
  rng.behavior = mulberry32(mix(s, 3));
  return s;
}

export function normalizeSeed(seed) {
  const n = Math.floor(Number(seed));
  return Number.isFinite(n) ? Math.abs(n) % 4294967296 : 1;
}

// A seed for one household's own random stream, derived from the run's seed.
export function streamSeed(seed, salt) {
  return mix(normalizeSeed(seed), salt) | 0;
}

// A fresh seed, for the "New" button and for each load of the tool (not part of any run,
// so plain Math.random is fine).
export function randomSeed() {
  return 1 + Math.floor(Math.random() * 999999);
}
