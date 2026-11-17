import { useState, useRef, useEffect } from 'react';
import { useSimulation } from './hooks/useSimulation.js';
import { state, initSim, initModifiers, notify, getEffectiveWeather, setLayer } from './simulation/engine.js';
import { loadDefaultCity, loadCity, getCityIndex, getCity } from './data/cityStore.js';
import { WEATHER_LABELS } from './data/weather.js';
import MapView from './components/MapView.jsx';
import Panel from './components/Panel.jsx';
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
        <div className="chart-area" ref={chartContainerRef}>
          <StackedChart width={chartSize.w} height={chartSize.h} />
        </div>
        <div className="spark-area" ref={sparkContainerRef}>
          <Sparklines width={sparkSize.w} height={sparkSize.h} />
        </div>
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
            <div className="heat-legend">
              <span>Demand</span>
              <span className="heat-ramp" />
              <span className="heat-labels"><span>unmet</span><span>met</span></span>
            </div>
          )}
          {state.layers.waiting && (
            <div className="wait-legend">
              <span><i style={{ background: 'rgba(245,158,11,0.8)' }} />Waiting 1–2 days</span>
              <span><i style={{ background: 'rgba(239,68,68,0.9)' }} />3+ days</span>
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

const LAYER_GROUPS = [
  { title: 'Base map', items: [['water', 'Water'], ['parks', 'Parks'], ['streets', 'Streets'], ['highways', 'Highways'], ['labels', 'Neighborhood names']] },
  { title: 'Overlays', items: [['pantries', 'Pantries'], ['agents', 'People on the move'], ['waiting', 'Households waiting'], ['heatmap', 'Demand heatmap'], ['weather', 'Weather effects']] },
];

function MapToolbar() {
  const [layersOpen, setLayersOpen] = useState(false);

  function clearModes() {
    state.addingPantry = false;
    state.removingPantry = false;
    state.closingPantry = false;
  }
  function toggle(mode) {
    if (mode === 'inspect') {
      clearModes();
    } else if (mode === 'add') {
      const was = state.addingPantry;
      clearModes();
      state.addingPantry = !was;
    } else if (mode === 'remove') {
      const was = state.removingPantry;
      clearModes();
      state.removingPantry = !was;
    } else if (mode === 'close') {
      const was = state.closingPantry;
      clearModes();
      state.closingPantry = !was;
    }
    notify();
  }

  const inspecting = !state.addingPantry && !state.removingPantry && !state.closingPantry;
  return (
    <div className="map-toolbar">
      <button
        className={'map-tool-btn' + (inspecting ? ' active' : '')}
        onClick={() => toggle('inspect')}
        title="Inspect pantry"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" /><line x1="12.5" y1="12.5" x2="17" y2="17" />
        </svg>
      </button>
      <button
        className={'map-tool-btn' + (state.addingPantry ? ' active' : '')}
        onClick={() => toggle('add')}
        title="Add pantry"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" />
        </svg>
      </button>
      <button
        className={'map-tool-btn' + (state.removingPantry ? ' active' : '')}
        onClick={() => toggle('remove')}
        title="Remove pantry"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="5,4 10,9 15,4" /><rect x="5" y="8" width="10" height="8" rx="1" /><line x1="8" y1="11" x2="8" y2="14" /><line x1="12" y1="11" x2="12" y2="14" />
        </svg>
      </button>
      <button
        className={'map-tool-btn' + (state.closingPantry ? ' active' : '')}
        onClick={() => toggle('close')}
        title="Close/reopen pantry"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="10" cy="10" r="7" /><line x1="6" y1="6" x2="14" y2="14" />
        </svg>
      </button>
      <div className="toolbar-sep" />
      <button
        className={'map-tool-btn' + (layersOpen ? ' active' : '')}
        onClick={() => setLayersOpen(o => !o)}
        title="Map layers"
        aria-expanded={layersOpen}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <polygon points="10,3 18,7 10,11 2,7" /><polyline points="2,10.5 10,14.5 18,10.5" /><polyline points="2,14 10,18 18,14" />
        </svg>
      </button>
      {layersOpen && (
        <div className="layers-popover">
          {LAYER_GROUPS.map(g => (
            <div key={g.title} className="layers-group">
              <div className="layers-title">{g.title}</div>
              {g.items.map(([id, label]) => (
                <label key={id} className="layer-item">
                  <input type="checkbox" checked={!!state.layers[id]} onChange={e => setLayer(id, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
