import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

export const isLoopback = (ip) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
export function attachRelay(
  httpServer,
  httpsServer,
  { origins, phoneOrigins, info, staleMs = 600 },
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const rooms = new Map(),
    attempts = new Map();
  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 65536) ws.close(1013, 'Connection too slow');
      else ws.send(JSON.stringify(data));
    }
  };
  const suspend = (room, reason) => {
    room.active = false;
    room.lastInput = 0;
    send(room.game, { type: 'suspended', reason });
    send(room.phone, { type: 'suspended', reason });
  };
  function upgrade(req, socket, head) {
    const path = req.url?.split('?')[0],
      origin = req.headers.origin;
    const game =
      path === '/game' &&
      isLoopback(req.socket.remoteAddress) &&
      origins.includes(origin);
    const phone =
      path === '/phone' &&
      Boolean(req.socket.encrypted) &&
      phoneOrigins.includes(origin);
    if (!game && !phone) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (game && rooms.size >= 8) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, req, game));
  }
  function connect(ws, req, game) {
    let room,
      paired = false,
      windowAt = Date.now(),
      count = 0;
    const ip = req.socket.remoteAddress;
    if (game) {
      // At most eight rooms are open. Pick from unused codes without retries.
      const available = Array.from({ length: 90 }, (_, i) =>
        String(i + 10),
      ).filter((code) => !rooms.has(code));
      const code = available[randomInt(available.length)];
      room = {
        code,
        game: ws,
        phone: null,
        lastInput: 0,
        lastSeq: -1,
        active: false,
      };
      rooms.set(code, room);
      send(ws, { type: 'room', code, ...info });
    }
    const authTimeout = setTimeout(() => {
      if (!game && !paired) ws.close(1008, 'Pairing timeout');
    }, 15000);
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      if (Date.now() - windowAt > 1000) {
        windowAt = Date.now();
        count = 0;
      }
      if (++count > 100) {
        ws.close(1008, 'Rate limit');
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(1008, 'Invalid JSON');
        return;
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        ws.close(1008, 'Invalid message');
        return;
      }
      if (game) {
        if (
          msg.type === 'state' &&
          ['ready', 'running', 'paused', 'crashed'].includes(msg.status) &&
          Number.isFinite(msg.speed)
        )
          send(room.phone, {
            type: 'state',
            status: msg.status,
            // Telemetry sanity limit, independent of the game's tuned speed cap.
            speed: Math.round(Math.max(0, Math.min(250, msg.speed)) * 3.6),
          });
        return;
      }
      if (!paired) {
        const attempt = attempts.get(ip) || { count: 0, at: Date.now() };
        if (Date.now() - attempt.at > 60000) {
          attempt.count = 0;
          attempt.at = Date.now();
        }
        attempt.count++;
        attempts.set(ip, attempt);
        if (attempt.count > 10) {
          send(ws, {
            type: 'error',
            message: 'Too many pairing attempts. Wait a minute.',
          });
          ws.close(1008);
          return;
        }
        if (
          msg.type !== 'pair' ||
          typeof msg.code !== 'string' ||
          !/^\d{2}$/.test(msg.code) ||
          !rooms.has(msg.code)
        ) {
          send(ws, {
            type: 'error',
            message: 'Code not found. Check the game and try again.',
          });
          ws.close(1008);
          return;
        }
        room = rooms.get(msg.code);
        if (room.phone) {
          send(ws, {
            type: 'error',
            message: 'This game already has a phone connected.',
          });
          ws.close(1008);
          return;
        }
        room.phone = ws;
        room.lastSeq = -1;
        paired = true;
        clearTimeout(authTimeout);
        send(ws, { type: 'paired' });
        send(room.game, { type: 'paired' });
        return;
      }
      if (msg.type === 'input') {
        if (
          !Number.isFinite(msg.pitch) ||
          !Number.isFinite(msg.roll) ||
          !Number.isSafeInteger(msg.seq) ||
          msg.seq <= room.lastSeq
        ) {
          ws.close(1008, 'Invalid sample');
          return;
        }
        room.lastSeq = msg.seq;
        room.lastInput = Date.now();
        room.active = true;
        send(room.game, {
          type: 'input',
          pitch: Math.max(-1, Math.min(1, msg.pitch)),
          roll: Math.max(-1, Math.min(1, msg.roll)),
        });
      } else if (msg.type === 'suspend') suspend(room, 'Phone motion stopped.');
      else if (
        msg.type === 'command' &&
        ['start', 'pause', 'restart'].includes(msg.action)
      ) {
        if (
          msg.action === 'pause' ||
          (room.active && Date.now() - room.lastInput < staleMs)
        )
          send(room.game, { type: 'command', action: msg.action });
        else
          send(ws, {
            type: 'error',
            message: 'Calibrate and send motion before starting.',
          });
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (game) {
        rooms.delete(room.code);
        room.phone?.close(1001, 'Game disconnected');
      } else if (paired && room.phone === ws) {
        room.phone = null;
        suspend(room, 'Phone disconnected.');
        send(room.game, { type: 'unpaired' });
      }
    });
  }
  httpServer.on('upgrade', upgrade);
  httpsServer.on('upgrade', upgrade);
  const watchdog = setInterval(() => {
    for (const room of rooms.values())
      if (room.active && Date.now() - room.lastInput > staleMs)
        suspend(room, 'Motion stream lost.');
    for (const [ip, a] of attempts)
      if (Date.now() - a.at > 60000) attempts.delete(ip);
  }, 100);
  watchdog.unref();
  return {
    rooms,
    close() {
      clearInterval(watchdog);
      httpServer.off('upgrade', upgrade);
      httpsServer.off('upgrade', upgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
