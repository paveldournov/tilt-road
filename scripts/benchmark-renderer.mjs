import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createState } from '../lib/game/core.ts';

// CPU-only benchmark. Canvas commands are counted, not rasterized: these
// numbers are not browser FPS or a measure of GPU drawing performance.
const source = await readFile(
  new URL('../lib/game/renderer.ts', import.meta.url),
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
  );
const { RoadRenderer } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);
globalThis.window = { devicePixelRatio: 1.5 };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
let fills = 0;
const noop = () => {};
const ctx = new Proxy(
  {},
  {
    get: (_target, key) =>
      key === 'fill'
        ? () => {
            fills++;
          }
        : key === 'createLinearGradient'
          ? () => ({ addColorStop: noop })
          : noop,
    set: () => true,
  },
);
const renderer = new RoadRenderer({
  getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 1280, height: 900 }),
});
const times = [];
for (let pass = 0; pass < 4; pass++) {
  fills = 0;
  const start = performance.now();
  for (const topology of ['flow', 'serpentine', 'alpine']) {
    for (const scenery of ['coast', 'desert', 'night']) {
      const state = createState(topology);
      for (let frame = 0; frame < 90; frame++) {
        state.distance = 1000 + frame * 1.5;
        renderer.render(state, scenery, frame / 60);
      }
    }
  }
  if (pass) times.push((performance.now() - start) / 810);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    cpuMsPerFrame: +times[1].toFixed(3),
    fillsPerFrame: Math.round(fills / 810),
    viewport: '1280x900',
    rasterization: false,
  }),
);
renderer.dispose();
