import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as protocol from '../phone/protocol.js';
import {
  tiltSample,
  normalizeSensitivity,
  DEFAULT_SENSITIVITY,
} from '../phone/motion.js';

test('new default doubles the original response and preserves neutral and signs', () => {
  const neutral = { beta: 30, gamma: 0 };
  for (const direction of [-1, 1]) {
    const original = tiltSample(30 - direction * 5, direction * 5, neutral, {
      pitch: 1,
      roll: 1,
    });
    const responsive = tiltSample(30 - direction * 5, direction * 5, neutral);
    assert.equal(responsive.pitch, original.pitch * 2);
    assert.equal(responsive.roll, original.roll * 2);
    assert.equal(Math.sign(responsive.pitch), direction);
    assert.equal(Math.sign(responsive.roll), direction);
  }
  assert.deepEqual(tiltSample(31, 1, neutral), { pitch: 0, roll: 0 });
  assert.equal(tiltSample(16.5, 13.5, neutral).pitch, 1);
  assert.deepEqual(neutral, { beta: 30, gamma: 0 });
});
test('sliders affect their own axis independently and outputs remain bounded', () => {
  const neutral = { beta: 30, gamma: 0 };
  const original = tiltSample(25, 5, neutral, { pitch: 1, roll: 1 });
  const steering = tiltSample(25, 5, neutral, { pitch: 1, roll: 4 });
  const throttle = tiltSample(25, 5, neutral, { pitch: 4, roll: 1 });
  assert.equal(steering.pitch, original.pitch);
  assert.equal(steering.roll, original.roll * 4);
  assert.equal(throttle.roll, original.roll);
  assert.equal(throttle.pitch, original.pitch * 4);
  for (const gain of [0.5, 1, 2, 4]) {
    const tilt = tiltSample(0, 50, neutral, { pitch: gain, roll: gain });
    assert.ok(tilt.pitch <= 1 && tilt.pitch >= -1);
    assert.ok(tilt.roll <= 1 && tilt.roll >= -1);
  }
});
test('invalid or out-of-range stored preferences are safely normalized', () => {
  assert.deepEqual(normalizeSensitivity(null), { pitch: 2, roll: 2 });
  assert.deepEqual(normalizeSensitivity({ pitch: NaN, roll: Infinity }), {
    pitch: 2,
    roll: 2,
  });
  assert.deepEqual(normalizeSensitivity({ pitch: -100, roll: 100 }), {
    pitch: 0.5,
    roll: 4,
  });
  assert.deepEqual(normalizeSensitivity({ pitch: '4', roll: 3 }), {
    pitch: 2,
    roll: 3,
  });
  assert.equal(tiltSample(30, 5, { beta: NaN, gamma: 0 }), null);
});

