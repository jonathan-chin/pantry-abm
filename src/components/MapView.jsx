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

const BG_LAYERS = ['water', 'parks', 'streets', 'highways', 'labels'];
const rasterCache = new WeakMap();

export default function MapView() {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const viewRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false); // the click that ends a drag is not a click
  const bgRef = useRef(null);
  const bgKeyRef = useRef('');
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

    const bgKey = BG_LAYERS.map(k => (state.layers[k] ? 1 : 0)).join('');
    if (!bgRef.current || bgKeyRef.current !== bgKey) {
      bgRef.current = buildBg(city, w, h, v, dpr);
      bgKeyRef.current = bgKey;
    }
    ctx.drawImage(bgRef.current, 0, 0, w, h);

    // Dynamic layer
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.ox, -v.oy);

    if (state.layers.heatmap) drawHeatmap(ctx);
    if (state.layers.pantries) drawPantries(ctx, v.scale);
    if (state.layers.waiting) drawWaiting(ctx, v.scale);
    if (state.layers.agents) drawAgents(ctx, v.scale);

    ctx.restore();

    if (state.layers.weather) drawWeather(ctx, w, h, state.running ? dt : 0);
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
      if (state.layers.parks) ctx.drawImage(raster.park, 0, 0, rw, rh);
      if (state.layers.water) ctx.drawImage(raster.water, 0, 0, rw, rh);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const minW = 0.8 / v.scale;
    if (state.layers.streets) {
      strokeRoads(ctx, city.roads?.loc, MAP_COLORS.local, Math.max(2.2, minW));
      strokeRoads(ctx, city.roads?.art, MAP_COLORS.arterial, Math.max(3.6, minW * 1.4));
    }
    if (state.layers.highways) {
      strokeRoads(ctx, city.roads?.hw, MAP_COLORS.highway, Math.max(5, minW * 2));
    }

    if (state.layers.labels && city.labels) {
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
    ctx.globalAlpha = 0.75;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hr.canvas, 0, 0, heat.cols * heat.cell, heat.rows * heat.cell);
    ctx.restore();
  }

  function drawPantries(ctx, scale) {
    const iconR = Math.max(10, 18 / Math.sqrt(scale));
    for (const p of state.pantries) {
      const x = p.lat, y = p.lng;
      const ratio = p.capacity > 0 ? Math.max(0, p.stock) / p.capacity : 0;
      const color = p.closed ? '#64748b' : ratio > 0.5 ? '#22c55e' : ratio > 0.2 ? '#f59e0b' : '#ef4444';

      let shakeX = 0;
      if (p.shake > 0) {
        const amp = 3 * (p.shake / CONFIG.pantryShakeDuration) / scale;
        shakeX = Math.sin(p.shake * CONFIG.pantryShakeDecay * Math.PI * 2) * amp;
      }

      const px = x + shakeX;

      // Background circle
      ctx.beginPath();
      ctx.arc(px, y, iconR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15,23,42,0.92)';
      ctx.fill();

      // Stock ring
      ctx.beginPath();
      ctx.arc(px, y, iconR - 2, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 / scale;
      ctx.stroke();

      // Track ring
      ctx.beginPath();
      ctx.arc(px, y, iconR - 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100,116,139,0.3)';
      ctx.lineWidth = 2.5 / scale;
      ctx.stroke();

      if (p.closed && p.closedReason === 'hours') {
        // Closed for the night: crescent moon
        drawMoon(ctx, px, y, iconR * 0.46);
      } else {
        const label = p.closed ? 'X' : Math.max(0, Math.floor(p.stock)).toString();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `bold ${Math.round(iconR * 0.75)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px, y + 0.5);
      }

      // ID below
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${Math.round(iconR * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${p.id}`, px, y + iconR + iconR * 0.35);

      // Highlight if inspected
      if (state.inspecting === p.id) {
        ctx.beginPath();
        ctx.arc(px, y, iconR + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    }
  }

  // Homes of households that went without food and are still waiting:
  // amber for 1–2 days, red for 3 or more.
  function drawWaiting(ctx, scale) {
    const r = Math.max(1.4, 2 / scale);
    const short = new Path2D(), long = new Path2D();
    for (const h of state.households.list) {
      if (!h.active || !h.inNeed || h.daysWaiting < 1) continue;
      const path = h.daysWaiting >= 3 ? long : short;
      path.moveTo(h.home[0] + r, h.home[1]);
      path.arc(h.home[0], h.home[1], r, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(245,158,11,0.42)';
    ctx.fill(short);
    ctx.fillStyle = 'rgba(239,68,68,0.6)';
    ctx.fill(long);
  }

  function drawAgents(ctx, scale) {
    const r = Math.max(2, CONFIG.agentRadius / scale);
    for (const a of state.agents) {
      if (a.state === 'queued' && a.targetPantry) {
        const p = a.targetPantry;
        const idx = p.queue.indexOf(a);
        if (idx >= 0) {
          let placed = 0, ring = 0;
          while (placed + (6 + ring * 3) <= idx) {
            placed += 6 + ring * 3;
            ring++;
          }
          const cap = 6 + ring * 3;
          const slot = idx - placed;
          const offset = ring * 1.0;
          const angle = (slot / cap) * Math.PI * 2 + offset;
          const radius = 20 + ring * 8;
          a.pos = [p.lat + Math.cos(angle) * radius, p.lng + Math.sin(angle) * radius];
        }
      }

      let [ax, ay] = a.pos;
      if ((a.state === 'traveling' || a.state === 'leaving') && a.px !== undefined && state.running) {
        // glide between the last two simulation steps
        ax = a.px + (ax - a.px) * state.stepAlpha;
        ay = a.py + (ay - a.py) * state.stepAlpha;
      }
      let rr = r;
      let opacity = CONFIG.agentOpacity;
      if (a.state === 'stranded') {
        // Too far from any pantry: waggle in place
        const t = state.simTime * CONFIG.waggleSpeed + a.wagglePhase;
        ax += Math.sin(t) * CONFIG.waggleAmplitude;
        ay += Math.cos(t * 1.3) * CONFIG.waggleAmplitude * 0.4;
      } else if (a.state === 'timed_out') {
        const f = Math.max(0, a.lingerTimer / CONFIG.strandedFadeTime);
        opacity = Math.max(0.05, f * CONFIG.agentOpacity);
        rr = r * (0.5 + 0.5 * f);
      } else if (a.state === 'served' && a.lingerTimer < CONFIG.fadeTime) {
        opacity = Math.max(0.05, (a.lingerTimer / CONFIG.fadeTime) * CONFIG.agentOpacity);
      } else if (a.state === 'leaving') {
        opacity = Math.max(0.05, (a.lingerTimer / CONFIG.walkAwayTime) * CONFIG.agentOpacity);
      }

      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(ax, ay, rr, 0, Math.PI * 2);
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

// Green where demand was met, red where it wasn't; more outcomes = more opaque.
function buildHeatCanvas(heat) {
  const c = document.createElement('canvas');
  c.width = heat.cols; c.height = heat.rows;
  const cctx = c.getContext('2d');
  const img = cctx.createImageData(heat.cols, heat.rows);
  let maxT = 0;
  for (let i = 0; i < heat.met.length; i++) maxT = Math.max(maxT, heat.met[i] + heat.unmet[i]);
  if (maxT > 0) {
    const lmax = Math.log1p(maxT);
    for (let i = 0; i < heat.met.length; i++) {
      const t = heat.met[i] + heat.unmet[i];
      if (!t) continue;
      const ratio = heat.met[i] / t;
      const o = i * 4;
      img.data[o] = Math.round(239 + (34 - 239) * ratio);
      img.data[o + 1] = Math.round(68 + (197 - 68) * ratio);
      img.data[o + 2] = Math.round(68 + (94 - 68) * ratio);
      img.data[o + 3] = Math.round(255 * (0.3 + 0.7 * Math.log1p(t) / lmax));
    }
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

function agentColor(a) {
  if (a.state === 'leaving' || a.state === 'timed_out') return wellbeingColor(Math.max(0, a.wellbeing * 0.3));
  return wellbeingColor(Math.max(0, a.wellbeing));
}
