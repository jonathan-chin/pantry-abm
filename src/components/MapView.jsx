import { useEffect, useRef } from 'react';
import { CONFIG } from '../config.js';
import { state, notify, addPantryAt, removePantry, togglePantryClosed, getEffectiveWeather } from '../simulation/engine.js';
import { getCity } from '../data/cityStore.js';
import { wellbeingColor } from '../utils/colors.js';

const MAP_COLORS = {
  bg: '#0b1120',
  land: '#111a2d',
  water: [14, 42, 74],
  park: [18, 48, 33],
  local: '#26354d',
  arterial: '#3a4d68',
  highway: '#8b6b3d',
  label: 'rgba(148,163,184,0.5)',
};

const rasterCache = new WeakMap();

export default function MapView() {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const viewRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false); // the click that ends a drag is not a click
  const bgRef = useRef(null);
  const lastCityRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const heatRef = useRef({ heat: null, version: -1, at: 0, canvas: null });
  const weatherRef = useRef({ cond: null, particles: [], w: 0, h: 0 });
  const lastFrameRef = useRef(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(r.width), h = Math.floor(r.height);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      sizeRef.current = { w, h, dpr };
      bgRef.current = null;
    }
    resize();
    window.addEventListener('resize', resize);
    // the map background is cached; rebuild it once the fonts are ready so labels use them
    document.fonts?.ready.then(() => { bgRef.current = null; });

    function frame() {
      render(canvas);
      frameRef.current = requestAnimationFrame(frame);
    }
    frameRef.current = requestAnimationFrame(frame);

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('click', onClick);
    };
  }, []);

  function toWorld(cx, cy) {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    return [
      (cx - w / 2) / v.scale + v.ox,
      (cy - h / 2) / v.scale + v.oy,
    ];
  }

  function onWheel(e) {
    e.preventDefault();
    const v = viewRef.current;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    v.scale = Math.max(0.3, Math.min(6, v.scale * factor));
    bgRef.current = null;
  }

  function onPointerDown(e) {
    suppressClickRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
    const v = viewRef.current;
    v.ox -= dx / v.scale;
    v.oy -= dy / v.scale;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    bgRef.current = null;
  }

  function onPointerUp() {
    // pointerup fires before click, so remember whether this press was a drag
    suppressClickRef.current = !!dragRef.current?.moved;
    dragRef.current = null;
  }

  function nearestPantry(wx, wy) {
    let closest = null, closestD = Infinity;
    for (const p of state.pantries) {
      const d = (p.lat - wx) ** 2 + (p.lng - wy) ** 2;
      if (d < closestD) { closestD = d; closest = p; }
    }
    return closest && closestD < 400 ? closest : null;
  }

  function onClick(e) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (state.addingPantry) {
      // Snap to the nearest street corner on dry land
      const city = getCity();
      if (city) {
        let best = -1, bestD = Infinity;
        for (const i of city.homes) {
          const [nx, ny] = city.nodes[i];
          const d = (nx - wx) ** 2 + (ny - wy) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0 && bestD < 1600) {
          addPantryAt(city.nodes[best][0], city.nodes[best][1], state.params.capacity);
        }
      }
      state.addingPantry = false;
      notify();
      return;
    }

    if (state.removingPantry) {
      const p = nearestPantry(wx, wy);
      if (p) removePantry(p.id);
      state.removingPantry = false;
      notify();
      return;
    }

    if (state.closingPantry) {
      const p = nearestPantry(wx, wy);
      if (p) togglePantryClosed(p.id);
      return;
    }

    const p = nearestPantry(wx, wy);
    if (p) {
      state.inspecting = state.inspecting === p.id ? null : p.id;
      notify();
    }
  }

  function render(canvas) {
    const { w, h, dpr } = sizeRef.current;
    if (!w) return;
    const ctx = canvas.getContext('2d');
    const v = viewRef.current;
    const city = getCity();
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
    lastFrameRef.current = now;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!city) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading map…', w / 2, h / 2);
      return;
    }

    // Fit city on first load
    if (lastCityRef.current !== city) {
      lastCityRef.current = city;
      const [cw, ch] = city.size;
      v.ox = cw / 2;
      v.oy = ch / 2;
      v.scale = Math.min(w / (cw + 40), h / (ch + 40));
      bgRef.current = null;
    }

    if (!bgRef.current) bgRef.current = buildBg(city, w, h, v, dpr);
    ctx.drawImage(bgRef.current, 0, 0, w, h);

    // Dynamic layer
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.ox, -v.oy);

    if (state.layers.heatmap) drawHeatmap(ctx);
    drawAgents(ctx, v.scale);
    drawPantries(ctx, v.scale); // on top, so a pantry's stock number is never covered

    ctx.restore();

    drawWeather(ctx, w, h, state.running ? dt : 0);
  }

  function buildBg(city, w, h, v, dpr) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * dpr));
    off.height = Math.max(1, Math.round(h * dpr));
    const ctx = off.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(w / 2, h / 2);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.ox, -v.oy);

    const [cw, ch] = city.size;
    ctx.fillStyle = MAP_COLORS.land;
    ctx.fillRect(0, 0, cw, ch);

    const raster = getRaster(city);
    if (raster) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const rw = raster.cols * raster.cell, rh = raster.rows * raster.cell;
      ctx.drawImage(raster.park, 0, 0, rw, rh);
      ctx.drawImage(raster.water, 0, 0, rw, rh);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const minW = 0.8 / v.scale;
    strokeRoads(ctx, city.roads?.loc, MAP_COLORS.local, Math.max(2.2, minW));
    strokeRoads(ctx, city.roads?.art, MAP_COLORS.arterial, Math.max(3.6, minW * 1.4));
    strokeRoads(ctx, city.roads?.hw, MAP_COLORS.highway, Math.max(5, minW * 2));

    if (city.labels) {
      const size = 10.5 / v.scale;
      ctx.font = `600 ${size}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = MAP_COLORS.label;
      for (const l of city.labels) ctx.fillText(l.name.toUpperCase(), l.x, l.y);
    }

    // Map edge
    ctx.strokeStyle = 'rgba(100,116,139,0.35)';
    ctx.lineWidth = 1 / v.scale;
    ctx.strokeRect(0, 0, cw, ch);
    return off;
  }

  function drawHeatmap(ctx) {
    const heat = state.heat;
    if (!heat) return;
    const hr = heatRef.current;
    const now = performance.now();
    if (hr.heat !== heat || (hr.version !== heat.version && now - hr.at > 400)) {
      hr.canvas = buildHeatCanvas(heat);
      hr.heat = heat;
      hr.version = heat.version;
      hr.at = now;
    }
    ctx.save();
    ctx.globalAlpha = CONFIG.heatmapOpacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hr.canvas, 0, 0, heat.cols * heat.cell, heat.rows * heat.cell);
    ctx.restore();
  }

  // Pantry markers: a light disk when open, slate when closed, stock as a ring on the rim.
  function drawPantries(ctx, scale) {
    const iconR = pantryRadius(scale);
    for (const p of state.pantries) {
      const x = p.lat, y = p.lng;
      const ratio = p.capacity > 0 ? Math.max(0, p.stock) / p.capacity : 0;

      let shakeX = 0;
      if (p.shake > 0) {
        const amp = 3 * (p.shake / CONFIG.pantryShakeDuration) / scale;
        shakeX = Math.sin(p.shake * CONFIG.pantryShakeDecay * Math.PI * 2) * amp;
      }

      const px = x + shakeX;

      const open = !p.closed;
      const empty = open && p.stock < 1;

      // dark halo, then the disk: light when open, slate when closed
      ctx.beginPath();
      ctx.arc(px, y, iconR + 3 / scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2,6,23,0.6)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, y, iconR, 0, Math.PI * 2);
      ctx.fillStyle = open ? '#f8fafc' : '#334155';
      ctx.fill();

      // stock ring on the rim
      const ringW = 3.5 / scale, ringR = iconR - ringW / 2 - 0.5 / scale;
      ctx.lineWidth = ringW;
      ctx.beginPath();
      ctx.arc(px, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = !open ? 'rgba(148,163,184,0.35)' : empty ? 'rgba(220,38,38,0.4)' : 'rgba(15,23,42,0.14)';
      ctx.stroke();
      if (open && ratio > 0) {
        ctx.beginPath();
        ctx.arc(px, y, ringR, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.strokeStyle = ratio > 0.5 ? '#16a34a' : ratio > 0.2 ? '#d97706' : '#dc2626';
        ctx.stroke();
      }

      if (p.closed && p.closedReason === 'hours') {
        drawMoon(ctx, px, y, iconR * 0.46);
      } else {
        const label = p.closed ? 'X' : Math.max(0, Math.floor(p.stock)).toString();
        ctx.fillStyle = p.closed ? '#e2e8f0' : empty ? '#dc2626' : '#0f172a';
        ctx.font = `bold ${Math.round(iconR * 0.78)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px, y + 0.5);
      }

      // ID below, with a dark edge so it reads over anything
      ctx.font = `600 ${Math.round(iconR * 0.44)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(2,6,23,0.85)';
      ctx.lineWidth = 3 / scale;
      ctx.strokeText(`#${p.id}`, px, y + iconR + iconR * 0.5);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(`#${p.id}`, px, y + iconR + iconR * 0.5);

      if (state.inspecting === p.id) {
        ctx.beginPath();
        ctx.arc(px, y, iconR + 5 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2.5 / scale;
        ctx.stroke();
      }
    }
  }

  // People: a colored center (wellbeing, blue to red) inside a white ring with a thin dark edge.
  function drawAgents(ctx, scale) {
    const r = Math.max(2, CONFIG.agentRadius / scale);
    const ring = CONFIG.agentRingWidth / scale, edge = 1.3 / scale;
    const iconR = pantryRadius(scale);
    const outer = r + ring + edge;
    for (const a of state.agents) {
      const p = a.targetPantry;
      if (a.state === 'queued' && p) {
        // spot 0 is the person at the counter; the line starts at spot 1
        const idx = p.queue.indexOf(a);
        if (idx >= 0) a.pos = queueSpot(p, idx + 1, iconR, outer);
      } else if (a.state === 'served' && p) {
        a.pos = queueSpot(p, 0, iconR, outer);
      }

      let [ax, ay] = a.pos;
      if ((a.state === 'traveling' || a.state === 'leaving') && a.px !== undefined && state.running) {
        // glide between the last two simulation steps
        ax = a.px + (ax - a.px) * state.stepAlpha;
        ay = a.py + (ay - a.py) * state.stepAlpha;
      }
      let size = 1;
      let opacity = CONFIG.agentOpacity;
      if (a.state === 'stranded') {
        // Too far from any pantry: waggle in place
        const t = state.simTime * CONFIG.waggleSpeed + a.wagglePhase;
        ax += Math.sin(t) * CONFIG.waggleAmplitude;
        ay += Math.cos(t * 1.3) * CONFIG.waggleAmplitude * 0.4;
      } else if (a.state === 'timed_out') {
        const f = Math.max(0, a.lingerTimer / CONFIG.strandedFadeTime);
        opacity = Math.max(0.05, f * CONFIG.agentOpacity);
        size = 0.5 + 0.5 * f;
      } else if (a.state === 'served' && a.lingerTimer < CONFIG.fadeTime) {
        opacity = Math.max(0.05, (a.lingerTimer / CONFIG.fadeTime) * CONFIG.agentOpacity);
      } else if (a.state === 'leaving') {
        opacity = Math.max(0.05, (a.lingerTimer / CONFIG.walkAwayTime) * CONFIG.agentOpacity);
      }

      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(ax, ay, outer * size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2,6,23,0.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay, (r + ring) * size, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay, r * size, 0, Math.PI * 2);
      ctx.fillStyle = agentColor(a);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Understated screen-space weather overlay
  function drawWeather(ctx, w, h, dt) {
    const cond = getEffectiveWeather();
    const wr = weatherRef.current;
    if (wr.cond !== cond || wr.w !== w || wr.h !== h) {
      wr.cond = cond; wr.w = w; wr.h = h;
      wr.particles = makeParticles(cond, w, h);
    }
    const t = performance.now() / 1000;
    ctx.save();
    if (cond === 'rain') {
      ctx.fillStyle = 'rgba(56,189,248,0.035)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(186,215,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of wr.particles) {
        p.y += p.v * dt; p.x += p.v * 0.15 * dt;
        if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
        if (p.x > w + 20) p.x -= w + 40;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.15, p.y - p.len);
      }
      ctx.stroke();
    } else if (cond === 'snow') {
      ctx.fillStyle = 'rgba(226,232,240,0.04)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(241,245,249,0.35)';
      for (const p of wr.particles) {
        p.y += p.v * dt; p.x += Math.sin(t * 0.8 + p.ph) * 14 * dt;
        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cond === 'wind') {
      ctx.strokeStyle = 'rgba(226,232,240,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of wr.particles) {
        p.x += p.v * dt;
        if (p.x - p.len > w) { p.x = -Math.random() * 200; p.y = Math.random() * h; }
        const sway = Math.sin(t * 2 + p.ph) * 3;
        ctx.moveTo(p.x, p.y + sway);
        ctx.lineTo(p.x - p.len, p.y + sway * 0.4);
      }
      ctx.stroke();
    } else if (cond === 'heat') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(251,146,60,0.02)');
      g.addColorStop(1, `rgba(251,146,60,${0.09 + pulse * 0.04})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (cond === 'cloudy' || cond === 'partly_cloudy') {
      ctx.fillStyle = cond === 'cloudy' ? 'rgba(100,116,139,0.07)' : 'rgba(100,116,139,0.035)';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  const cursor = state.addingPantry ? 'crosshair'
    : state.removingPantry ? 'not-allowed'
    : state.closingPantry ? 'pointer'
    : 'grab';
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor }} />;
}

function strokeRoads(ctx, lines, color, width) {
  if (!lines || !lines.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const pts of lines) {
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.stroke();
}

// Water and park layers as small images, drawn scaled up with smoothing.
function getRaster(city) {
  if (!city.raster) return null;
  if (rasterCache.has(city)) return rasterCache.get(city);
  const { cols, rows, cell, rle } = city.raster;
  const make = (value, [r, g, b]) => {
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const cctx = c.getContext('2d');
    const img = cctx.createImageData(cols, rows);
    for (let y = 0; y < rows; y++) {
      const row = rle[y];
      let x = 0;
      for (let k = 0; k < row.length; k += 2) {
        const v = row[k], n = row[k + 1];
        if (v === value) {
          for (let i = x; i < x + n; i++) {
            const o = (y * cols + i) * 4;
            img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
          }
        }
        x += n;
      }
    }
    cctx.putImageData(img, 0, 0);
    return c;
  };
  const out = { cols, rows, cell, water: make(1, MAP_COLORS.water), park: make(2, MAP_COLORS.park) };
  rasterCache.set(city, out);
  return out;
}

// Heatmap of unmet need: where the households that went without food live, counted
// since the start of the run. Each cell's count is spread out (blurred) so areas merge,
// then colored green → yellow → red. The scale is relative: red is the worst area in
// this run, and areas with little unmet need are left clear.
const HEAT_STOPS = [ // [share of the worst area, red, green, blue, opacity]
  [0.00, 102, 255, 0, 0.0],
  [0.16, 102, 255, 0, 0.0],
  [0.34, 110, 255, 0, 0.5],
  [0.55, 238, 255, 0, 0.7],
  [0.78, 255, 160, 0, 0.82],
  [1.00, 255, 20, 0, 0.9],
];
const HEAT_UP = 4; // drawn at this many pixels per heat cell, then scaled up smoothly

function heatRamp(t, out, o) {
  let k = 1;
  while (k < HEAT_STOPS.length - 1 && t > HEAT_STOPS[k][0]) k++;
  const a = HEAT_STOPS[k - 1], b = HEAT_STOPS[k];
  const f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
  out[o] = a[1] + (b[1] - a[1]) * f;
  out[o + 1] = a[2] + (b[2] - a[2]) * f;
  out[o + 2] = a[3] + (b[3] - a[3]) * f;
  out[o + 3] = 255 * (a[4] + (b[4] - a[4]) * f);
}

function buildHeatCanvas(heat) {
  const { cols, rows } = heat;
  const W = cols * HEAT_UP, H = rows * HEAT_UP;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cctx = c.getContext('2d');
  const s = CONFIG.heatmapBlurCells * HEAT_UP, rad = Math.ceil(s * 3);
  const kern = new Float32Array(rad * 2 + 1);
  for (let i = -rad; i <= rad; i++) kern[i + rad] = Math.exp(-(i * i) / (2 * s * s));
  const a = new Float32Array(W * H), b = new Float32Array(W * H);
  const half = HEAT_UP >> 1;
  for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
    const v = heat.unmet[r * cols + cc];
    if (v) a[(r * HEAT_UP + half) * W + cc * HEAT_UP + half] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = a[y * W + x]; if (!v) continue;
    for (let i = -rad; i <= rad; i++) { const xx = x + i; if (xx >= 0 && xx < W) b[y * W + xx] += v * kern[i + rad]; }
  }
  a.fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = b[y * W + x]; if (!v) continue;
    for (let i = -rad; i <= rad; i++) { const yy = y + i; if (yy >= 0 && yy < H) a[yy * W + x] += v * kern[i + rad]; }
  }
  let max = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
  const img = cctx.createImageData(W, H);
  if (max > 0) {
    for (let i = 0; i < a.length; i++) heatRamp(a[i] / max, img.data, i * 4);
  }
  cctx.putImageData(img, 0, 0);
  return c;
}

function drawMoon(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.55, y - r * 0.3, r * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = '#c7d2fe';
  ctx.fill('evenodd');
  ctx.restore();
}

function makeParticles(cond, w, h) {
  const area = (w * h) / (900 * 600);
  const n = cond === 'rain' ? Math.round(140 * area)
    : cond === 'snow' ? Math.round(110 * area)
    : cond === 'wind' ? Math.round(36 * area)
    : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * w, y: Math.random() * h, ph: Math.random() * Math.PI * 2,
      v: cond === 'rain' ? 420 + Math.random() * 200 : cond === 'snow' ? 18 + Math.random() * 26 : 380 + Math.random() * 260,
      len: cond === 'rain' ? 8 + Math.random() * 8 : 40 + Math.random() * 60,
      r: 0.8 + Math.random() * 1.3,
    });
  }
  return out;
}

function pantryRadius(scale) {
  return Math.max(10, 18 / Math.sqrt(scale));
}

// Spot n around a pantry marker: rings of people, the first ring just outside the marker.
function queueSpot(p, n, iconR, outer) {
  const step = outer * 1.5; // neighbors overlap a little, like a crowd
  let R = iconR + outer * 0.9, ringIdx = 0;
  let cap = Math.max(6, Math.floor((2 * Math.PI * R) / step));
  while (n >= cap) {
    n -= cap;
    ringIdx++;
    R += outer * 1.55;
    cap = Math.floor((2 * Math.PI * R) / step);
  }
  const angle = (n / cap) * Math.PI * 2 + ringIdx * 0.5;
  return [p.lat + Math.cos(angle) * R, p.lng + Math.sin(angle) * R];
}

function agentColor(a) {
  if (a.state === 'leaving' || a.state === 'timed_out') return wellbeingColor(Math.max(0, a.wellbeing * 0.3));
  return wellbeingColor(Math.max(0, a.wellbeing));
}
