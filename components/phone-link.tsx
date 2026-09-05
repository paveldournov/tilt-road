'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { CircleCheck, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  PhoneClient,
  type LinkInfo,
  type ConnectionState,
} from '@/lib/game/phone-client';
import type { GameState } from '@/lib/game/core';

export function PhoneLink({ game }: { game: RefObject<GameState> }) {
  const client = useRef<PhoneClient | null>(null);
  const [open, setOpen] = useState(false),
    [info, setInfo] = useState<LinkInfo | null>(null),
    [connection, setConnection] = useState<ConnectionState>('disconnected'),
    [status, setStatus] = useState('Keyboard');
  useEffect(() => {
    const command = (action: string) =>
      window.dispatchEvent(
        new CustomEvent('roadtilt:phone-command', { detail: { action } }),
      );
    client.current = new PhoneClient({
      info: setInfo,
      status: setStatus,
      connection: (next) => {
        setConnection(next);
        // Pairing succeeds before motion permission or calibration. Close now,
        // not on every motion packet, so connection settings can be reopened.
        if (next === 'paired') setOpen(false);
      },
      input: (tilt) =>
        window.dispatchEvent(
          new CustomEvent('roadtilt:input', { detail: tilt }),
        ),
      command: (action) => {
        if (action !== 'pause') setOpen(false);
        command(action);
      },
      lost: () => command('lost'),
      state: () => ({ status: game.current.status, speed: game.current.speed }),
    });
    return () => client.current?.disconnect();
  }, [game]);
  function connect() {
    if (
      !['localhost', '127.0.0.1'].includes(location.hostname) ||
      location.protocol !== 'http:'
    ) {
      setStatus('Open the local game at http://localhost:3000 to pair.');
      return;
    }
    setInfo(null);
    client.current?.connect();
  }
  const connected = connection !== 'disconnected';
  // Also reject old state retained across a live development update.
  const pairingInfo =
    info && /^[1-9]\d$/.test(info.code) && status === 'Waiting for iPhone'
      ? info
      : null;
  const heading =
    connection === 'paused'
      ? 'iPhone connected · motion paused'
      : connected
        ? 'iPhone connected'
        : 'iPhone not connected';
  const guidance =
    connection === 'paired'
      ? 'Pairing successful! Enable motion and calibrate on your phone.'
      : connection === 'ready'
        ? 'Motion is live. Your phone controls the board.'
        : status;
  const summary =
    connection === 'paired'
      ? 'Enable motion & calibrate'
      : connection === 'ready'
        ? 'Motion live'
        : connection === 'paused'
          ? 'Motion paused · zero saved'
          : status === 'Keyboard'
            ? 'Use your phone to steer'
            : status === 'Waiting for iPhone'
              ? 'Waiting for pairing'
              : status === 'Connecting…'
                ? 'Connecting…'
                : 'Connection lost · tap for details';
  return (
    <div className="phone-link">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            window.dispatchEvent(
              new CustomEvent('roadtilt:phone-command', {
                detail: { action: 'pause' },
              }),
            );
            if (!connected && !pairingInfo) connect();
          }
        }}
      >
        <DialogTrigger
          className="phone-link-button phone-controller-control"
          data-connected={connected}
          data-paused={connection === 'paused'}
          title={guidance}
        >
          {connected ? (
            <CircleCheck size={17} aria-hidden="true" />
          ) : (
            <Smartphone size={17} aria-hidden="true" />
          )}
          <span className="phone-controller-copy">
            <span>{connected ? 'iPhone connected' : 'Connect iPhone'}</span>
            <span className="phone-controller-summary">{summary}</span>
          </span>
        </DialogTrigger>
        <DialogContent className="phone-pair-dialog">
          <DialogTitle className="text-xl">
            {connected ? heading : 'Your iPhone is the controller'}
          </DialogTitle>
          <DialogDescription>
            Keep your phone on the same Wi-Fi/LAN as this computer. Leave the
            game visible while flying.
          </DialogDescription>
          <p className="phone-link-status" role="status">
            {connected ? guidance : status}
          </p>
          {connected ? (
            <p>
              Your phone is paired with this game. You can close this dialog and
              continue using the controller.
            </p>
          ) : pairingInfo ? (
            <>
              <div className="phone-pair-code">
                <span>PAIRING CODE</span>
                <strong>{pairingInfo.code}</strong>
              </div>
              <p>On iPhone Safari, open this setup address:</p>
              <a
                href={pairingInfo.setupUrl}
                target="_blank"
                rel="noreferrer"
                className="phone-url"
              >
                {pairingInfo.setupUrl}
              </a>
              <p>
                Install and trust the local certificate once. Then open the
                controller, enter this code, enable motion, and calibrate.
              </p>
              <a
                href={pairingInfo.controllerUrl}
                target="_blank"
                rel="noreferrer"
                className="phone-url"
              >
                Controller: {pairingInfo.controllerUrl}
              </a>
              <details>
                <summary>Certificate fingerprint</summary>
                <code>{pairingInfo.fingerprint}</code>
                <p>
                  Trust only your own computer’s certificate. Remove its iPhone
                  profile after testing.
                </p>
              </details>
            </>
          ) : (
            <p>
              Start the local relay with <code>npm run phone:server</code>. If
              your browser asks to access the local network, allow it for this
              game.
            </p>
          )}
          <div className="phone-link-actions">
            <button
              className="launch-button"
              onClick={connect}
              disabled={status === 'Connecting…'}
            >
              {status === 'Connecting…'
                ? 'Connecting…'
                : pairingInfo || connected
                  ? 'New pairing code'
                  : 'Reconnect'}
            </button>
            <button
              className="phone-link-button"
              onClick={() => {
                client.current?.disconnect();
                setInfo(null);
                setStatus('Keyboard');
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status !== 'Keyboard' && !open && (
          <span>
            {heading}. {guidance}
          </span>
        )}
      </div>
    </div>
  );
}
