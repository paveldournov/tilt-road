// Shared by Safari, the local relay, and the game. No DOM or transport dependencies.
export const MOTION_STALE_MS = 500;
export const MOTION_INTERVAL_MS = 33;
export const MAX_BUFFER_BYTES = 4096;

/** @param {number} age */
export function freshMotion(age) {
  return Number.isFinite(age) && age >= 0 && age < MOTION_STALE_MS;
}
