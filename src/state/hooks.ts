import { useEffect, useRef, useState } from 'react';
import { engine, useApp } from './store';
import type { SeriesPoint } from '@/types';

/**
 * Drives the simulation from requestAnimationFrame and pushes snapshots into
 * the React tree at ~11Hz. The simulation itself steps on every frame (so the
 * canvas stays smooth) while React re-renders at a rate that keeps the UI
 * responsive even with a dozen live charts on screen.
 */
export function useEngineClock(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSync = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      engine.advance(dt);
      if (now - lastSync > 90) {
        lastSync = now;
        useApp.getState().syncFromEngine();
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Snapshot of the rolling series, refreshed a few times a second. */
export function useSeries(limit = 90, intervalMs = 450): SeriesPoint[] {
  const [series, setSeries] = useState<SeriesPoint[]>(() => engine.getSeries().slice(-limit));
  const version = useApp((s) => s.snapshot.seriesVersion);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeries(engine.getSeries().slice(-limit).map((p) => ({ ...p })));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [limit, intervalMs]);

  // Also refresh immediately when the engine publishes a new point.
  useEffect(() => {
    setSeries(engine.getSeries().slice(-limit).map((p) => ({ ...p })));
  }, [version, limit]);

  return series;
}

/** True while the given key is held down (used for keyboard shortcuts). */
export function useKeyPress(target: string, handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === target.toLowerCase()) handlerRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);
}
