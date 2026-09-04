import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createState } from '../lib/game/core.ts';

// Transpile in memory for Node. Production uses the normal Vite compiler.
async function moduleFromSource(name) {
  const source = await readFile(new URL(`../lib/game/${name}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from ['"]\.\/core['"]/g, `from '${new URL('../lib/game/core.ts', import.meta.url).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
globalThis.window = new EventTarget();
globalThis.HTMLElement = class extends EventTarget { closest() { return null; } };
function key(type, code) { const event = new Event(type); Object.assign(event, { code }); window.dispatchEvent(event); }
const { TiltInput } = await moduleFromSource('input');

test('keyboard directions, diagonals and release', () => {
  const input = new TiltInput();
  key('keydown','KeyW'); key('keydown','ArrowLeft');
  assert.deepEqual(input.read(performance.now()), { pitch:1, roll:-1 });
  key('keyup','KeyW'); key('keyup','ArrowLeft');
  assert.deepEqual(input.read(performance.now()), { pitch:0, roll:0 }); input.dispose();
});
test('touch supports simultaneous axes and cancel', () => {
  const input = new TiltInput(); input.touch('forward',true); input.touch('right',true);
  assert.deepEqual(input.read(performance.now()), { pitch:1, roll:1 });
  input.clear(); assert.deepEqual(input.read(performance.now()), { pitch:0, roll:0 }); input.dispose();
});
test('sensor clamping, keyboard priority, expiry and blur safety', () => {
  const input = new TiltInput(); window.dispatchEvent(new CustomEvent('roadtilt:input', { detail: { pitch:2, roll:-4 } }));
  assert.deepEqual(input.read(performance.now()), { pitch:1, roll:-1 });
  key('keydown','KeyS'); assert.deepEqual(input.read(performance.now()), { pitch:-1, roll:0 }); key('keyup','KeyS');
  assert.deepEqual(input.read(performance.now()+300), { pitch:0, roll:0 });
  window.dispatchEvent(new CustomEvent('roadtilt:input', { detail: { pitch:NaN, roll:Infinity } }));
  window.dispatchEvent(new Event('blur')); assert.deepEqual(input.read(performance.now()), { pitch:0, roll:0 });
  input.dispose(); key('keydown','KeyW'); assert.deepEqual(input.read(performance.now()), { pitch:0, roll:0 });
});
test('renderer handles all road/scenery combinations and distant coordinates', async () => {
  let paths=0;
  const ctx = new Proxy({}, { get: (_target, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args) => { for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(key)} has nonfinite geometry`); if(key==='fill')paths++; }, set: () => true });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.devicePixelRatio = 1;
  const { RoadRenderer } = await moduleFromSource('renderer');
  const renderer = new RoadRenderer({ getContext: () => ctx, getBoundingClientRect: () => ({ width:1280,height:800 }) });
  for (const topology of ['flow','serpentine','alpine']) for (const scenery of ['coast','desert','night']) for (const distance of [0,149,1200,99999]) {
    renderer.render({ ...createState(topology), distance, roll:.5,pitch:-.5,lateral:3 },scenery,10);
  }
  assert.ok(paths>1000); renderer.dispose();
});
