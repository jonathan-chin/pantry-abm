import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { state, subscribe, updateSim, notify, getVersion } from '../simulation/engine.js';

export function useSimulation() {
  useSyncExternalStore(subscribe, getVersion);

  const lastRef = useRef(performance.now());

  useEffect(() => {
    let rafId = 0;
    let intervalId = 0;

    function tick() {
      const now = performance.now();
      const dt = Math.min((now - lastRef.current) / 1000, 0.1);
      lastRef.current = now;
      updateSim(dt);
    }

    function rafLoop(ts) {
      tick();
      rafId = requestAnimationFrame(rafLoop);
    }

    // Use both RAF (for smooth when visible) and interval (for when hidden)
    rafId = requestAnimationFrame(rafLoop);
    intervalId = setInterval(tick, 50);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
    };
  }, []);

  const forceUpdate = useCallback(() => notify(), []);

  return { state, forceUpdate };
}
