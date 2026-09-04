'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  RotateCcw,
  Pause,
  Play,
  Maximize,
  Activity,
  Keyboard,
  Mountain,
  Route,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createState,
  step,
  type GameState,
  type Topology,
  type Scenery,
} from '@/lib/game/core';
import { TiltInput } from '@/lib/game/input';
import { RoadRenderer } from '@/lib/game/renderer';
import { registerGameTools, type GameModelContext } from '@/lib/game/webmcp';

const roads = { flow: 'Flow', serpentine: 'Serpentine', alpine: 'Alpine' };
const worlds = {
  coast: 'Pacific dusk',
  desert: 'Red canyon',
  night: 'Neon midnight',
};

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState>(createState());
  const input = useRef<TiltInput | null>(null);
  const [hud, setHud] = useState(createState());
  const [topology, setTopology] = useState<Topology>('flow');
  const [scenery, setScenery] = useState<Scenery>('coast');
  const sceneryRef = useRef<Scenery>('coast');
  const [best, setBest] = useState(0);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  function begin() {
    game.current.status = 'running';
    input.current?.clear();
    canvas.current?.focus();
    setHud({ ...game.current });
  }
  function restart() {
    game.current = createState(game.current.topology);
    begin();
  }
  function pause() {
    if (game.current.status === 'running') game.current.status = 'paused';
    else if (game.current.status === 'paused') game.current.status = 'running';
    input.current?.clear();
    canvas.current?.focus();
    setHud({ ...game.current });
  }
  function changeRoad(value: Topology) {
    setTopology(value);
    game.current = createState(value);
    input.current?.clear();
    setHud({ ...game.current });
  }
  useEffect(() => {
    if (!canvas.current) return;
    let renderer: RoadRenderer;
    try {
      renderer = new RoadRenderer(canvas.current);
    } catch {
      setError(
        'Your browser could not start the renderer. Try another browser.',
      );
      return;
    }
    const controller = new TiltInput();
    input.current = controller;
    const unregister = registerGameTools(
      (document as Document & { modelContext?: GameModelContext }).modelContext,
      () => ({ ...game.current, scenery: sceneryRef.current }),
      (road, world) => {
        changeRoad(road);
        setScenery(world);
        sceneryRef.current = world;
      },
    );
    let frame = 0,
      last = performance.now(),
      update = 0,
      record = 0;
    try {
      record = Number(localStorage.getItem('roadtilt-best')) || 0;
      setBest(record);
    } catch {
      /* Storage is optional. */
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button,input,[role="combobox"],[role="listbox"]')
      )
        return;
      if (event.repeat) return;
      if (event.code === 'Space' || event.code === 'Escape') {
        event.preventDefault();
        pause();
      }
      if (event.code === 'Enter' && game.current.status !== 'running') {
        if (game.current.status === 'crashed') restart();
        else begin();
      }
      if (event.code === 'KeyR') restart();
    };
    const onBlur = () => {
      if (game.current.status === 'running') {
        game.current.status = 'paused';
        setHud({ ...game.current });
      }
      controller.clear();
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    const onFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      step(game.current, controller.read(now), dt);
      renderer.render(game.current, sceneryRef.current, now / 1000);
      if (now - update > 75) {
        update = now;
        setHud({ ...game.current });
        if (
          game.current.status === 'crashed' &&
          game.current.distance > record
        ) {
          record = Math.floor(game.current.distance);
          setBest(record);
          try {
            localStorage.setItem('roadtilt-best', String(record));
          } catch {
            /* Continue without storage. */
          }
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      unregister();
      cancelAnimationFrame(frame);
      renderer.dispose();
      controller.dispose();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const ready = hud.status === 'ready';
  return (
    <main className="game-shell">
      <canvas
        ref={canvas}
        tabIndex={0}
        className="world"
        aria-label="First-person endless hover road. W or up accelerates, A and D or left and right steer, S or down brakes."
      />
      <div className="vignette" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="RoadTilt home">
          <span className="brand-mark">∕∕</span> ROAD<span>TILT</span>
          <small>HOVER EXPERIMENT / 01</small>
        </a>
        <div className="top-actions">
          <span className="input-status">
            <i /> <Keyboard size={16} /> KEYBOARD
          </span>
          <button
            className="icon-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
                canvas.current?.focus();
              } catch {
                setError(
                  'Fullscreen is unavailable here. You can still play in this window.',
                );
              }
            }}
          >
            <Maximize size={19} />
          </button>
        </div>
      </header>
      <section className="world-controls" aria-label="World settings">
        <div className="control-label">
          <Route size={16} />
          <span>ROAD TOPOLOGY</span>
        </div>
        <Select
          value={topology}
          onValueChange={(v) => {
            if (v) changeRoad(v as Topology);
          }}
          onOpenChange={(open) => {
            if (open && game.current.status === 'running') pause();
          }}
        >
          <SelectTrigger aria-label="Road topology" className="world-select">
            <SelectValue>{roads[topology]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(roads).map(([key, title]) => (
              <SelectItem key={key} value={key}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="control-label scenery-label">
          <Mountain size={16} />
          <span>SCENERY</span>
        </div>
        <Select
          value={scenery}
          onValueChange={(v) => {
            if (v) {
              setScenery(v as Scenery);
              sceneryRef.current = v as Scenery;
            }
          }}
          onOpenChange={(open) => {
            if (open && game.current.status === 'running') pause();
          }}
        >
          <SelectTrigger aria-label="Scenery" className="world-select">
            <SelectValue>{worlds[scenery]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(worlds).map(([key, title]) => (
              <SelectItem key={key} value={key}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="road-note">Changing road starts a new run.</span>
      </section>
      <aside className="run-stats">
        <span className="eyebrow">DISTANCE</span>
        <div>
          {(hud.distance / 1000).toFixed(2)}
          <small> KM</small>
        </div>
        <span className="best">BEST {(best / 1000).toFixed(2)} KM</span>
      </aside>
      <div className="reticle" aria-hidden="true">
        <span />
        <span />
      </div>
      {hud.status !== 'running' && (
        <section
          className={`start-panel ${ready ? '' : 'compact'}`}
          aria-live="polite"
        >
          <span className="eyebrow">
            <i />{' '}
            {ready
              ? 'THE ROAD IS YOURS'
              : hud.status === 'paused'
                ? 'TAKE A BREATH'
                : 'FLIGHT RECORDER'}
          </span>
          <h1>
            {ready ? (
              <>
                Find your
                <br />
                <em>balance.</em>
              </>
            ) : hud.status === 'paused' ? (
              'Flight paused.'
            ) : (
              'Run complete.'
            )}
          </h1>
          <p>
            {ready
              ? 'Lean into an endless road. Stay light. Stay clear.'
              : hud.status === 'paused'
                ? 'Your platform is right where you left it.'
                : `${hud.reason} You travelled ${(hud.distance / 1000).toFixed(2)} km and cleared ${hud.cleared} obstacles.`}
          </p>
          <button
            className="launch-button"
            onClick={() => {
              if (hud.status === 'crashed') restart();
              else begin();
            }}
          >
            {ready
              ? 'Start flying'
              : hud.status === 'paused'
                ? 'Resume flight'
                : 'Fly again'}
            <ArrowUpRight size={21} />
          </button>
          <span className="enter-hint">or press ENTER</span>
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
      <footer className="cockpit">
        <section className="speed">
          <span className="eyebrow">GROUND SPEED</span>
          <div>
            {Math.round(hud.speed * 3.6)
              .toString()
              .padStart(3, '0')}
            <small>KM/H</small>
          </div>
          <div className="speed-track">
            <i style={{ width: `${(hud.speed / 62) * 100}%` }} />
          </div>
          <span className="speed-state">
            {hud.status === 'running'
              ? hud.pitch > 0.1
                ? 'ACCELERATING'
                : hud.pitch < -0.1
                  ? 'BRAKING'
                  : hud.speed < 0.1
                    ? 'STATIONARY'
                    : 'COASTING'
              : hud.status === 'crashed'
                ? 'FLIGHT ENDED'
                : 'READY FOR FLIGHT'}
          </span>
        </section>
        <section className="tilt-display" aria-label="Platform tilt">
          <span className="eyebrow">
            <Activity size={14} /> PLATFORM TILT
          </span>
          <div className="tilt-meter">
            <div
              className="tilt-horizon"
              style={{
                transform: `translateY(${hud.pitch * 12}px) rotate(${hud.roll * 22}deg)`,
              }}
            >
              <i />
            </div>
          </div>
          <span className="tilt-value">
            {Math.round(hud.roll * 22)}° ROLL <b> / </b>
            {Math.round(hud.pitch * 16)}° PITCH
          </span>
        </section>
        <section className="key-guide">
          <div>
            <kbd>W</kbd>
            <kbd>↑</kbd>
            <span>
              Lean forward <b>Accelerate</b>
            </span>
          </div>
          <div>
            <kbd>A</kbd>
            <kbd>D</kbd>
            <span>
              Lean sideways <b>Steer</b>
            </span>
          </div>
          <div>
            <kbd>S</kbd>
            <kbd>↓</kbd>
            <span>
              Lean back <b>Brake / stop</b>
            </span>
          </div>
        </section>
        <div className="flight-actions">
          <button
            className="icon-button"
            aria-label={hud.status === 'paused' ? 'Resume' : 'Pause'}
            disabled={ready || hud.status === 'crashed'}
            onClick={pause}
          >
            {hud.status === 'paused' ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="Restart run"
            onClick={restart}
          >
            <RotateCcw size={18} />
          </button>
          <span>SPACE pause · R restart</span>
        </div>
      </footer>
      <div className="touch-controls" aria-label="Touch flight controls">
        {[
          ['left', '←'],
          ['back', 'Brake'],
          ['forward', 'Go'],
          ['right', '→'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-label={key}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              input.current?.touch(key, true);
            }}
            onPointerUp={() => input.current?.touch(key, false)}
            onPointerCancel={() => input.current?.touch(key, false)}
            onLostPointerCapture={() => input.current?.touch(key, false)}
          >
            {label}
          </button>
        ))}
      </div>
    </main>
  );
}
