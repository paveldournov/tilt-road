'use client';

import { memo, startTransition, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  RotateCcw,
  Pause,
  Play,
  Maximize,
  Activity,
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
  advanceFrame,
  MAX_SPEED,
  type GameState,
  type Topology,
  type Scenery,
} from '@/lib/game/core';
import { TiltInput } from '@/lib/game/input';
import { RoadRenderer } from '@/lib/game/renderer';
import { PhoneLink as PhoneLinkComponent } from '@/components/phone-link';
import { registerGameTools, type GameModelContext } from '@/lib/game/webmcp';

const roads = { flow: 'Flow', serpentine: 'Serpentine', alpine: 'Alpine' };
// Speed/score telemetry must not re-render the phone dialog and its controls.
const PhoneLink = memo(PhoneLinkComponent);
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
    // A live development update can retain the previous game-state shape.
    if (!Number.isFinite(game.current.collected))
      game.current = createState(game.current.topology);
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
    const onPhoneCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action: string }>).detail?.action;
      if (action === 'pause' || action === 'lost') {
        controller.clear();
        if (game.current.status === 'running') game.current.status = 'paused';
        setHud({ ...game.current });
      } else if (!document.hidden && action === 'restart') restart();
      else if (
        !document.hidden &&
        action === 'start' &&
        ['ready', 'paused'].includes(game.current.status)
      )
        begin();
    };
    window.addEventListener('roadtilt:phone-command', onPhoneCommand);
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
      lastRender = 0,
      update = 0,
      record = 0,
      savedRecord = 0,
      lastSave = 0;
    try {
      record = Number(localStorage.getItem('roadtilt-best')) || 0;
      savedRecord = record;
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
        begin();
      }
      if (event.code === 'KeyR') restart();
    };
    const onBlur = () => {
      if (game.current.status === 'running') {
        game.current.status = 'paused';
        setHud({ ...game.current });
      }
      controller.clear();
      saveRecord();
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
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) {
        frame = requestAnimationFrame(tick);
        return;
      }
      advanceFrame(game.current, controller.read(now), dt);
      const renderInterval =
        game.current.status === 'running' ? 1000 / 60 : 1000 / 20;
      if (now - lastRender >= renderInterval - 0.5) {
        renderer.render(game.current, sceneryRef.current, now / 1000);
        lastRender = now - ((now - lastRender) % renderInterval);
      }
      if (game.current.status === 'running' && now - update > 75) {
        update = now;
        const snapshot = { ...game.current };
        startTransition(() => setHud(snapshot));
        if (Math.floor(game.current.distance) > record) {
          record = Math.floor(game.current.distance);
          startTransition(() => setBest(record));
        }
        if (now - lastSave >= 1000) {
          saveRecord();
          lastSave = now;
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    function saveRecord() {
      record = Math.max(record, Math.floor(game.current.distance));
      if (record <= savedRecord) return;
      try {
        localStorage.setItem('roadtilt-best', String(record));
        savedRecord = record;
      } catch {
        /* Storage is optional. */
      }
    }
    return () => {
      saveRecord();
      unregister();
      cancelAnimationFrame(frame);
      renderer.dispose();
      controller.dispose();
      window.removeEventListener('roadtilt:phone-command', onPhoneCommand);
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
      <div className="upper-hud">
        <header className="topbar">
          <a className="brand" href="/" aria-label="RoadTilt home">
            <span className="brand-mark">∕∕</span> ROAD<span>TILT</span>
            <small>HOVER EXPERIMENT / 01</small>
          </a>
          <div className="top-actions">
            <PhoneLink game={game} />
            <button
              className="icon-button"
              aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={async () => {
                try {
                  if (document.fullscreenElement)
                    await document.exitFullscreen();
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
          <div
            className="treasure-count"
            aria-label={`${hud.collected} treasures collected`}
          >
            <span className="eyebrow">TREASURES</span>
            <strong>◆ {hud.collected}</strong>
            <span
              className="pickup-feedback"
              style={{ opacity: hud.pickupFlash > 0 ? 1 : 0 }}
            >
              +1 TREASURE
            </span>
          </div>
          <span className="eyebrow">DISTANCE</span>
          <div>
            {(hud.distance / 1000).toFixed(2)}
            <small> KM</small>
          </div>
          <span className="best">BEST {(best / 1000).toFixed(2)} KM</span>
        </aside>
      </div>
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
            <i /> {ready ? 'THE ROAD IS YOURS' : 'TAKE A BREATH'}
          </span>
          <h1>
            {ready ? (
              <>
                Find your
                <br />
                <em>balance.</em>
              </>
            ) : (
              'Flight paused.'
            )}
          </h1>
          <p>
            {ready
              ? 'Follow the gold. Collect treasures. Fly without limits—no crashes.'
              : `Your platform is right where you left it. ${hud.collected} treasures collected.`}
          </p>
          <button className="launch-button" onClick={begin}>
            {ready ? 'Start flying' : 'Resume flight'}
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
            <i style={{ width: `${(hud.speed / MAX_SPEED) * 100}%` }} />
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
            disabled={ready}
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
