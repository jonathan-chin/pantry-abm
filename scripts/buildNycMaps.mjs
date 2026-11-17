#!/usr/bin/env node
// Builds one map segment per NYC borough from OpenStreetMap data.
//
//   node scripts/buildNycMaps.mjs            # use cached OSM downloads when present
//   node scripts/buildNycMaps.mjs --refresh  # re-download from the Overpass API
//
// Raw Overpass responses are cached in scripts/osm-cache/ (not in the repository), so
// later rebuilds are offline and give the same maps.
// Output: src/data/cities/<slug>.json and src/data/cityIndex.json.
// Map data © OpenStreetMap contributors, available under the ODbL.

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, 'osm-cache');
const OUT = join(__dirname, '..', 'src', 'data', 'cities');
const INDEX_OUT = join(__dirname, '..', 'src', 'data', 'cityIndex.json');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const M_PER_UNIT = 5;      // 1 map unit = 5 meters
const CELL = 2;            // water/park raster resolution, in map units
const POOL_SIZE = 24;      // candidate pantry sites per map (slider max is 20)

// [south, west, north, east]
const BOROUGHS = [
  { slug: 'manhattan', name: 'Manhattan · Harlem', borough: 'Manhattan', wikidata: 'Q11299', bbox: [40.785, -73.980, 40.825, -73.898] },
  { slug: 'brooklyn', name: 'Brooklyn · Sunset Park & Park Slope', borough: 'Brooklyn', wikidata: 'Q18419', bbox: [40.635, -74.030, 40.672, -73.954] },
  { slug: 'bronx', name: 'Bronx · South Bronx', borough: 'Bronx', wikidata: 'Q18426', bbox: [40.800, -73.935, 40.840, -73.853] },
  { slug: 'queens', name: 'Queens · Jackson Heights & Corona', borough: 'Queens', wikidata: 'Q18424', bbox: [40.735, -73.905, 40.770, -73.834] },
  { slug: 'staten-island', name: 'Staten Island · North Shore', borough: 'Staten Island', wikidata: 'Q18432', bbox: [40.615, -74.135, 40.650, -74.064] },
];

const ROAD_RE = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street)$';

function overpassQuery([S, W, N, E]) {
  const bb = `${S},${W},${N},${E}`;
  const p = 0.02;
  const cb = `${S - p},${W - p},${N + p},${E + p}`;
  return `[out:json][timeout:180];
area["wikidata"="Q60"]->.nyc;
way["highway"~"${ROAD_RE}"](${bb})(area.nyc);
out body geom;
way["natural"="coastline"](${cb});
out body geom;
(way["natural"="water"](${bb});relation["natural"="water"](${bb});way["waterway"="riverbank"](${bb});relation["waterway"="riverbank"](${bb}););
out geom;
(way["leisure"="park"](${bb});relation["leisure"="park"](${bb});way["landuse"="cemetery"](${bb});relation["landuse"="cemetery"](${bb}););
out geom;
node["place"~"^(neighbourhood|suburb|quarter)$"](${bb});
out;`;
}

// Street ids inside the borough itself (the bbox can take in a neighboring borough).
function boroughQuery(b) {
  const [S, W, N, E] = b.bbox;
  return `[out:json][timeout:180];
area["wikidata"="${b.wikidata}"]->.b;
way["highway"~"${ROAD_RE}"](${S},${W},${N},${E})(area.b);
out ids;`;
}

