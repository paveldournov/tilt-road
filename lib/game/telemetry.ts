import { createState, type GameState } from './core';

export class TelemetryStore {
  private snapshot = { ...createState(), best: 0 };
  private listeners = new Set<() => void>();
  private instruments = new Set<(state: GameState) => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  instrument(fn: (state: GameState) => void) {
    this.instruments.add(fn);
    return () => {
      this.instruments.delete(fn);
    };
  }
  frame(state: GameState) {
    for (const fn of this.instruments) fn(state);
  }
  publish(state: GameState, best: number) {
    this.snapshot = { ...state, best };
    for (const fn of this.listeners) fn();
  }
}
