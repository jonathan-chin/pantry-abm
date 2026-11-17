export function buildAdjacency(nodes, edges) {
  const adj = nodes.map(() => []);
  for (const [a, b, cost] of edges) {
    adj[a].push({ to: b, cost });
    adj[b].push({ to: a, cost });
  }
  return adj;
}

export function findNearestNode(nodes, x, y) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i][0] - x, dy = nodes[i][1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function aStar(nodes, adj, startIdx, endIdx) {
  if (startIdx === endIdx) return [nodes[startIdx]];

  const n = nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(nodes, startIdx, endIdx);

  const open = new MinHeap();
  open.push(startIdx, fScore[startIdx]);

  while (open.size > 0) {
    const current = open.pop();
    if (current === endIdx) return reconstructPath(nodes, cameFrom, endIdx);
    if (closed[current]) continue;
    closed[current] = 1;

    for (const { to, cost } of adj[current]) {
      if (closed[to]) continue;
      const g = gScore[current] + cost;
      if (g < gScore[to]) {
        cameFrom[to] = current;
        gScore[to] = g;
        fScore[to] = g + heuristic(nodes, to, endIdx);
        open.push(to, fScore[to]);
      }
    }
  }

  return [nodes[startIdx], nodes[endIdx]];
}

function heuristic(nodes, a, b) {
  const dx = nodes[a][0] - nodes[b][0], dy = nodes[a][1] - nodes[b][1];
  return Math.sqrt(dx * dx + dy * dy);
}

function reconstructPath(nodes, cameFrom, end) {
  const path = [];
  let c = end;
  while (c !== -1) {
    path.push(nodes[c]);
    c = cameFrom[c];
  }
  path.reverse();
  return path;
}

export function pathPosition(path, segLengths, totalLen, t) {
  const d = t * totalLen;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (acc + segLengths[i] >= d || i === segLengths.length - 1) {
      const frac = segLengths[i] > 0 ? (d - acc) / segLengths[i] : 0;
      const f = Math.max(0, Math.min(1, frac));
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * f,
        path[i][1] + (path[i + 1][1] - path[i][1]) * f,
      ];
    }
    acc += segLengths[i];
  }
  return path[path.length - 1];
}

export function computeSegLengths(path) {
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1];
    segs.push(Math.sqrt(dx * dx + dy * dy));
  }
  return segs;
}

class MinHeap {
  constructor() { this.data = []; }
  get size() { return this.data.length; }
  push(val, pri) {
    this.data.push({ val, pri });
    this._up(this.data.length - 1);
  }
  pop() {
    const top = this.data[0].val;
    const last = this.data.pop();
    if (this.data.length > 0) { this.data[0] = last; this._down(0); }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].pri <= this.data[i].pri) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  _down(i) {
    const n = this.data.length;
    while (true) {
      let s = i, l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].pri < this.data[s].pri) s = l;
      if (r < n && this.data[r].pri < this.data[s].pri) s = r;
      if (s === i) break;
      [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
      i = s;
    }
  }
}
