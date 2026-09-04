# RoadTilt

A first-person endless hover-road prototype built with React and a dependency-free software 3D canvas renderer. Gameplay and scenery are local and procedural.

## Run

Requires Node 22.13+ and npm. Run `npm install`, then `npm run dev`. Open the URL printed by the server. `npm run build` produces the production site.

## Controls

- Enter or Start flying: start/resume. The platform begins at rest.
- W / Up: lean forward and accelerate (maximum 223 km/h).
- A / D or Left / Right: lean and move across the road.
- S / Down: brake to a complete stop. There is no reverse.
- Release controls: level the deck and coast.
- Space / Escape: pause or resume. R: restart.
- Switching tabs or losing focus pauses automatically.
- Touch flight buttons appear on narrow screens.

Choose Flow (gentle curves), Serpentine (tight linked turns), or Alpine (rolling elevation and banks). Road changes reset the run. Scenery choices are Pacific dusk, Red canyon and Neon midnight. Opening settings pauses an active flight; resume when finished.

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

Pitch: -1 full brake, 0 neutral, +1 full acceleration. Roll: -1 left, +1 right. Send at 20–60 Hz. Values are clamped; malformed packets are ignored. Keyboard/touch takes priority, and packets expire after 250 ms so a disconnected device cannot leave steering latched. Expiry levels the deck and coasts; it does **not** automatically brake. Pause clears input. Hardware calibration, authentication, network/serial transport and physical emergency stops are not implemented yet.

## Verification

`npm test` covers physics, safe boundaries, treasure collection at maximum speed, no duplicate pickups, continuous generation, input handling and optional WebMCP contracts. `npm run typecheck` checks TypeScript.

Optional WebMCP tools read flight state and configure/reset a flight. They are feature-detected. Contract tests use a mock registry; live-browser WebMCP and interactive browser/visual QA have not been run.

## Architecture

- `lib/game/core.ts`: deterministic road, treasure generation and physics.
- `lib/game/input.ts`: keyboard/touch and sensor packet adapter.
- `lib/game/renderer.ts`: procedural world and visible hover deck.
- `app/page.tsx`: game lifecycle, controls and HUD.
- `lib/game/webmcp.ts`: optional page-scoped agent integration.
