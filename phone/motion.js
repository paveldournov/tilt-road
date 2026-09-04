export const angleDelta = (value, neutral) =>
  ((value - neutral + 540) % 360) - 180;
export const DEFAULT_SENSITIVITY = Object.freeze({ pitch: 2, roll: 2 });
export function normalizeSensitivity(value) {
  const gain = (axis) =>
    Number.isFinite(value?.[axis])
      ? Math.max(0.5, Math.min(4, value[axis]))
      : DEFAULT_SENSITIVITY[axis];
  return { pitch: gain('pitch'), roll: gain('roll') };
}
export function tiltSample(
  beta,
  gamma,
  neutral,
  sensitivity = DEFAULT_SENSITIVITY,
) {
  if (
    !Number.isFinite(beta) ||
    !Number.isFinite(gamma) ||
    !neutral ||
    !Number.isFinite(neutral.beta) ||
    !Number.isFinite(neutral.gamma)
  )
    return null;
  const gains = normalizeSensitivity(sensitivity);
  const axis = (angle, gain) => {
    const distance = Math.abs(angle);
    return distance <= 2
      ? 0
      : Math.sign(angle) * Math.min(1, ((distance - 2) / 23) * gain);
  };
  return {
    pitch: axis(-angleDelta(beta, neutral.beta), gains.pitch),
    roll: axis(angleDelta(gamma, neutral.gamma), gains.roll),
  };
}
export function neutralFromSamples(samples) {
  if (samples.length < 8) return null;
  const last = samples.slice(-15);
  const beta = last.reduce((s, p) => s + p.beta, 0) / last.length,
    gamma = last.reduce((s, p) => s + p.gamma, 0) / last.length;
  if (
    Math.abs(beta) > 65 ||
    Math.abs(gamma) > 45 ||
    last.some(
      (p) => Math.abs(p.beta - beta) > 3 || Math.abs(p.gamma - gamma) > 3,
    )
  )
    return null;
  return { beta, gamma };
}
