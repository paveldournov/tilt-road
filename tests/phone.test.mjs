import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { attachRelay } from '../scripts/phone/relay.mjs';
import { ensureCertificates } from '../scripts/phone/certificates.mjs';
import { tiltSample, neutralFromSamples, angleDelta } from '../phone/motion.js';

test('phone angles map forward/back and left/right with neutral and dead zone', () => {
  const neutral = { beta: 30, gamma: 0 };
  assert.deepEqual(tiltSample(30, 0, neutral), { pitch: 0, roll: 0 });
  assert.deepEqual(tiltSample(29, 1, neutral), { pitch: 0, roll: 0 });
  assert.equal(tiltSample(5, 0, neutral).pitch, 1);
  assert.equal(tiltSample(55, 0, neutral).pitch, -1);
  assert.equal(tiltSample(30, 25, neutral).roll, 1);
  assert.equal(tiltSample(30, -25, neutral).roll, -1);
  assert.equal(tiltSample(85, 0, neutral).pitch, -1);
  assert.equal(tiltSample(NaN, 0, neutral), null);
  assert.equal(angleDelta(-179, 179), 2);
});
test('calibration needs stable, supported samples', () => {
  const samples = Array.from({ length: 15 }, () => ({ beta: 30, gamma: 5 }));
  assert.deepEqual(neutralFromSamples(samples), { beta: 30, gamma: 5 });
  assert.equal(neutralFromSamples(samples.slice(0, 3)), null);
  assert.equal(neutralFromSamples([...samples, { beta: 60, gamma: 5 }]), null);
});

function peer(url, options = {}) {
  const ws = new WebSocket(url, options),
    queue = [],
    waiters = [];
  ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());
    const at = waiters.findIndex((w) => w.type === data.type);
    if (at >= 0) {
      const [w] = waiters.splice(at, 1);
      clearTimeout(w.timer);
      w.resolve(data);
    } else queue.push(data);
  });
  return {
    ws,
    opened: once(ws, 'open'),
    send: (data) => ws.send(JSON.stringify(data)),
    receive(type) {
      const at = queue.findIndex((m) => m.type === type);
      if (at >= 0) return Promise.resolve(queue.splice(at, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          type,
          resolve,
          timer: setTimeout(() => {
            const i = waiters.indexOf(waiter);
            if (i >= 0) waiters.splice(i, 1);
            reject(new Error(`Timed out waiting for ${type}`));
          }, 2000),
        };
        waiters.push(waiter);
      });
    },
  };
}

test('TLS relay pairs, streams, pauses on loss, and rejects unauthorized control', async (t) => {
  const certs = ensureCertificates(resolve('.local/phone-tests'), []);
  const plain = http.createServer((req, res) => res.end('ok')),
    tls = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) =>
      res.end('ok'),
    );
  plain.listen(0, '127.0.0.1');
  tls.listen(0, '127.0.0.1');
  await Promise.all([once(plain, 'listening'), once(tls, 'listening')]);
  const port = plain.address().port,
    securePort = tls.address().port,
    origin = `https://127.0.0.1:${securePort}`;
  const relay = attachRelay(plain, tls, {
    origins: ['http://localhost:3000'],
    phoneOrigins: [origin],
    info: { setupUrl: 'test', controllerUrl: 'test', fingerprint: 'test' },
    staleMs: 150,
  });
  t.after(async () => {
    relay.close();
    await Promise.all([
      new Promise((r) => plain.close(r)),
      new Promise((r) => tls.close(r)),
    ]);
  });
  const game = peer(`ws://127.0.0.1:${port}/game`, {
    origin: 'http://localhost:3000',
  });
  await game.opened;
  const room = await game.receive('room');
  assert.match(room.code, /^[1-9]\d$/);
  const phone = peer(`wss://127.0.0.1:${securePort}/phone`, {
    origin,
    ca: certs.ca,
  });
  await phone.opened;
  phone.send({ type: 'pair', code: room.code });
  await phone.receive('paired');
  await game.receive('paired');
  phone.send({ type: 'command', action: 'start' });
  assert.match((await phone.receive('error')).message, /Calibrate/);
  phone.send({ type: 'input', pitch: 0.6, roll: -0.4, seq: 0 });
  assert.deepEqual(await game.receive('input'), {
    type: 'input',
    pitch: 0.6,
    roll: -0.4,
  });
  phone.send({ type: 'command', action: 'start' });
  assert.equal((await game.receive('command')).action, 'start');
  game.send({ type: 'state', status: 'running', speed: 10 });
  assert.equal((await phone.receive('state')).speed, 36);
  game.send({ type: 'state', status: 'running', speed: 96 });
  assert.equal((await phone.receive('state')).speed, 346);
  assert.match((await game.receive('suspended')).reason, /lost/);
  await phone.receive('suspended');
  const second = peer(`wss://127.0.0.1:${securePort}/phone`, {
    origin,
    ca: certs.ca,
  });
  await second.opened;
  second.send({ type: 'pair', code: room.code });
  assert.match((await second.receive('error')).message, /already/);
  const bad = peer(`wss://127.0.0.1:${securePort}/phone`, {
    origin,
    ca: certs.ca,
  });
  await bad.opened;
  bad.send({ type: 'pair', code: '00' });
  assert.match((await bad.receive('error')).message, /not found/);
  phone.send({ type: 'input', pitch: 9, roll: -9, seq: 1 });
  assert.deepEqual(await game.receive('input'), {
    type: 'input',
    pitch: 1,
    roll: -1,
  });
  const closed = once(phone.ws, 'close');
  phone.send({ type: 'input', pitch: 0, roll: 0, seq: 1 });
  assert.equal((await closed)[0], 1008);
  await game.receive('unpaired');
  for (const [url, options] of [
    [`ws://127.0.0.1:${port}/game`, { origin: 'https://evil.example' }],
    [`ws://127.0.0.1:${port}/phone`, { origin }],
  ]) {
    const forbidden = new WebSocket(url, options);
    forbidden.on('error', () => {});
    const [error] = await once(forbidden, 'error');
    assert.match(error.message, /403/);
  }
  const codes = new Set([room.code]);
  for (let i = 0; i < 7; i++) {
    const extra = peer(`ws://127.0.0.1:${port}/game`, {
      origin: 'http://localhost:3000',
    });
    await extra.opened;
    const next = await extra.receive('room');
    assert.match(next.code, /^[1-9]\d$/);
    assert.ok(!codes.has(next.code), 'Every open game must have a unique code');
    codes.add(next.code);
  }
  const legacy = peer(`wss://127.0.0.1:${securePort}/phone`, {
    origin,
    ca: certs.ca,
  });
  await legacy.opened;
  legacy.send({ type: 'pair', code: '123456' });
  assert.match((await legacy.receive('error')).message, /not found/);
  game.ws.close();
});
