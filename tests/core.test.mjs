import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  step,
  road,
  obstacle,
  MAX_SPEED,
} from '../lib/game/core.ts';
import { registerGameTools } from '../lib/game/webmcp.ts';
const neutral = { pitch: 0, roll: 0 };
function running() {
  const s = createState();
  s.status = 'running';
  return s;
}
function advance(s, input, seconds, hz = 120) {
  for (let i = 0; i < seconds * hz; i++) step(s, input, 1 / hz);
}
test('starts stationary and ready', () => {
  const s = createState();
  step(s, { pitch: 1, roll: 1 }, 0.05);
  assert.equal(s.speed, 0);
  assert.equal(s.distance, 0);
});
test('forward tilt accelerates and neutral coasts', () => {
  const s = running();
  advance(s, { pitch: 1, roll: 0 }, 2);
  assert.ok(s.speed > 26 && s.speed < 31);
  advance(s, neutral, 1);
  const speed = s.speed;
  advance(s, neutral, 0.5);
  assert.ok(Math.abs(speed - s.speed) < 0.01);
  assert.ok(s.distance > 0);
});
test('backward tilt brakes to zero, never reverse', () => {
  const s = running();
  s.speed = 40;
  advance(s, { pitch: -1, roll: 0 }, 3);
  assert.equal(s.speed, 0);
  const distance = s.distance;
  advance(s, { pitch: -1, roll: 0 }, 1);
  assert.equal(s.distance, distance);
});
test('right and left lean steer in corresponding direction', () => {
  for (const roll of [-1, 1]) {
    const s = running();
    advance(s, { pitch: 0, roll }, 1);
    assert.equal(Math.sign(s.lateral), roll);
  }
});
test('speed is capped', () => {
  const s = running();
  s.speed = MAX_SPEED;
  s.pitch = 1;
  step(s, { pitch: 1, roll: 0 }, 0.05);
  assert.equal(s.speed, MAX_SPEED);
});
test('collision triggers at speed without tunneling', () => {
  const s = running(),
    o = obstacle(0);
  s.distance = o.s - 4;
  s.lateral = o.x;
  s.speed = MAX_SPEED;
  step(s, neutral, 0.05);
  assert.equal(s.status, 'crashed');
  assert.match(s.reason, /barrier/);
});
test('safe passage increments cleared once', () => {
  const s = running(),
    o = obstacle(0);
  s.distance = o.s - 5;
  s.lateral = o.x === 0 ? 5.3 : 0;
  s.speed = 30;
  advance(s, neutral, 1);
  assert.equal(s.status, 'running');
  assert.equal(s.cleared, 1);
});
test('road departure ends the run', () => {
  const s = running();
  s.lateral = 8.34;
  s.roll = 1;
  step(s, { pitch: 0, roll: 1 }, 0.05);
  assert.equal(s.status, 'crashed');
  assert.match(s.reason, /off the road/);
});
test('paused and crashed runs do not advance', () => {
  for (const status of ['paused', 'crashed']) {
    const s = running();
    s.status = status;
    s.speed = 40;
    const original = { ...s };
    advance(s, { pitch: 1, roll: 1 }, 2);
    assert.deepEqual(s, original);
  }
});
test('nonfinite inputs cannot corrupt state', () => {
  const s = running();
  step(s, { pitch: NaN, roll: Infinity }, 0.01);
  step(s, neutral, NaN);
  for (const key of ['speed', 'lateral', 'distance', 'pitch', 'roll'])
    assert.ok(Number.isFinite(s[key]));
});
test('physics remains comparable across frame rates', () => {
  const a = running(),
    b = running();
  advance(a, { pitch: 1, roll: 0 }, 1, 60);
  advance(b, { pitch: 1, roll: 0 }, 1, 144);
  assert.ok(Math.abs(a.speed - b.speed) < 0.15);
  assert.ok(Math.abs(a.distance - b.distance) < 0.2);
});
test('all roads are finite, continuous and endless', () => {
  for (const mode of ['flow', 'serpentine', 'alpine'])
    for (let s = 0; s < 100000; s += 79) {
      const a = road(s, mode),
        b = road(s + 0.01, mode);
      for (const key of ['x', 'y', 'bank']) {
        assert.ok(Number.isFinite(a[key]));
        assert.ok(Math.abs(a[key] - b[key]) < 0.02);
      }
    }
});
test('generated obstacles always leave a passable lane', () => {
  for (let i = 0; i < 500; i++) {
    const o = obstacle(i);
    assert.ok(
      [-5.3, 0, 5.3].some((x) => Math.abs(x - o.x) > o.width / 2 + 0.7),
    );
    assert.ok(o.s >= 150);
  }
});
test('WebMCP contracts configure, read back and reject invalid data', () => {
  const registry = new Map();
  let state = { ...createState(), scenery: 'coast' };
  const signals = [];
  const dispose = registerGameTools(
    {
      registerTool: (tool, opts) => {
        registry.set(tool.name, tool);
        signals.push(opts.signal);
      },
    },
    () => state,
    (topology, scenery) => {
      state = { ...createState(topology), scenery };
    },
  );
  assert.equal(registry.size, 2);
  assert.equal(
    registry.get('read_flight_state').annotations.readOnlyHint,
    true,
  );
  const configure = registry.get('configure_flight');
  assert.equal(configure.annotations.readOnlyHint, false);
  assert.equal(
    configure.execute({ topology: 'alpine', scenery: 'night' }).topology,
    'alpine',
  );
  assert.equal(registry.get('read_flight_state').execute({}).scenery, 'night');
  const previous = { ...state };
  assert.throws(() => configure.execute({ topology: 'bad', scenery: 'night' }));
  assert.deepEqual(state, previous);
  dispose();
  assert.ok(signals.every((s) => s.aborted));
});
