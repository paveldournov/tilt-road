# RoadTilt

A first-person endless hover-road prototype built with React and a dependency-free software 3D canvas renderer. Gameplay and scenery are local and procedural.

## Run

Requires Node 22.13+ and npm. Run `npm install`, then `npm run dev`. Open the URL printed by the server. `npm run build` produces the production site.

## Controls

- Enter or Start flying: start/resume. The platform begins at rest.
- W / Up: lean forward and accelerate (maximum 346 km/h).
- A / D or Left / Right: lean and move across the road.
- S / Down: brake to a complete stop. There is no reverse.
- Release controls: level the deck and coast.
- Space / Escape: pause or resume. R: restart.
- Switching tabs or losing focus pauses automatically.
- Touch flight buttons appear on narrow screens.

Open the settings icon to choose Flow (gentle curves), Serpentine (tight linked turns), or Alpine (rolling elevation and banks). Road changes reset the run. Scenery choices are Pacific dusk, Red canyon and Neon midnight. Opening settings pauses an active flight; resume when finished. Camera banking can be reduced to zero, and treasure sounds are optional (off by default). These preferences stay in this browser. The system's reduced-motion preference disables banking, speed-based field-of-view changes, and pickup bursts.

Collect the floating gold gems to increase your treasure counter. Each gem counts once and disappears when collected; missed gems carry no penalty. There are no crashes: road edges keep your platform safely on the track without slowing it down. Restarting or changing road resets the treasure count. Best distance is stored only in this browser. The forward view follows the road tangent automatically; steering controls your lateral position. This is an arcade prototype, not a physical vehicle simulator.

## Future motion-device input

An iPhone controller and local HTTPS/WebSocket server are now available. See [PHONE-CONTROLLER.md](PHONE-CONTROLLER.md) for setup, pairing, certificate trust, and safety details. Start it with `npm run phone:server`; in the game click **Connect iPhone**.

`lib/game/input.ts` separates transport from simulation. A local serial/WebSocket bridge can dispatch normalized samples:

```js
window.dispatchEvent(
  new CustomEvent('roadtilt:input', {
    detail: { pitch: 0.6, roll: -0.2 },
  }),
);
```

Pitch: -1 full brake, 0 neutral, +1 full acceleration. Roll: -1 left, +1 right. Send at 20–60 Hz. Values are clamped; malformed packets are ignored. An optional `at` field is the sample's timestamp in the game's `performance.now()` clock; preserve its age when adapting another clock. Keyboard/touch takes priority, and packets expire after 500 ms. The generic adapter levels the deck and coasts; it does **not** automatically brake. The iPhone receiver also pauses flight on signal loss. Pause clears input. Arduino calibration, authentication, network/serial transport and physical emergency stops are not implemented yet.

## Verification

`npm test` covers physics, safe boundaries, treasure collection at maximum speed, no duplicate pickups, continuous generation, input handling and optional WebMCP contracts. `npm run typecheck` checks TypeScript.

Optional WebMCP tools read flight state and configure/reset a flight. They are feature-detected; contract tests use a mock registry.

Open `http://localhost:3000/?stats=1` for rolling render FPS, p95 CPU drawing time, and geometry counts. These timings include canvas command submission, not asynchronous GPU/compositor time. FPS is observed render cadence, not a guarantee. `node --experimental-strip-types scripts/benchmark-renderer.mjs` is a repeatable CPU-only benchmark with a mock canvas; do not interpret it as browser FPS.

## Architecture

- `lib/game/core.ts`: deterministic road, smooth treasure trails, physics and a 120 Hz fixed-step accumulator with interpolation. Catch-up is limited to 250 ms per visible frame.
- `lib/game/runtime.ts`: animation lifecycle, simulation/render scheduling, pickups, record persistence and optional diagnostics.
- `lib/game/telemetry.ts` / `components/flight-hud.tsx`: isolated 10 Hz numeric subscriptions and render-rate tilt instrumentation. Menus do not subscribe to telemetry.
- `lib/game/input.ts`: keyboard/touch and sensor packet adapter.
- `phone/protocol.js`: shared freshness and transport limits for Safari, relay and receiver. Local sample age is preserved across forwarding; clocks are not synchronized, so network transit latency is not measured.
- `lib/game/renderer.ts`: retained 100 m road chunks, cached scenery, distant-detail reduction, pooled projection data, smoothed look-ahead camera and hover deck. Geometry outside the active window is evicted; topology/scenery changes invalidate it. Canvas still uses painter-style depth sorting, not a GPU depth buffer.
- `lib/game/audio.ts`: opt-in, gesture-unlocked pickup sound, with cleanup.
- `app/page.tsx`: browser lifecycle, menus and input commands.
- `lib/game/webmcp.ts`: optional page-scoped agent integration.