async function controllerHarness(initial = null, failStorage = false) {
  let now = 100;
  const elements = new Map(),
    sent = [],
    stored = new Map(
      initial ? [['roadtilt-phone-sensitivity-v1', initial]] : [],
    );
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === 'code' ? '42' : '',
        disabled: false,
        textContent: '',
        scrollIntoView() {
          this.scrolled = true;
        },
        setAttribute(name, value) {
          this[name] = value;
        },
      });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() {
      Socket.current = this;
    }
    send(data) {
      sent.push(JSON.parse(data));
    }
    close() {}
  }
  const context = {
    ...protocol,
    tiltSample,
    normalizeSensitivity,
    DEFAULT_SENSITIVITY,
    document: { getElementById: element, hidden: false, addEventListener() {} },
    window: {
      isSecureContext: true,
      DeviceOrientationEvent: {},
      addEventListener() {},
    },
    DeviceOrientationEvent: {},
    screen: { orientation: { angle: 0, addEventListener() {} } },
    location: { host: '127.0.0.1:8787' },
    navigator: {},
    performance: { now: () => now },
    WebSocket: Socket,
    setInterval() {},
    setTimeout() {},
    localStorage: {
      getItem(key) {
        if (failStorage) throw new Error('blocked');
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        if (failStorage) throw new Error('blocked');
        stored.set(key, value);
      },
    },
  };
  const source = (
    await readFile(new URL('../phone/controller.js', import.meta.url), 'utf8')
  ).replace(/import[\s\S]*?from ['"]\.\/(motion|protocol)\.js['"];\s*/g, '');
  vm.runInNewContext(source, context);
  return {
    element,
    sent,
    stored,
    context,
    Socket,
    advance(ms) {
      now += ms;
    },
  };
}

async function pairAndEnable(h) {
  h.element('join').onclick();
  h.Socket.current.onopen();
  h.Socket.current.onmessage({ data: JSON.stringify({ type: 'paired' }) });
  await h.element('enable').onclick();
}

test('blocked transmission cannot claim streaming or send a start, but zero and meters still work', async () => {
  const h = await controllerHarness();
  await pairAndEnable(h);
  assert.equal(h.element('pairing').hidden, true);
  assert.equal(h.element('intro').hidden, true);
  h.context.orientation({ beta: 30, gamma: 0 });
  h.element('calibrate').onclick();
  h.Socket.current.bufferedAmount = 5000;
  h.context.orientation({ beta: 20, gamma: 10 });
  const before = h.sent.length;
  assert.equal(h.context.transmit(), false);
  assert.equal(h.element('start').disabled, true);
  assert.equal(h.element('motion-state').textContent, 'SIGNAL BLOCKED');
  h.element('start').onclick();
  assert.equal(h.sent.length, before);
  h.element('calibrate').onclick();
  assert.equal(h.element('pitch').textContent, '0%');
  assert.equal(h.element('roll').textContent, '0%');
  h.Socket.current.bufferedAmount = 0;
  h.context.orientation({ beta: 18, gamma: 15 });
  assert.equal(h.context.transmit(), true);
  assert.equal(h.element('start').disabled, false);
  h.advance(400);
  h.context.transmit();
  assert.equal(h.sent.at(-1).ageMs, 400);
  h.advance(100);
  assert.equal(h.context.transmit(), false);
});
test('phone sliders restore, preview, apply independently, pause once and retain calibration', async () => {
  const h = await controllerHarness(JSON.stringify({ pitch: 1.5, roll: 3 }));
  assert.equal(Number(h.element('pitch-sensitivity').value), 1.5);
  assert.equal(h.element('roll-gain').textContent, '3.0×');
  h.element('join').onclick();
  h.Socket.current.onopen();
  h.Socket.current.onmessage({ data: JSON.stringify({ type: 'paired' }) });
  await h.element('enable').onclick();
  for (let i = 0; i < 15; i++) h.context.orientation({ beta: 30, gamma: 0 });
  h.element('calibrate').onclick();
  const before = h.sent.length;
  h.element('roll-sensitivity').value = '4';
  h.element('roll-sensitivity').oninput();
  assert.equal(h.element('roll-gain').textContent, '4.0×');
  assert.equal(h.sent.length, before);
  h.element('roll-sensitivity').onchange();
  assert.deepEqual(h.sent.at(-1), { type: 'command', action: 'pause' });
  assert.equal(h.sent.length, before + 1);
  assert.match(h.element('message').textContent, /Calibration kept/);
  assert.equal(h.element('start').disabled, false);
  assert.deepEqual(JSON.parse(h.stored.get('roadtilt-phone-sensitivity-v1')), {
    pitch: 1.5,
    roll: 4,
  });
  h.context.orientation({ beta: 25, gamma: 5 });
  h.context.transmit();
  const input = h.sent.at(-1),
    expected = tiltSample(
      25,
      5,
      { beta: 30, gamma: 0 },
      { pitch: 1.5, roll: 4 },
    );
  assert.equal(input.pitch, expected.pitch);
  assert.equal(input.roll, expected.roll);
  h.element('reset-sensitivity').onclick();
  assert.equal(Number(h.element('pitch-sensitivity').value), 2);
  assert.equal(Number(h.element('roll-sensitivity').value), 2);
});

test('one reading calibrates immediately without a timer or server acknowledgement', async () => {
  const h = await controllerHarness();
  await pairAndEnable(h);
  h.context.orientation({ beta: 30, gamma: 12 });
  h.element('calibrate').onclick();
  assert.equal(h.element('motion-state').textContent, 'CALIBRATED');
  assert.equal(h.element('pitch').textContent, '0%');
  assert.equal(h.element('roll').textContent, '0%');
  assert.equal(h.element('pitch-meter').value, 0);
  assert.equal(h.element('roll-meter').value, 0);
  assert.equal(h.element('start').disabled, false);
  assert.equal(h.element('calibrate').disabled, false);
  assert.equal(h.sent.filter((m) => m.type === 'suspend').length, 0);
  assert.match(h.element('calibration-message').textContent, /Zero set/);
  assert.equal(h.element('motion-controls').scrolled, true);

  // Measurements update on the sensor event, independently of transmission.
  const before = h.sent.length;
  h.Socket.current.bufferedAmount = 5000;
  h.context.orientation({ beta: 20, gamma: 20 });
  assert.notEqual(h.element('pitch').textContent, '0%');
  assert.notEqual(h.element('roll').textContent, '0%');
  assert.equal(h.sent.length, before);
  h.element('calibrate').onclick();
  assert.equal(h.element('pitch').textContent, '0%');
  assert.equal(h.element('roll').textContent, '0%');
});

test('current position becomes zero even when upright or recently moving', async () => {
  const h = await controllerHarness();
  await pairAndEnable(h);
  for (const [beta, gamma] of [
    [20, 0],
    [60, 20],
    [88, 80],
    [120, -80],
  ]) {
    h.context.orientation({ beta, gamma });
    h.element('calibrate').onclick();
    assert.equal(h.element('pitch').textContent, '0%');
    assert.equal(h.element('roll').textContent, '0%');
    assert.equal(h.element('start').disabled, false);
  }
});

test('missing readings report an immediate error instead of waiting forever', async () => {
  const h = await controllerHarness();
  await pairAndEnable(h);
  h.element('calibrate').onclick();
  assert.equal(h.element('start').disabled, true);
  assert.equal(h.element('calibrate').disabled, false);
  assert.match(
    h.element('calibration-message').textContent,
    /No motion reading yet/,
  );
  h.context.orientation({ beta: 30, gamma: 0 });
  h.element('calibrate').onclick();
  assert.equal(h.element('start').disabled, false);
});

test('pauses preserve zero and visible percentages but stale or hidden input cannot start flight', async () => {
  const h = await controllerHarness();
  await pairAndEnable(h);
  h.context.orientation({ beta: 30, gamma: 0 });
  h.element('calibrate').onclick();
  h.advance(600);
  h.context.transmit();
  assert.equal(h.element('start').disabled, true);
  assert.equal(h.element('pitch').textContent, '0%');
  const before = h.sent.length;
  h.element('start').onclick();
  assert.equal(h.sent.length, before);
  h.Socket.current.onmessage({
    data: JSON.stringify({ type: 'suspended', reason: 'Motion stream lost.' }),
  });
  h.context.orientation({ beta: 25, gamma: 5 });
  assert.notEqual(h.element('pitch').textContent, '0%');
  assert.notEqual(h.element('roll').textContent, '0%');
  h.context.transmit();
  assert.equal(h.element('start').disabled, false);
  h.context.document.hidden = true;
  h.context.transmit();
  assert.equal(h.element('start').disabled, true);
  const hidden = h.sent.length;
  h.element('start').onclick();
  assert.equal(h.sent.length, hidden);
});

test('phone document puts live measurements and flight buttons before sensitivity', async () => {
  const html = await readFile(
    new URL('../phone/controller.html', import.meta.url),
    'utf8',
  );
  assert.ok(
    html.indexOf('class="telemetry"') <
      html.indexOf('class="sensitivity-settings"'),
  );
  assert.ok(
    html.indexOf('class="flight-buttons"') <
      html.indexOf('class="sensitivity-settings"'),
  );
  assert.equal((html.match(/id="pitch"/g) || []).length, 1);
});
test('phone sliders work with malformed preferences or unavailable browser storage', async () => {
  for (const [initial, failStorage] of [
    ['broken JSON', false],
    [null, true],
  ]) {
    const h = await controllerHarness(initial, failStorage);
    assert.equal(Number(h.element('roll-sensitivity').value), 2);
    h.element('pitch-sensitivity').value = '3';
    h.element('pitch-sensitivity').onchange();
    assert.equal(h.element('pitch-gain').textContent, '3.0×');
  }
});
