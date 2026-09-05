import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  step,
  road,
  treasure,
  HALF_WIDTH,
  MAX_SPEED,
  advanceFrame,
  FixedSimulation,
} from '../lib/game/core.ts';
import { registerGameTools } from '../lib/game/webmcp.ts';
const neutral = { pitch: 0, roll: 0 };

test('fixed clock is identical at 30, 60, 90 and 144 Hz, with bounded catch-up', () => {
  const results = [30, 60, 90, 144].map((hz) => {
    const state = running(),
      clock = new FixedSimulation();
    for (let i = 0; i < hz * 5; i++) {
      const display = clock.advance(state, { pitch: 1, roll: 0.1 }, 1 / hz);
      assert.ok(display.distance <= state.distance + 1e-8);
      assert.ok(state.distance - display.distance <= MAX_SPEED / 120 + 1e-8);
    }
    return state;
  });
  for (const state of results) assert.deepEqual(state, results[0]);
  const clock = new FixedSimulation(),
    state = running();
  state.speed = MAX_SPEED;
  clock.advance(state, neutral, 100);
  assert.ok(state.distance <= MAX_SPEED * 0.25 + 1e-8);
  state.status = 'paused';
  const original = { ...state };
  clock.advance(state, { pitch: 1, roll: 1 }, 10);
  assert.deepEqual(state, original);
  const restart = running();
  assert.equal(clock.advance(restart, neutral, 0).distance, 0);
});

test('treasure trail changes gradually enough to follow at maximum speed', () => {
  for (let i = 1; i < 10000; i++) {
    const before = treasure(i - 1),
      next = treasure(i);
    const available = (next.s - before.s) / MAX_SPEED;
    assert.ok(Math.abs(next.x - before.x) < available * 5);
  }
});
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
  assert.ok(s.speed > 56 && s.speed < 61);
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

test('new cruising speed reaches its cap quickly and still brakes to a stop', () => {
  const s = running();
  advance(s, { pitch: 1, roll: 0 }, 3.5);
  assert.equal(s.speed, 96);
  advance(s, { pitch: -1, roll: 0 }, 2);
  assert.equal(s.speed, 0);
});

test('slow rendering does not slow the simulation clock', () => {
  const slow = running(),
    fast = running();
  for (const [state, hz] of [
    [slow, 10],
    [fast, 120],
  ]) {
    for (let i = 0; i < hz * 2; i++)
      advanceFrame(state, { pitch: 1, roll: 0 }, 1 / hz);
  }
  assert.ok(Math.abs(slow.speed - fast.speed) < 0.01);
  assert.ok(Math.abs(slow.distance - fast.distance) < 0.01);
});

test('frame catch-up is bounded, ignores invalid time, and preserves pause', () => {
  const s = running();
  s.speed = MAX_SPEED;
  advanceFrame(s, neutral, 10);
  assert.ok(s.distance <= MAX_SPEED * 0.25 + 0.001);
  const before = { ...s };
  for (const elapsed of [NaN, Infinity, -1, 0])
    advanceFrame(s, neutral, elapsed);
  assert.deepEqual(s, before);
  s.status = 'paused';
  advanceFrame(s, { pitch: 1, roll: 1 }, 0.25);
  assert.equal(s.distance, before.distance);
});
test('treasure is collected at maximum speed without slowing or crashing', () => {
  const s = running(),
    o = treasure(0);
  s.distance = o.s - 4;
  s.lateral = o.x;
  s.speed = MAX_SPEED;
  step(s, neutral, 0.05);
  assert.equal(s.status, 'running');
  assert.equal(s.collected, 1);
  assert.equal(s.lastCollected, 0);
  assert.equal(s.speed, MAX_SPEED);
  assert.ok(s.pickupFlash > 0);
});
test('missing treasure is harmless and does not award a pickup', () => {
  const s = running(),
    o = treasure(0);
  s.distance = o.s - 5;
  s.lateral = o.x === 0 ? 5.3 : 0;
  s.speed = 30;
  advance(s, neutral, 1);
  assert.equal(s.status, 'running');
  assert.equal(s.collected, 0);
  assert.equal(s.speed, 30);
});
test('both road edges hold the rider safely and steering back still works', () => {
  for (const direction of [-1, 1]) {
    const s = running();
    s.lateral = direction * 8.34;
    s.roll = direction;
    s.speed = MAX_SPEED;
    advance(s, { pitch: 0, roll: direction }, 5);
    assert.equal(s.status, 'running');
    assert.equal(s.lateral, direction * (HALF_WIDTH - 0.65));
    assert.equal(s.speed, MAX_SPEED);
    advance(s, { pitch: 0, roll: -direction }, 1);
    assert.ok(Math.abs(s.lateral) < HALF_WIDTH - 0.65);
  }
});
test('paused and ready runs do not advance', () => {
  for (const status of ['paused', 'ready']) {
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
test('treasures are generated continuously within reachable lanes', () => {
  for (let i = 0; i < 500; i++) {
    const o = treasure(i);
    assert.ok(Math.abs(o.x) + o.radius < HALF_WIDTH);
    assert.ok(o.s >= 90);
    if (i > 0) assert.ok(o.s > treasure(i - 1).s);
  }
});
test('stopped and sideways movement cannot collect the same gem twice', () => {
  const s = running(),
    gem = treasure(0);
  s.distance = gem.s;
  s.lateral = gem.x;
  advance(s, neutral, 3);
  assert.equal(s.collected, 1);
  advance(s, { pitch: 0, roll: 1 }, 1);
  advance(s, { pitch: 0, roll: -1 }, 1);
  assert.equal(s.collected, 1);
});
test('can steer sideways into treasure while stopped', () => {
  const s = running(),
    gem = treasure(0);
  s.distance = gem.s;
  s.lateral = gem.x + (gem.x > 0 ? -3 : 3);
  advance(s, { pitch: 0, roll: gem.x > 0 ? 1 : -1 }, 1.5);
  assert.equal(s.collected, 1);
  assert.equal(s.speed, 0);
  assert.equal(s.status, 'running');
});
test('next treasures score separately and restart resets the collection', () => {
  const s = running();
  for (let i = 0; i < 4; i++) {
    const gem = treasure(i);
    s.distance = gem.s - 4;
    s.lateral = gem.x;
    s.speed = MAX_SPEED;
    step(s, neutral, 0.05);
  }
  assert.equal(s.collected, 4);
  const reset = createState();
  assert.equal(reset.collected, 0);
  assert.equal(reset.lastCollected, -1);
  assert.equal(reset.pickupFlash, 0);
});
test('long runs remain alive even with continuous outward tilt', () => {
  const s = running();
  advance(s, { pitch: 1, roll: 1 }, 90, 60);
  assert.equal(s.status, 'running');
  assert.ok(s.distance > 5000);
  assert.ok(Number.isFinite(s.collected));
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
