import { useState, useRef, useEffect } from 'react';
import { useSimulation } from './hooks/useSimulation.js';
import { state, initSim, initModifiers, notify, getEffectiveWeather, setLayer } from './simulation/engine.js';
import { loadDefaultCity, loadCity, getCityIndex, getCity } from './data/cityStore.js';
import { WEATHER_LABELS } from './data/weather.js';
import { LAYERS } from './data/layers.js';
import MapView from './components/MapView.jsx';
import Panel from './components/Panel.jsx';
import MetricsBar from './components/MetricsBar.jsx';
import StackedChart from './components/StackedChart.jsx';
import Sparklines from './components/Sparklines.jsx';
import Summary from './components/Summary.jsx';
import ConfigModal from './components/ConfigModal.jsx';
import { SunDial, WeatherIcon, WindMark } from './components/ClockIcons.jsx';
import { periodFor } from './utils/colors.js';
import './App.css';

export default function App() {
  const { forceUpdate } = useSimulation();
  const [showSummary, setShowSummary] = useState(false);
  const [configFile, setConfigFile] = useState(null);
  const [chartSize, setChartSize] = useState({ w: 600, h: 140 });
  const [sparkSize, setSparkSize] = useState({ w: 300, h: 140 });
  const [citySlug, setCitySlug] = useState('');
  const chartContainerRef = useRef(null);
  const sparkContainerRef = useRef(null);

  useEffect(() => {
    loadDefaultCity().then(city => {
      if (city) {
        setCitySlug(getCityIndex()[0].slug);
        initModifiers();
        initSim(state.params);
      }
    });
  }, []);

  useEffect(() => {
    function measure() {
      if (chartContainerRef.current) {
        const r = chartContainerRef.current.getBoundingClientRect();
        setChartSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
      if (sparkContainerRef.current) {
        const r = sparkContainerRef.current.getBoundingClientRect();
        setSparkSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function handleCityChange(slug) {
    loadCity(slug).then(() => {
      setCitySlug(slug);
      initModifiers(); // a new map starts from the baseline, like Reset
      initSim(state.params);
      forceUpdate();
    });
  }

  const modeBadge = state.modifiers.filter(m => m.active && m.type !== 'weather').map(m => m.label).join(' + ') || 'Preferred Pantry';
  const city = getCity();

  return (
    <div className="app-layout">
      <div className="small-screen-note">This tool is designed for desktop and laptop screens. Parts of it will overlap on a phone.</div>
      <div className="top-row">
        <div className="top-charts">
          <div className="chart-area" ref={chartContainerRef}>
            <StackedChart width={chartSize.w} height={chartSize.h} />
          </div>
          <div className="spark-area" ref={sparkContainerRef}>
            <Sparklines width={sparkSize.w} height={sparkSize.h} />
          </div>
        </div>
        <MetricsBar />
      </div>

      <div className="bottom-row">
        <div className="map-area">
          <MapView />
          <div className="mode-badge">{modeBadge}</div>
          <ClockBadge />
          <div className="city-selector">
            <select value={citySlug} onChange={e => handleCityChange(e.target.value)}>
              {getCityIndex().map(c => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
          <MapToolbar />
          {state.layers.heatmap && (
            <div className="heat-legend" title="Where households that went without food live, counted since the start of the run. Red is the worst area in this run.">
              <span>Unmet need</span>
              <span className="heat-ramp" />
              <span className="heat-labels"><span>less</span><span>more</span></span>
            </div>
          )}
          {city?.attribution && (
            <div className="map-attribution">Pantry sites are made up, not real pantries · Map data {city.attribution}</div>
          )}
          {state.shock.active && <div className="shock-badge">SHOCK ACTIVE</div>}
        </div>
        <Panel onShowSummary={() => setShowSummary(true)} onOpenConfig={setConfigFile} />
      </div>

      {showSummary && (
        <Summary runs={state.runs} onClose={() => setShowSummary(false)} />
      )}
      {configFile && (
        <ConfigModal initial={configFile} onClose={() => setConfigFile(null)} />
      )}
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Background tints behind the badge
const WEATHER_BG = {
  clear: 'rgba(239,159,39,0.10)',
  partly_cloudy: 'rgba(180,178,169,0.10)',
  cloudy: 'rgba(136,135,128,0.12)',
  rain: 'rgba(55,138,221,0.15)',
  snow: 'rgba(181,212,244,0.15)',
  heat: 'rgba(216,90,48,0.15)',
  wind: 'rgba(29,158,117,0.12)',
};

const PERIOD_BG = {
  morning: 'rgba(250,199,117,0.12)',
  afternoon: 'rgba(239,159,39,0.12)',
  evening: 'rgba(127,119,221,0.14)',
};

function ClockBadge() {
  const c = state.clock;
  const h = Math.floor(c.hour);
  const m = Math.floor(c.minute);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const dayName = DAYS[(c.weekday - 1) % 7];
  const isWeekend = c.weekday >= 6;
  const hour = c.hour + c.minute / 60;
  const period = periodFor(hour);
  const condition = getEffectiveWeather();
  const weatherLabel = WEATHER_LABELS[condition] || condition;
  const wind = condition !== 'wind' && state.weather.wind !== 'calm' ? state.weather.wind : null;

  return (
    <div className="clock-badge"
      style={{ background: `linear-gradient(135deg, ${PERIOD_BG[period.id]}, ${WEATHER_BG[condition] || WEATHER_BG.clear})` }}
      title={`${period.label} · ${weatherLabel}${wind ? ` · ${wind}` : ''}`}>
      <span className="clock-period-icon"><SunDial hour={hour} /></span>
      <div className="clock-center">
        <span className={'clock-day' + (isWeekend ? ' weekend' : '')}>{dayName}</span>
        <span className="clock-time">{h12}:{String(m).padStart(2, '0')} {ampm}</span>
      </div>
      <span className="clock-weather-icon">
        <WeatherIcon condition={condition} label={weatherLabel} />
        {wind && <WindMark strength={wind} />}
      </span>
    </div>
  );
}

const ICON = { viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

// Pantry tools: each one arms a kind of click on the map. With none armed, clicking a pantry inspects it.
const PANTRY_TOOLS = [
  {
    flag: 'addingPantry', label: 'Add pantry', hint: 'then click a street corner',
    icon: <svg {...ICON} strokeWidth="2.5"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>,
  },
  {
    flag: 'removingPantry', label: 'Remove pantry', hint: 'then click a pantry',
    icon: <svg {...ICON}><line x1="4" y1="6" x2="16" y2="6" /><path d="M8 6V4h4v2" /><path d="M6 6l0.8 11h6.4L14 6" /></svg>,
  },
  {
    flag: 'closingPantry', label: 'Close or reopen pantry', hint: 'then click pantries',
    icon: <svg {...ICON}><circle cx="10" cy="10" r="7" /><line x1="5.5" y1="5.5" x2="14.5" y2="14.5" /></svg>,
  },
];

function MapToolbar() {
  const [menu, setMenu] = useState(null); // 'tools' | 'layers' | null
  const barRef = useRef(null);
  const armed = PANTRY_TOOLS.find(t => state[t.flag]) || null;

  function arm(tool) {
    const was = !!(tool && state[tool.flag]);
    for (const t of PANTRY_TOOLS) state[t.flag] = false;
    if (tool && !was) state[tool.flag] = true;
    notify();
  }

  // Escape puts the tools away; a click anywhere else closes an open menu
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      setMenu(null);
      if (PANTRY_TOOLS.some(t => state[t.flag])) arm(null);
    }
    function onDown(e) {
      if (barRef.current && !barRef.current.contains(e.target)) setMenu(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <div className="map-toolbar" ref={barRef}>
      <div className="map-tool">
        <button
          className={'map-tool-btn' + (armed ? ' active' : '')}
          onClick={() => setMenu(m => (m === 'tools' ? null : 'tools'))}
          title={armed ? `${armed.label} is on` : 'Pantry tools'}
          aria-haspopup="menu" aria-expanded={menu === 'tools'}
        >
          {armed ? armed.icon : (
            <svg {...ICON}><path d="M3.5 16.5l1-4L13.5 3.5l3 3L7.5 15.5z" /><line x1="11.5" y1="5.5" x2="14.5" y2="8.5" /></svg>
          )}
        </button>
        {menu === 'tools' && (
          <div className="map-menu" role="menu">
            <div className="map-menu-title">Pantry tools</div>
            {PANTRY_TOOLS.map(t => (
              <button key={t.flag} role="menuitemcheckbox" aria-checked={!!state[t.flag]}
                className={'map-menu-item' + (state[t.flag] ? ' on' : '')}
                onClick={() => { arm(t); setMenu(null); }}>
                <span className="map-menu-icon">{t.icon}</span>
                <span className="map-menu-text">{t.label}<small>{state[t.flag] ? 'on · choose again to turn off' : t.hint}</small></span>
              </button>
            ))}
            <div className="map-menu-note">With no tool on, click a pantry to inspect it.</div>
          </div>
        )}
      </div>
      <div className="map-tool">
        <button
          className={'map-tool-btn' + (menu === 'layers' ? ' open' : '')}
          onClick={() => setMenu(m => (m === 'layers' ? null : 'layers'))}
          title="Map layers"
          aria-haspopup="menu" aria-expanded={menu === 'layers'}
        >
          <svg {...ICON} strokeWidth="1.8"><polygon points="10,3 18,7 10,11 2,7" /><polyline points="2,10.5 10,14.5 18,10.5" /><polyline points="2,14 10,18 18,14" /></svg>
        </button>
        {menu === 'layers' && (
          <div className="map-menu" role="menu">
            <div className="map-menu-title">Layers</div>
            {LAYERS.map(l => (
              <label key={l.id} className="layer-item">
                <input type="checkbox" checked={!!state.layers[l.id]} onChange={e => setLayer(l.id, e.target.checked)} />
                {l.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
