import { MAX_BUFFER_BYTES, freshMotion } from '../../phone/protocol.js';

type LinkInfo = {
  code: string;
  setupUrl: string;
  controllerUrl: string;
  fingerprint: string;
};
type Callbacks = {
  connection?: (state: ConnectionState) => void;
  info: (info: LinkInfo | null) => void;
  status: (status: string) => void;
  input: (tilt: { pitch: number; roll: number; at?: number }) => void;
  command: (action: 'start' | 'restart' | 'pause') => void;
  lost: () => void;
  state: () => { status: string; speed: number };
};
type ConnectionState = 'disconnected' | 'paired' | 'ready' | 'paused';
export class PhoneClient {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSample = 0;
  private active = false;
  constructor(private callbacks: Callbacks) {}
  connect() {
    this.disconnect();
    this.callbacks.status('Connecting…');
    const socket = new WebSocket('ws://127.0.0.1:8786/game');
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'room') {
        if (typeof msg.code !== 'string' || !/^[1-9]\d$/.test(msg.code)) {
          this.disconnect();
          this.callbacks.status(
            'The relay is outdated. Restart the phone server for two-digit pairing.',
          );
          return;
        }
        this.callbacks.info(msg);
        this.callbacks.status('Waiting for iPhone');
      }
      if (msg.type === 'paired') {
        this.callbacks.status('iPhone paired · calibrate');
        this.callbacks.connection?.('paired');
      }
      if (
        msg.type === 'input' &&
        Number.isFinite(msg.pitch) &&
        Number.isFinite(msg.roll) &&
        freshMotion(msg.ageMs ?? 0)
      ) {
        const becameActive = !this.active;
        this.lastSample = performance.now() - (msg.ageMs ?? 0);
        this.active = true;
        this.callbacks.input({
          at: this.lastSample,
          pitch: Math.max(-1, Math.min(1, msg.pitch)),
          roll: Math.max(-1, Math.min(1, msg.roll)),
        });
        if (becameActive) {
          this.callbacks.status('iPhone connected');
          this.callbacks.connection?.('ready');
        }
      }
      if (
        msg.type === 'command' &&
        ['pause', 'start', 'restart'].includes(msg.action)
      ) {
        if (
          msg.action === 'pause' ||
          (this.active && freshMotion(performance.now() - this.lastSample))
        )
          this.callbacks.command(msg.action);
      }
      if (msg.type === 'suspended' || msg.type === 'unpaired') {
        this.stopInput();
        this.callbacks.status(
          msg.type === 'unpaired'
            ? 'Waiting for iPhone'
            : 'Motion paused · zero position saved',
        );
        this.callbacks.connection?.(
          msg.type === 'unpaired' ? 'disconnected' : 'paused',
        );
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.callbacks.info(null);
        this.callbacks.status('Relay unavailable. Run npm run phone:server.');
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.disconnect();
        this.callbacks.status(
          'Connection ended. Click Reconnect for a new two-digit code.',
        );
      }
    };
    this.timer = setInterval(() => {
      if (this.active && !freshMotion(performance.now() - this.lastSample)) {
        this.stopInput();
        this.callbacks.status('Signal lost · game paused');
        this.callbacks.connection?.('paused');
      }
      if (
        socket.readyState === WebSocket.OPEN &&
        socket.bufferedAmount < MAX_BUFFER_BYTES
      )
        socket.send(
          JSON.stringify({ type: 'state', ...this.callbacks.state() }),
        );
    }, 100);
  }
  private stopInput() {
    this.active = false;
    this.lastSample = 0;
    this.callbacks.lost();
  }
  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const previous = this.socket;
    this.socket = null;
    this.callbacks.info(null);
    previous?.close();
    if (previous) this.stopInput();
    this.callbacks.connection?.('disconnected');
  }
}
export type { LinkInfo, ConnectionState };
