export type Topology = 'flow' | 'serpentine' | 'alpine';
export type Scenery = 'coast' | 'desert' | 'night';
export type Tilt = { pitch: number; roll: number };
export type GameState = {
  status: 'ready' | 'running' | 'paused' | 'crashed';
  topology: Topology;
  distance: number;
  speed: number;
  lateral: number;
  pitch: number;
  roll: number;
  cleared: number;
  reason: string;
};
export const HALF_WIDTH = 9;
export const MAX_SPEED = 62;
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
    cleared: 0,
    reason: '',
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
export function obstacle(index: number) {
  return {
    s: 150 + index * 76,
    x: (Math.floor(random(index + 8) * 3) - 1) * 5.3,
    width: index % 4 === 3 ? 3.4 : 2.7,
    height: index % 3 === 0 ? 3.8 : 2.6,
  };
}
export function step(state: GameState, input: Tilt, dt: number) {
  if (state.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);
  const pitch = Number.isFinite(input.pitch) ? clamp(input.pitch, -1, 1) : 0;
  const roll = Number.isFinite(input.roll) ? clamp(input.roll, -1, 1) : 0;
  const blend = 1 - Math.exp(-dt * 8);
  state.pitch += (pitch - state.pitch) * blend;
  state.roll += (roll - state.roll) * blend;
  const previous = state.distance,
    oldLateral = state.lateral;
  state.speed = clamp(
    state.speed + (state.pitch >= 0 ? state.pitch * 15 : state.pitch * 33) * dt,
    0,
    MAX_SPEED,
  );
  if (state.speed < 0.035 && pitch <= 0) state.speed = 0;
  state.distance += state.speed * dt;
  state.lateral += state.roll * (2 + state.speed * 0.16) * dt;
  if (Math.abs(state.lateral) > HALF_WIDTH - 0.65) {
    state.status = 'crashed';
    state.reason = 'You drifted off the road.';
    return;
  }
  const first = Math.max(0, Math.floor((previous - 154) / 76));
  const last = Math.max(0, Math.ceil((state.distance - 146) / 76));
  for (let i = first; i <= last; i++) {
    const o = obstacle(i);
    if (state.distance >= o.s - 2.8 && previous <= o.s + 2.8) {
      const fraction = clamp(
        (o.s - previous) / Math.max(0.0001, state.distance - previous),
        0,
        1,
      );
      const playerX = oldLateral + (state.lateral - oldLateral) * fraction;
      if (Math.abs(playerX - o.x) < o.width / 2 + 0.7) {
        state.status = 'crashed';
        state.reason = 'Your platform hit a barrier.';
        return;
      }
    }
    if (previous <= o.s + 2.8 && state.distance > o.s + 2.8) state.cleared++;
  }
}
