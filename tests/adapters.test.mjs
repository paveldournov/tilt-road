import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createState } from '../lib/game/core.ts';

// Transpile in memory for Node. Production uses the normal Vite compiler.
async function moduleFromSource(name) {
  const source = await readFile(
    new URL(`../lib/game/${name}.ts`, import.meta.url),
    'utf8',
  );
  const js = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(
      /from ['"]\.\/core['"]/g,
      `from '${new URL('../lib/game/core.ts', import.meta.url).href}'`,
    )
    .replace(
      /from ['"]\.\.\/\.\.\/phone\/protocol\.js['"]/g,
      `from '${new URL('../phone/protocol.js', import.meta.url).href}'`,
    );
  return import(
    `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  );
}
globalThis.window = new EventTarget();
globalThis.HTMLElement = class extends EventTarget {
  closest() {
    return null;
  }
};
function key(type, code) {
  const event = new Event(type);
  Object.assign(event, { code });
  window.dispatchEvent(event);
}
const { TiltInput } = await moduleFromSource('input');

test('game phone receiver rejects stale starts and pauses on missing packets', async (t) => {
  let now = 100,
    tick;
  const sockets = [],
    inputs = [],
    commands = [],
    lost = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() {
      sockets.push(this);
    }
    close() {
      this.onclose?.();
    }
    send() {}
    receive(data) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => {
    globalThis.WebSocket = previous;
  });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (fn) => {
    tick = fn;
    return 1;
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const { PhoneClient } = await moduleFromSource('phone-client');
  const client = new PhoneClient({
    info() {},
    status() {},
    input: (v) => inputs.push(v),
    command: (v) => commands.push(v),
    lost: () => lost.push(true),
    state: () => ({ status: 'running', speed: 20 }),
  });
  client.connect();
  const socket = sockets[0];
  socket.receive({ type: 'command', action: 'start' });
  assert.equal(commands.length, 0);
  socket.receive({ type: 'input', pitch: 0.4, roll: -0.2 });
  assert.deepEqual(inputs[0], { pitch: 0.4, roll: -0.2, at: now });
  socket.receive({ type: 'command', action: 'start' });
  assert.deepEqual(commands, ['start']);
  now += 501;
  tick();
  assert.equal(lost.length, 1);
  socket.receive({ type: 'command', action: 'restart' });
  assert.deepEqual(commands, ['start']);
  socket.receive({ type: 'command', action: 'pause' });
  assert.deepEqual(commands, ['start', 'pause']);
  socket.receive(null);
  client.disconnect();
  assert.equal(lost.length, 2);
});

test('keyboard directions, diagonals and release', () => {
  const input = new TiltInput();
  key('keydown', 'KeyW');
  key('keydown', 'ArrowLeft');
  assert.deepEqual(input.read(performance.now()), { pitch: 1, roll: -1 });
  key('keyup', 'KeyW');
  key('keyup', 'ArrowLeft');
  assert.deepEqual(input.read(performance.now()), { pitch: 0, roll: 0 });
  input.dispose();
});

test('sensor adapter preserves sample age instead of refreshing it on delivery', (t) => {
  t.mock.method(performance, 'now', () => 1000);
  const input = new TiltInput();
  window.dispatchEvent(
    new CustomEvent('roadtilt:input', {
      detail: { pitch: 1, roll: -1, at: 600 },
    }),
  );
  assert.deepEqual(input.read(1000), { pitch: 1, roll: -1 });
  assert.deepEqual(input.read(1100), { pitch: 0, roll: 0 });
  input.dispose();
});
test('touch supports simultaneous axes and cancel', () => {
  const input = new TiltInput();
  input.touch('forward', true);
  input.touch('right', true);
  assert.deepEqual(input.read(performance.now()), { pitch: 1, roll: 1 });
  input.clear();
  assert.deepEqual(input.read(performance.now()), { pitch: 0, roll: 0 });
  input.dispose();
});
test('sensor clamping, keyboard priority, expiry and blur safety', () => {
  const input = new TiltInput();
  window.dispatchEvent(
    new CustomEvent('roadtilt:input', { detail: { pitch: 2, roll: -4 } }),
  );
  assert.deepEqual(input.read(performance.now()), { pitch: 1, roll: -1 });
  key('keydown', 'KeyS');
  assert.deepEqual(input.read(performance.now()), { pitch: -1, roll: 0 });
  key('keyup', 'KeyS');
  assert.deepEqual(input.read(performance.now() + 501), { pitch: 0, roll: 0 });
  window.dispatchEvent(
    new CustomEvent('roadtilt:input', {
      detail: { pitch: NaN, roll: Infinity },
    }),
  );
  window.dispatchEvent(new Event('blur'));
  assert.deepEqual(input.read(performance.now()), { pitch: 0, roll: 0 });
  input.dispose();
  key('keydown', 'KeyW');
  assert.deepEqual(input.read(performance.now()), { pitch: 0, roll: 0 });
});
test('board lowers the edge in the steering direction', async () => {
  let path = [],
    deck = [];
  const properties = {};
  const ctx = new Proxy(properties, {
    get(target, key) {
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'beginPath')
        return () => {
          path = [];
        };
      if (key === 'moveTo' || key === 'lineTo')
        return (x, y) => path.push({ x, y });
      if (key === 'fill')
        return () => {
          if (target.fillStyle === '#101f2b')
            deck = path.map((p) => ({ ...p }));
        };
      return key in target ? target[key] : () => {};
    },
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.devicePixelRatio = 1;
  const { RoadRenderer } = await moduleFromSource('renderer');
  const renderer = new RoadRenderer({
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
  });
  for (const roll of [-1, 0, 1]) {
    renderer.render({ ...createState(), roll }, 'coast', 0);
    assert.equal(deck.length, 6);
    const [left, right] = deck;
    assert.ok(left.x < right.x);
    // Canvas Y grows downward. Positive roll means the right edge is lower.
    assert.equal(Math.sign(right.y - left.y), roll);
  }
  renderer.dispose();
});

test('renderer handles all road/scenery combinations and distant coordinates', async () => {
  let paths = 0;
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'createLinearGradient'
          ? () => ({ addColorStop() {} })
          : (...args) => {
              for (const arg of args)
                if (typeof arg === 'number')
                  assert.ok(
                    Number.isFinite(arg),
                    `${String(key)} has nonfinite geometry`,
                  );
              if (key === 'fill') paths++;
            },
      set: () => true,
    },
  );
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.devicePixelRatio = 1;
  const { RoadRenderer } = await moduleFromSource('renderer');
  const renderer = new RoadRenderer({
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
  });
  for (const topology of ['flow', 'serpentine', 'alpine'])
    for (const scenery of ['coast', 'desert', 'night'])
      for (const distance of [0, 149, 1200, 99999]) {
        renderer.render(
          {
            ...createState(topology),
            distance,
            roll: 0.5,
            pitch: -0.5,
            lateral: 3,
          },
          scenery,
          10,
        );
      }
  assert.ok(paths > 1000);
  renderer.dispose();
});

test('renderer retains geometry between frames and bounds caches on long runs', async () => {
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'createLinearGradient'
          ? () => ({ addColorStop() {} })
          : () => {},
      set: () => true,
    },
  );
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const { RoadRenderer } = await moduleFromSource('renderer');
  const renderer = new RoadRenderer({
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
  });
  const state = createState();
  renderer.render(state, 'coast', 0);
  const first = renderer.chunks.get('road:-1:false');
  renderer.render(state, 'coast', 1 / 60);
  assert.equal(renderer.chunks.get('road:-1:false'), first);
  for (let i = 0; i < 100; i++) {
    state.distance = i * 300;
    renderer.render(state, 'coast', i);
    assert.ok(renderer.diagnostics.chunks <= 42);
    assert.ok(renderer.projectionPool.length < 1800);
  }
  renderer.configure({ bank: NaN, reducedMotion: true });
  renderer.render(createState('alpine'), 'night', 101);
  assert.ok(Number.isFinite(renderer.roll));
  assert.notEqual(renderer.chunks.get('road:-1:false'), first);
  renderer.dispose();
});
