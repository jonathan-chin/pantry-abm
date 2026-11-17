// Per-browser UI conveniences (layer toggles, collapsed panels, chart window).
// Storage can be unavailable (private windows, blocked site data), so every access is guarded.
const PREFIX = 'food-aid-sim:';

export function loadPref(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
