'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  RotateCcw,
  Pause,
  Play,
  Maximize,
  Settings2,
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
  type GameState,
  type Topology,
  type Scenery,
} from '@/lib/game/core';
import { TiltInput } from '@/lib/game/input';
import { RoadRenderer } from '@/lib/game/renderer';
import { PhoneLink as PhoneLinkComponent } from '@/components/phone-link';
import { registerGameTools, type GameModelContext } from '@/lib/game/webmcp';

import { FlightRuntime } from '@/lib/game/runtime';
import { TelemetryStore } from '@/lib/game/telemetry';
import { PickupAudio } from '@/lib/game/audio';
import { RunStats, Speed, TiltInstrument } from '@/components/flight-hud';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

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
  const [telemetry] = useState(() => new TelemetryStore());
  const audio = useRef(new PickupAudio());
  const rendererRef = useRef<RoadRenderer | null>(null);
  const [bank, setBank] = useState(1);
  const [sound, setSound] = useState(false);
  const [settings, setSettings] = useState(false);
  const [profile, setProfile] = useState('');
  const reducedMotion = useRef(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const begin = useCallback(() => {
    audio.current.unlock();
    game.current.status = 'running';
    input.current?.clear();
    canvas.current?.focus();
    setHud({ ...game.current });
  }, []);
  const restart = useCallback(() => {
    game.current = createState(game.current.topology);
    begin();
  }, [begin]);
  const pause = useCallback(() => {
    if (game.current.status === 'running') game.current.status = 'paused';
    else if (game.current.status === 'paused') game.current.status = 'running';
    input.current?.clear();
    canvas.current?.focus();
    setHud({ ...game.current });
  }, []);
  const changeRoad = useCallback((value: Topology) => {
    setTopology(value);
    game.current = createState(value);
    input.current?.clear();
    setHud({ ...game.current });
  }, []);
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
    rendererRef.current = renderer;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const comfort = () => {
      reducedMotion.current = preference.matches;
      renderer.configure({
        bank: Number(localStorageSafe('roadtilt-bank') ?? 1),
        reducedMotion: preference.matches,
      });
    };
    function localStorageSafe(key: string) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    const savedBank = Math.max(
      0,
      Math.min(1, Number(localStorageSafe('roadtilt-bank') ?? 1)),
    );
    setBank(Number.isFinite(savedBank) ? savedBank : 1);
    audio.current.enabled = localStorageSafe('roadtilt-sound') === 'true';
    setSound(audio.current.enabled);
    comfort();
    preference.addEventListener('change', comfort);
    const controller = new TiltInput();
    input.current = controller;
    const onPhoneCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action: string }>).detail?.action;
      if (action === 'pause' || action === 'lost') {
        controller.clear();
        if (game.current.status === 'running') game.current.status = 'paused';
        setHud({ ...game.current });
      } else if (!document.hidden && action === 'restart') {
        setSettings(false);
        restart();
      } else if (
        !document.hidden &&
        action === 'start' &&
        ['ready', 'paused'].includes(game.current.status)
      ) {
        setSettings(false);
        begin();
      }
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
    const runtime = new FlightRuntime({
      state: () => game.current,
      scenery: () => sceneryRef.current,
      input: controller,
      renderer,
      telemetry,
      onStatus: setHud,
      onPickup: () => audio.current.play(),
      profile: new URLSearchParams(location.search).has('stats')
        ? setProfile
        : undefined,
    });
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'button,input,[role="dialog"],[role="slider"],[role="switch"],[role="combobox"],[role="listbox"]',
        )
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
      runtime.save();
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
    runtime.start();
    const soundEngine = audio.current;
    return () => {
      runtime.save();
      unregister();
      runtime.dispose();
      soundEngine.dispose();
      preference.removeEventListener('change', comfort);
      renderer.dispose();
      controller.dispose();
      window.removeEventListener('roadtilt:phone-command', onPhoneCommand);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [begin, restart, pause, changeRoad, telemetry]);

  const ready = hud.status === 'ready';
  return (
    <main
      className={`game-shell ${hud.status === 'running' ? 'is-flying' : 'is-idle'}`}
    >
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
            <Dialog
              open={settings}
              onOpenChange={(open) => {
                setSettings(open);
                if (open && game.current.status === 'running') pause();
              }}
            >
              <DialogTrigger
                className="icon-button"
                aria-label="Flight settings"
              >
                <Settings2 size={19} />
              </DialogTrigger>
              <DialogContent className="phone-pair-dialog flight-settings">
                <DialogTitle>Flight settings</DialogTitle>
                <DialogDescription>
                  Choose your road, scenery, and comfort. Close settings to
                  resume when ready.
                </DialogDescription>
                <section
                  className="world-controls settings-controls"
                  aria-label="World settings"
                >
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
                    <SelectTrigger
                      aria-label="Road topology"
                      className="world-select"
                    >
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
                    <SelectTrigger
                      aria-label="Scenery"
                      className="world-select"
                    >
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
                  <span className="road-note">
                    Changing road starts a new run.
                  </span>
                </section>

                <div className="comfort-control">
                  <label id="bank-label">
                    Camera banking <output>{Math.round(bank * 100)}%</output>
                  </label>
                  <Slider
                    aria-labelledby="bank-label"
                    value={[bank * 100]}
                    min={0}
                    max={100}
                    step={10}
                    onValueChange={(value) => {
                      const next =
                        (Array.isArray(value) ? value[0] : value) / 100;
                      setBank(next);
                      rendererRef.current?.configure({
                        bank: next,
                        reducedMotion: reducedMotion.current,
                      });
                      try {
                        localStorage.setItem('roadtilt-bank', String(next));
                      } catch {
                        /* Optional. */
                      }
                    }}
                  />
                  <p>
                    0% keeps the horizon level. Reduced-motion preferences also
                    disable camera banking and pickup bursts.
                  </p>
                </div>
                <label className="sound-control" htmlFor="treasure-sounds">
                  Treasure sounds{' '}
                  <Switch
                    id="treasure-sounds"
                    checked={sound}
                    onCheckedChange={(value) => {
                      setSound(value);
                      audio.current.enabled = value;
                      audio.current.unlock();
                      try {
                        localStorage.setItem('roadtilt-sound', String(value));
                      } catch {
                        /* Optional. */
                      }
                    }}
                  />
                </label>
              </DialogContent>
            </Dialog>
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
        <div className="world-summary">
          {roads[topology]} <span> / </span> {worlds[scenery]}
        </div>
        <RunStats store={telemetry} />
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
        <Speed store={telemetry} />
        <TiltInstrument store={telemetry} />
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
      {profile && (
        <output className="performance-stats" aria-label="Renderer diagnostics">
          {profile}
        </output>
      )}
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
