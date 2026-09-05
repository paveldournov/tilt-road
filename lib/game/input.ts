import { freshMotion } from '../../phone/protocol.js';
import { clamp, type Tilt } from './core';

/** Transport-independent input. Sensor packets are normalized to [-1, 1]. */
export class TiltInput {
  private keys = new Set<string>();
  private buttons = new Set<string>();
  private sensor: (Tilt & { at: number }) | null = null;
  private down = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLElement &&
      e.target.closest(
        'button,input,[role="dialog"],[role="slider"],[role="switch"],[role="combobox"],[role="listbox"]',
      )
    )
      return;
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(e.code)
    ) {
      e.preventDefault();
      this.keys.add(e.code);
    }
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => this.clear();
  private sample = (e: Event) => {
    const data = (e as CustomEvent<Tilt & { at?: number }>).detail;
    if (data && Number.isFinite(data.pitch) && Number.isFinite(data.roll))
      this.sensor = {
        pitch: clamp(data.pitch, -1, 1),
        roll: clamp(data.roll, -1, 1),
        at: Number.isFinite(data.at)
          ? Math.min(performance.now(), data.at!)
          : performance.now(),
      };
  };
  constructor() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
    window.addEventListener('roadtilt:input', this.sample);
  }
  touch(key: string, down: boolean) {
    if (down) this.buttons.add(key);
    else this.buttons.delete(key);
  }
  clear() {
    this.keys.clear();
    this.buttons.clear();
    this.sensor = null;
  }
  read(now: number): Tilt {
    const active = (codes: string[], button: string) =>
      codes.some((k) => this.keys.has(k)) || this.buttons.has(button) ? 1 : 0;
    if (this.keys.size || this.buttons.size)
      return {
        pitch:
          active(['KeyW', 'ArrowUp'], 'forward') -
          active(['KeyS', 'ArrowDown'], 'back'),
        roll:
          active(['KeyD', 'ArrowRight'], 'right') -
          active(['KeyA', 'ArrowLeft'], 'left'),
      };
    // Keyboard overrides the sensor. A stale packet can never latch a tilt on.
    return this.sensor && freshMotion(now - this.sensor.at)
      ? { pitch: this.sensor.pitch, roll: this.sensor.roll }
      : { pitch: 0, roll: 0 };
  }
  dispose() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('roadtilt:input', this.sample);
  }
}
