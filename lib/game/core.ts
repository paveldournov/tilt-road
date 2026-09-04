export type Topology = 'flow' | 'serpentine' | 'alpine';
export type Scenery = 'coast' | 'desert' | 'night';
export type Tilt = { pitch: number; roll: number };
export type GameState = {
  status: 'ready' | 'running' | 'paused';
  topology: Topology;
  distance: number;
  speed: number;
  lateral: number;
  pitch: number;
  roll: number;
  collected: number;
  lastCollected: number;
  pickupFlash: number;
};
export const HALF_WIDTH = 9;
export const MAX_SPEED = 96;
export const clamp = (x: number, min: number, max: number) =>
  Math.max(min, Math.min(max, x));
export function createState(topology: Topology = 'flow'): GameState {
  return {
    status: 'ready',
    topology,
    distance: 0,
    speed: 0,
    lateral: 0,
    pitch: 0,
    roll: 0,
    collected: 0,
    lastCollected: -1,
    pickupFlash: 0,
  };
}
export function road(s: number, topology: Topology) {
  const x =
    topology === 'serpentine'
      ? 56 * Math.sin(s / 135) + 20 * Math.sin(s / 61)
      : topology === 'alpine'
        ? 72 * Math.sin(s / 220) + 26 * Math.sin(s / 93)
        : 48 * Math.sin(s / 260) + 17 * Math.sin(s / 113);
  const y =
    topology === 'alpine'
      ? 15 * Math.sin(s / 170) + 5 * Math.sin(s / 67)
      : 3 * Math.sin(s / 230);
  const bank =
    topology === 'flow' ? 0.04 * Math.sin(s / 180) : 0.12 * Math.sin(s / 135);
  return { x, y, bank };
}
export function random(n: number) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return v - Math.floor(v);
}
export const TREASURE_START = 90;
export const TREASURE_SPACING = 48;
export function treasure(index: number) {
  return {
    s: TREASURE_START + index * TREASURE_SPACING,
    x: (Math.floor(random(index + 8) * 3) - 1) * 5.3,
    radius: 1.2,
  };
}
export function step(state: GameState, input: Tilt, dt: number) {
  if (state.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);
  state.pickupFlash = Math.max(0, state.pickupFlash - dt);
  const pitch = Number.isFinite(input.pitch) ? clamp(input.pitch, -1, 1) : 0;
  const roll = Number.isFinite(input.roll) ? clamp(input.roll, -1, 1) : 0;
  const blend = 1 - Math.exp(-dt * 16);
  state.pitch += (pitch - state.pitch) * blend;
  state.roll += (roll - state.roll) * blend;
  const previous = state.distance,
    oldSpeed = state.speed,
    oldLateral = state.lateral;
  state.speed = clamp(
    state.speed + (state.pitch >= 0 ? state.pitch * 30 : state.pitch * 60) * dt,
    0,
    MAX_SPEED,
  );
  if (state.speed < 0.035 && pitch <= 0) state.speed = 0;
  state.distance += (oldSpeed + state.speed) * 0.5 * dt;
  // Soft road boundaries: leaning outward never ends or slows the run.
  state.lateral = clamp(
    state.lateral + state.roll * (2 + Math.min(state.speed, 62) * 0.16) * dt,
    -HALF_WIDTH + 0.65,
    HALF_WIDTH - 0.65,
  );
  const first = Math.max(
    0,
    Math.floor((previous - TREASURE_START - 3) / TREASURE_SPACING),
  );
  const last = Math.max(
    0,
    Math.ceil((state.distance - TREASURE_START + 3) / TREASURE_SPACING),
  );
  for (let i = first; i <= last; i++) {
    if (i <= state.lastCollected) continue;
    const gem = treasure(i),
      reach = gem.radius + 0.8;
    if (state.distance >= gem.s - 2.8 && previous <= gem.s + 2.8) {
      // Sweep both axes, including sideways collection while stopped.
      const travel = state.distance - previous;
      const enter =
        travel > 0 ? clamp((gem.s - 2.8 - previous) / travel, 0, 1) : 0;
      const exit =
        travel > 0 ? clamp((gem.s + 2.8 - previous) / travel, 0, 1) : 1;
      const a = oldLateral + (state.lateral - oldLateral) * enter;
      const b = oldLateral + (state.lateral - oldLateral) * exit;
      if (Math.min(a, b) <= gem.x + reach && Math.max(a, b) >= gem.x - reach) {
        state.collected++;
        state.lastCollected = i;
        state.pickupFlash = 0.65;
      }
    }
  }
}

/** Preserve real-time travel across slow frames without an unbounded catch-up. */
export function advanceFrame(state: GameState, input: Tilt, elapsed: number) {
  if (!Number.isFinite(elapsed) || elapsed <= 0 || state.status !== 'running')
    return;
  const duration = Math.min(elapsed, 0.25);
  const count = Math.ceil(duration * 120);
  for (let i = 0; i < count; i++) step(state, input, duration / count);
}
