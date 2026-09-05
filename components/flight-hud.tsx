'use client';
import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { Activity } from 'lucide-react';
import { MAX_SPEED } from '@/lib/game/core';
import type { TelemetryStore } from '@/lib/game/telemetry';

export const RunStats = memo(function RunStats({
  store,
}: {
  store: TelemetryStore;
}) {
  const hud = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const best = hud.best;
  return (
    <aside className="run-stats">
      <div
        className="treasure-count"
        aria-label={`${hud.collected} treasures collected`}
      >
        <span className="eyebrow">TREASURES</span>
        <strong>◆ {hud.collected}</strong>
        <span
          className="pickup-feedback"
          style={{ opacity: hud.pickupFlash > 0 ? 1 : 0 }}
        >
          +1 TREASURE
        </span>
      </div>
      <span className="eyebrow">DISTANCE</span>
      <div>
        {(hud.distance / 1000).toFixed(2)}
        <small> KM</small>
      </div>
      <span className="best">BEST {(best / 1000).toFixed(2)} KM</span>
    </aside>
  );
});
export const Speed = memo(function Speed({ store }: { store: TelemetryStore }) {
  const hud = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <section className="speed">
      <span className="eyebrow">GROUND SPEED</span>
      <div>
        {Math.round(hud.speed * 3.6)
          .toString()
          .padStart(3, '0')}
        <small>KM/H</small>
      </div>
      <div className="speed-track">
        <i style={{ width: `${(hud.speed / MAX_SPEED) * 100}%` }} />
      </div>
      <span className="speed-state">
        {hud.status === 'running'
          ? hud.pitch > 0.1
            ? 'ACCELERATING'
            : hud.pitch < -0.1
              ? 'BRAKING'
              : hud.speed < 0.1
                ? 'STATIONARY'
                : 'COASTING'
          : 'READY FOR FLIGHT'}
      </span>
    </section>
  );
});
export const TiltInstrument = memo(function TiltInstrument({
  store,
}: {
  store: TelemetryStore;
}) {
  const horizon = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      store.instrument((state) => {
        if (horizon.current)
          horizon.current.style.transform = `translateY(${state.pitch * 12}px) rotate(${state.roll * 22}deg)`;
        if (value.current)
          value.current.textContent = `${Math.round(state.roll * 22)}° ROLL / ${Math.round(state.pitch * 16)}° PITCH`;
      }),
    [store],
  );
  return (
    <section className="tilt-display" aria-label="Platform tilt">
      <span className="eyebrow">
        <Activity size={14} /> PLATFORM TILT
      </span>
      <div className="tilt-meter">
        <div className="tilt-horizon" ref={horizon}>
          <i />
        </div>
      </div>
      <span className="tilt-value" ref={value}>
        0° ROLL / 0° PITCH
      </span>
    </section>
  );
});