async function fetchOsm(name, query, refresh) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`  downloading ${name} (attempt ${attempt})…`);
    try {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'pantry-abm-mapgen/1.0' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240000),
      });
      if (res.ok) {
        const json = await res.json();
        writeFileSync(file, JSON.stringify(json));
        return json;
      }
      console.log(`  overpass returned ${res.status}; retrying in 20s`);
    } catch (err) {
      console.log(`  request failed (${err.cause?.code || err.name}); retrying in 20s`);
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  throw new Error(`could not download ${name}`);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const r1 = v => Math.round(v * 10) / 10;

function buildMap(b, osm, boroughIds, seed) {
  const [S, W, N, E] = b.bbox;
  const lat0 = (S + N) / 2;
  const mPerLat = 111132;
  const mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const width = Math.round((E - W) * mPerLon / M_PER_UNIT);
  const height = Math.round((N - S) * mPerLat / M_PER_UNIT);
  const proj = g => [(g.lon - W) * mPerLon / M_PER_UNIT, (N - g.lat) * mPerLat / M_PER_UNIT];
  const inside = ([x, y]) => x >= 0 && x <= width && y >= 0 && y <= height;
  const rng = mulberry32(seed);

  const roads = [], coast = [], water = [], parks = [], places = [];
  for (const el of osm.elements) {
    const t = el.tags || {};
    if (el.type === 'way' && t.highway) roads.push(el);
    else if (el.type === 'way' && t.natural === 'coastline') coast.push(el);
    else if (t.natural === 'water' || t.waterway === 'riverbank') water.push(el);
    else if (t.leisure === 'park' || t.landuse === 'cemetery') parks.push(el);
    else if (el.type === 'node' && t.place) places.push(el);
  }

  // ---- Raster: 0 land, 1 water, 2 park ----
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  const grid = new Uint8Array(cols * rows);

  function featureRings(el) {
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 4) return [];
      const g = el.geometry;
      if (g[0].lat !== g[g.length - 1].lat || g[0].lon !== g[g.length - 1].lon) return [];
      return [g.map(proj)];
    }
    // relation: even-odd over every member line works for valid multipolygons
    return (el.members || []).filter(m => m.geometry && m.geometry.length > 1).map(m => m.geometry.filter(Boolean).map(proj));
  }

  function fillEvenOdd(lines, value) {
    const segs = [];
    for (const pts of lines) for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    if (!segs.length) return;
    for (let r = 0; r < rows; r++) {
      const yc = (r + 0.5) * CELL;
      const xs = [];
      for (const [a, c] of segs) {
        if ((a[1] <= yc && c[1] > yc) || (c[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + (yc - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(xs[k + 1] / CELL - 0.5));
        for (let c = c0; c <= c1; c++) grid[r * cols + c] = value;
      }
    }
  }

  for (const el of parks) fillEvenOdd(featureRings(el), 2);

  // Coastline: OSM draws coastlines with land on the left. Chain the ways, then
  // classify each cell by the side of its nearest coastline segment.
  const coastWater = classifyCoast(coast, proj, cols, rows);
  for (let i = 0; i < grid.length; i++) if (coastWater[i]) grid[i] = 1;
  for (const el of water) fillEvenOdd(featureRings(el), 1);

  const rle = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    let v = grid[r * cols], n = 0;
    for (let c = 0; c < cols; c++) {
      const g = grid[r * cols + c];
      if (g === v) n++;
      else { row.push(v, n); v = g; n = 1; }
    }
    row.push(v, n);
    rle.push(row);
  }
  const cellAt = (x, y) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
    return grid[r * cols + c];
  };

  // ---- Roads: render polylines + walking graph ----
  const render = { hw: [], art: [], loc: [] };
  const idIndex = new Map();
  const nodeNames = new Map(); // node index -> Set of street names
  const inBorough = new Set();  // node indices on streets inside this map's borough
  const nodes = [];
  const edges = [];
  const getNode = (id, p) => {
    let i = idIndex.get(id);
    if (i === undefined) { i = nodes.length; idIndex.set(id, i); nodes.push(p); }
    return i;
  };

  for (const w of roads) {
    const t = w.tags;
    const hwy = t.highway;
    if (t.area === 'yes' || !w.geometry) continue;
    const limited = hwy.startsWith('motorway') || (hwy.startsWith('trunk') && (t.motorroad === 'yes' || t.foot === 'no'));
    const cls = limited ? 'hw' : /^(primary|secondary|tertiary|trunk)/.test(hwy) ? 'art' : 'loc';
    const walkable = !limited && t.tunnel !== 'yes' && t.foot !== 'no' && t.access !== 'private' && t.access !== 'no';
    const pts = w.geometry.map(g => (g ? proj(g) : null));

    if (t.tunnel !== 'yes') {
      let run = [];
      const flush = () => { if (run.length > 1) render[cls].push(simplify(run, 0.4).flatMap(([x, y]) => [r1(x), r1(y)])); run = []; };
      for (let i = 0; i < pts.length; i++) {
        if (pts[i] && inside(pts[i])) run.push(pts[i]);
        else flush();
      }
      flush();
    }

    if (!walkable) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const pa = pts[i], pb = pts[i + 1];
      if (!pa || !pb || !inside(pa) || !inside(pb)) continue;
      const a = getNode(w.nodes[i], pa), c = getNode(w.nodes[i + 1], pb);
      if (a === c) continue;
      if (!boroughIds || boroughIds.has(w.id)) { inBorough.add(a); inBorough.add(c); }
      if (t.name) for (const n of [a, c]) { if (!nodeNames.has(n)) nodeNames.set(n, new Set()); nodeNames.get(n).add(t.name); }
      edges.push([a, c, Math.hypot(pa[0] - pb[0], pa[1] - pb[1])]);
    }
  }

  // Largest connected component only
  const parent = nodes.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const [a, c] of edges) { const ra = find(a), rc = find(c); if (ra !== rc) parent[ra] = rc; }
  const sizes = new Map();
  nodes.forEach((_, i) => { const r = find(i); sizes.set(r, (sizes.get(r) || 0) + 1); });
  const mainRoot = [...sizes.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const remap = new Int32Array(nodes.length).fill(-1);
  const outNodes = [];
  const outNames = [];
  const outInBorough = [];
  nodes.forEach((p, i) => {
    if (find(i) !== mainRoot) return;
    remap[i] = outNodes.length;
    outNodes.push([r1(p[0]), r1(p[1])]);
    outNames.push([...(nodeNames.get(i) || [])]);
    outInBorough.push(inBorough.has(i));
  });
  const seen = new Set();
  const outEdges = [];
  for (const [a, c, cost] of edges) {
    const ra = remap[a], rc = remap[c];
    if (ra < 0 || rc < 0) continue;
    const key = ra < rc ? ra * 1e6 + rc : rc * 1e6 + ra;
    if (seen.has(key)) continue;
    seen.add(key);
    outEdges.push([ra, rc, r1(cost)]);
  }

  // Homes: walkable nodes on dry, non-park land inside the borough
  const homes = [];
  outNodes.forEach(([x, y], i) => { if (outInBorough[i] && cellAt(x, y) === 0) homes.push(i); });

  // ---- Neighborhoods → labels, demand zones, pantry sites ----
  const labels = places
    .map(p => ({ name: p.tags.name, pt: proj(p) }))
    .filter(p => p.name && inside(p.pt))
    .map(p => ({ name: p.name, x: r1(p.pt[0]), y: r1(p.pt[1]) }));

  // Pantry sites sit on street corners so they can be named "A St & B Ave".
  const corners = homes.filter(i => outNames[i].length >= 2);
  const siteCandidates = corners.length > 50 ? corners : homes;
  const nearestHome = (x, y) => {
    let best = siteCandidates[0], bd = Infinity;
    for (const i of siteCandidates) {
      const d = (outNodes[i][0] - x) ** 2 + (outNodes[i][1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const nearestAny = (x, y) => {
    let best = 0, bd = Infinity;
    outNodes.forEach(([nx, ny], i) => { const d = (nx - x) ** 2 + (ny - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const ownLabels = labels.filter(l => outInBorough[nearestAny(l.x, l.y)]);

  const ZONE_R = 140;
  let zoneCenters = ownLabels.map(l => ({ x: l.x, y: l.y, name: l.name }));
  while (zoneCenters.length < 6) {
    const n = outNodes[homes[Math.floor(rng() * homes.length)]];
    zoneCenters.push({ x: n[0], y: n[1], name: null });
  }
  const zones = zoneCenters.map(z => {
    const density = homes.filter(i => (outNodes[i][0] - z.x) ** 2 + (outNodes[i][1] - z.y) ** 2 < ZONE_R * ZONE_R).length;
    return { x: z.x, y: z.y, r: ZONE_R, w: r1(Math.max(0.2, density / 40) * (0.6 + rng() * 0.8)), name: z.name };
  }).filter(z => z.w > 0);

  // Pantry sites: one per neighborhood first, then farthest-point fill
  const pool = [];
  const used = new Set();
  const MIN_GAP = 70;
  const tooClose = (x, y) => pool.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < MIN_GAP * MIN_GAP);
  const nameFor = (x, y) => {
    let best = null, bd = Infinity;
    for (const l of ownLabels) { const d = (l.x - x) ** 2 + (l.y - y) ** 2; if (d < bd) { bd = d; best = l.name; } }
    return best;
  };
  const short = n => n.replace(/\bStreet\b/, 'St').replace(/\bAvenue\b/, 'Ave').replace(/\bBoulevard\b/, 'Blvd')
    .replace(/\bPlace\b/, 'Pl').replace(/\bRoad\b/, 'Rd').replace(/\bParkway\b/, 'Pkwy').replace(/\bEast\b/, 'E')
    .replace(/\bWest\b/, 'W').replace(/\bNorth\b/, 'N').replace(/\bSouth\b/, 'S');
  const addSite = (i) => {
    const [x, y] = outNodes[i];
    const hood = nameFor(x, y) || b.borough;
    const streets = outNames[i].slice(0, 2).map(short);
    const where = streets.length === 2 ? `${streets[0]} & ${streets[1]}` : streets[0] || `Site ${pool.length + 1}`;
    pool.push({ x, y, name: `${where}`, area: hood });
    used.add(i);
  };
  for (const l of ownLabels) {
    if (pool.length >= POOL_SIZE) break;
    const i = nearestHome(l.x + (rng() - 0.5) * 30, l.y + (rng() - 0.5) * 30);
    if (!used.has(i) && !tooClose(outNodes[i][0], outNodes[i][1])) addSite(i);
  }
  const sample = siteCandidates.filter((_, k) => k % 2 === 0);
  while (pool.length < POOL_SIZE) {
    let best = -1, bd = -1;
    for (const i of sample) {
      if (used.has(i)) continue;
      const [x, y] = outNodes[i];
      let d = Infinity;
      for (const p of pool) d = Math.min(d, (p.x - x) ** 2 + (p.y - y) ** 2);
      d *= 0.7 + rng() * 0.6;
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) break;
    addSite(best);
  }
  // shuffle so the first N sites are spread out rather than all named ones
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

  return {
    name: b.name, slug: b.slug, borough: b.borough,
    attribution: '© OpenStreetMap contributors',
    osmSnapshot: osm.osm3s?.timestamp_osm_base || null, // when the OpenStreetMap data was current
    bbox: b.bbox, size: [width, height], kmPerUnit: M_PER_UNIT / 1000,
    raster: { cell: CELL, cols, rows, rle },
    roads: render,
    nodes: outNodes, edges: outEdges, homes,
    labels, zones, pantryPool: pool,
  };
}

function classifyCoast(ways, proj, cols, rows) {
  const out = new Uint8Array(cols * rows);
  if (!ways.length) return out;

  // chain ways by shared end node ids
  const byFirst = new Map();
  for (const w of ways) if (w.nodes && w.geometry) byFirst.set(w.nodes[0], w);
  const usedW = new Set();
  const chains = [];
  for (const w of ways) {
    if (usedW.has(w) || !w.geometry) continue;
    // walk back to the start of this chain
    let start = w;
    const visited = new Set([w]);
    for (;;) {
      const prev = ways.find(o => !visited.has(o) && o.nodes && o.nodes[o.nodes.length - 1] === start.nodes[0]);
      if (!prev || usedW.has(prev)) break;
      visited.add(prev);
      start = prev;
    }
    const pts = [];
    let cur = start;
    while (cur && !usedW.has(cur)) {
      usedW.add(cur);
      const g = cur.geometry.map(proj);
      if (pts.length) g.shift();
      pts.push(...g);
      cur = byFirst.get(cur.nodes[cur.nodes.length - 1]);
    }
    const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    chains.push({ pts, closed });
  }

  const segs = [];
  for (const ch of chains) {
    const n = ch.pts.length - 1;
    const base = segs.length;
    for (let i = 0; i < n; i++) {
      segs.push({
        a: ch.pts[i], b: ch.pts[i + 1],
        prev: i > 0 ? base + i - 1 : ch.closed ? base + n - 1 : -1,
        next: i < n - 1 ? base + i + 1 : ch.closed ? base : -1,
      });
    }
  }

  const B = 40;
  const buckets = new Map();
  const key = (bx, by) => bx * 100000 + by;
  segs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / B), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / B);
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / B), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / B);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
      const k = key(bx, by);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  });

  const cross = (s, p) => (s.b[0] - s.a[0]) * (p[1] - s.a[1]) - (s.b[1] - s.a[1]) * (p[0] - s.a[0]);
  const leftOf = (s, p) => cross(s, p) < 0; // screen coords (y down): land side
  const MAX_RING = 30;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = [(c + 0.5) * CELL, (r + 0.5) * CELL];
      const bx = Math.floor(p[0] / B), by = Math.floor(p[1] / B);
      let best = -1, bd = Infinity, bt = 0;
      for (let ring = 0; ring <= MAX_RING; ring++) {
        if (best >= 0 && (ring - 1) * B > Math.sqrt(bd)) break;
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const list = buckets.get(key(bx + dx, by + dy));
          if (!list) continue;
          for (const i of list) {
            const s = segs[i];
            const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1];
            const len2 = vx * vx + vy * vy || 1e-9;
            let t = ((p[0] - s.a[0]) * vx + (p[1] - s.a[1]) * vy) / len2;
            t = Math.max(0, Math.min(1, t));
            const d = (s.a[0] + t * vx - p[0]) ** 2 + (s.a[1] + t * vy - p[1]) ** 2;
            if (d < bd) { bd = d; best = i; bt = t; }
          }
        }
      }
      if (best < 0) continue;
      const s = segs[best];
      let land;
      const corner = bt <= 0 && s.prev >= 0 ? [segs[s.prev], s] : bt >= 1 && s.next >= 0 ? [s, segs[s.next]] : null;
      if (corner) {
        const [s1, s2] = corner;
        // turn in y-up terms; a left turn means the land corner is convex
        const turnScreen = (s1.b[0] - s1.a[0]) * (s2.b[1] - s2.a[1]) - (s1.b[1] - s1.a[1]) * (s2.b[0] - s2.a[0]);
        land = turnScreen < 0 ? leftOf(s1, p) && leftOf(s2, p) : leftOf(s1, p) || leftOf(s2, p);
      } else {
        land = leftOf(s, p);
      }
      if (!land) out[r * cols + c] = 1;
    }
  }
  return out;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const vx = bx - ax, vy = by - ay, len = Math.hypot(vx, vy) || 1e-9;
    let md = -1, mk = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * vy - (pts[k][1] - ay) * vx) / len;
      if (d > md) { md = d; mk = k; }
    }
    if (md > tol) { keep[mk] = 1; stack.push([i, mk], [mk, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

const refresh = process.argv.includes('--refresh');
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(join(OUT, f));

const index = [];
let seed = 20261116;
for (const b of BOROUGHS) {
  console.log(`${b.name}`);
  const osm = await fetchOsm(b.slug, overpassQuery(b.bbox), refresh);
  const idsJson = await fetchOsm(`${b.slug}-borough`, boroughQuery(b), refresh);
  let boroughIds = new Set(idsJson.elements.map(e => e.id));
  if (!boroughIds.size) { console.log('  no borough street ids found; using every street'); boroughIds = null; }
  const map = buildMap(b, osm, boroughIds, seed++);
  const file = `${b.slug}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(map));
  const waterCells = map.raster.rle.reduce((s, row) => s + row.reduce((a, v, i) => (i % 2 === 0 && v === 1 ? a + row[i + 1] : a), 0), 0);
  console.log(`  ${map.size[0]}x${map.size[1]} units, ${map.nodes.length} nodes, ${map.edges.length} edges, ${map.homes.length} homes, ` +
    `${map.labels.length} labels, ${map.pantryPool.length} sites, water ${(100 * waterCells / (map.raster.cols * map.raster.rows)).toFixed(1)}%`);
  index.push({ slug: b.slug, name: b.name, borough: b.borough, file, osmSnapshot: map.osmSnapshot });
}
writeFileSync(INDEX_OUT, JSON.stringify(index, null, 2) + '\n');
console.log('done');
