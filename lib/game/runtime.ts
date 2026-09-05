import { FixedSimulation, type GameState, type Scenery } from './core';
import type { TiltInput } from './input';
import type { RoadRenderer } from './renderer';
import type { TelemetryStore } from './telemetry';

/** Owns clocks and persistence. React owns menus, never the simulation clock. */
export class FlightRuntime {
  private simulation = new FixedSimulation();
  private frame = 0;
  private last = 0;
  private rendered = 0;
  private lastDraw = 0;
  private published = 0;
  private savedAt = 0;
  private record = 0;
  private savedRecord = 0;
  private status = '';
  private pickups = 0;
  private costs: number[] = [];
  private intervals: number[] = [];
  private profileAt = 0;
  constructor(
    private options: {
      state: () => GameState;
      scenery: () => Scenery;
      input: TiltInput;
      renderer: RoadRenderer;
      telemetry: TelemetryStore;
      onStatus: (state: GameState) => void;
      onPickup: () => void;
      profile?: (text: string) => void;
    },
  ) {
    try {
      const saved = Number(localStorage.getItem('roadtilt-best'));
      this.record = Number.isFinite(saved) ? Math.max(0, saved) : 0;
    } catch {
      /* Optional. */
    }
    this.savedRecord = this.record;
  }
  start() {
    this.last = performance.now();
    this.profileAt = this.last;
    this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (!document.hidden) {
      const { state: read, input, renderer, telemetry } = this.options;
      const state = read();
      const display = this.simulation.advance(state, input.read(now), dt);
      if (state.collected > this.pickups) this.options.onPickup();
      this.pickups = state.collected;
      const interval = state.status === 'running' ? 1000 / 60 : 1000 / 20;
      if (now - this.rendered >= interval - 0.5) {
        const before = performance.now();
        renderer.render(display, this.options.scenery(), now / 1000);
        telemetry.frame(display);
        if (this.options.profile) {
          this.costs.push(performance.now() - before);
          if (this.lastDraw) this.intervals.push(now - this.lastDraw);
        }
        this.lastDraw = now;
        this.rendered = now - ((now - this.rendered) % interval);
      }
      const changed = this.status !== state.status;
      if (changed) {
        this.status = state.status;
        this.options.onStatus({ ...state });
      }
      if (changed || now - this.published >= 100) {
        this.record = Math.max(this.record, Math.floor(state.distance));
        telemetry.publish(state, this.record);
        this.published = now;
      }
      if (now - this.savedAt >= 1000) {
        this.save();
        this.savedAt = now;
      }
      if (
        this.options.profile &&
        now - this.profileAt >= 2000 &&
        this.costs.length
      ) {
        const sorted = this.costs.sort((a, b) => a - b);
        const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
        const avgInterval =
          this.intervals.reduce((a, b) => a + b, 0) /
          Math.max(1, this.intervals.length);
        this.options.profile(
          `${Math.round(1000 / avgInterval)} render FPS · p95 ${p95.toFixed(1)} ms CPU · ${renderer.diagnostics.chunks} chunks · ${renderer.diagnostics.faces} faces`,
        );
        this.costs.length = this.intervals.length = 0;
        this.profileAt = now;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  save() {
    this.record = Math.max(
      this.record,
      Math.floor(this.options.state().distance),
    );
    if (this.record <= this.savedRecord) return;
    try {
      localStorage.setItem('roadtilt-best', String(this.record));
      this.savedRecord = this.record;
    } catch {
      /* Optional. */
    }
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.save();
  }
}
