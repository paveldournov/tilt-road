import {
  tiltSample,
  normalizeSensitivity,
  DEFAULT_SENSITIVITY,
} from './motion.js';
import {
  MOTION_INTERVAL_MS,
  MAX_BUFFER_BYTES,
  freshMotion,
} from './protocol.js';
const $ = (id) => document.getElementById(id);
const sensitivityKey = 'roadtilt-phone-sensitivity-v1';
let sensitivity = normalizeSensitivity();
try {
  sensitivity = normalizeSensitivity(
    JSON.parse(localStorage.getItem(sensitivityKey)),
  );
} catch {
  /* Local preferences are optional. */
}
let socket = null,
  paired = false,
  enabled = false,
  neutral = null,
  streaming = false,
  sample = null,
  lastEvent = 0,
  seq = 0,
  wake = null;
const message = (text) => {
  $('message').textContent = text;
  $('calibration-message').textContent = text;
};
const send = (data) => {
  if (
    socket?.readyState !== WebSocket.OPEN ||
    socket.bufferedAmount >= MAX_BUFFER_BYTES
  )
    return false;
  try {
    socket.send(JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
};
function controls() {
  $('pairing').hidden = paired;
  $('message').hidden = paired;
  $('intro').hidden = paired;
  $('enable').hidden = enabled;
  $('enable').disabled = !paired || enabled;
  $('calibrate').disabled = !paired || !enabled;
  $('calibrate').textContent = neutral
    ? 'Recalibrate neutral'
    : 'Calibrate neutral';
  const ready =
    paired &&
    neutral &&
    sample &&
    !document.hidden &&
    portrait() &&
    freshMotion(performance.now() - lastEvent) &&
    socket?.readyState === WebSocket.OPEN &&
    socket.bufferedAmount < MAX_BUFFER_BYTES;
  $('start').disabled = !ready;
  $('restart').disabled = !ready;
  $('pause').disabled = !paired;
  $('disconnect').disabled = !paired;
  $('join').disabled = paired;
  $('code').disabled = paired;
}
function suspend(text, notify = true) {
  streaming = false;
  if (notify && paired) send({ type: 'suspend' });
  $('motion-state').textContent = enabled ? 'PAUSED' : 'NOT ENABLED';
  message(text);
  controls();
}
function portrait() {
  return (
    Math.abs(Number(screen.orientation?.angle ?? window.orientation ?? 0)) %
      360 ===
    0
  );
}
function orientation(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  if (document.hidden || !portrait()) return;
  sample = { beta: event.beta, gamma: event.gamma };
  lastEvent = performance.now();
  $('angles').textContent =
    `Phone angle: ${Math.round(sample.beta)}° pitch · ${Math.round(sample.gamma)}° roll`;
  updateMeasurements();
  controls();
}
$('join').onclick = () => {
  const code = $('code').value.trim();
  if (!/^\d{2}$/.test(code)) {
    message('Enter the two-digit code from Connect iPhone in the game.');
    return;
  }
  if (!window.isSecureContext) {
    message(
      'Motion needs trusted HTTPS. Open the certificate setup page first.',
    );
    return;
  }
  socket?.close();
  const ws = new WebSocket(`wss://${location.host}/phone`);
  socket = ws;
  $('join').disabled = true;
  message('Connecting to your computer…');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'pair', code }));
  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (ws !== socket) return;
    if (data.type === 'paired') {
      paired = true;
      seq = 0;
      $('connection').textContent = 'CONNECTED';
      message(
        enabled
          ? 'Tap Calibrate neutral to set this position to zero.'
          : 'Connected. Tap Enable motion, then allow access.',
      );
      controls();
    }
    if (data.type === 'error') message(data.message);
    if (data.type === 'suspended') {
      if (streaming)
        suspend(data.reason + ' Tap Start / Resume when ready.', false);
    }
    if (data.type === 'state')
      $('flight').textContent =
        `${String(data.status).toUpperCase()} · ${data.speed} km/h`;
  };
  ws.onerror = () =>
    message(
      'Could not connect. Check certificate trust, same Wi-Fi, and that the local server is running.',
    );
  ws.onclose = () => {
    if (ws !== socket) return;
    paired = false;
    $('connection').textContent = 'OFFLINE';
    neutral = null;
    streaming = false;
    controls();
    $('join').disabled = false;
    if (!document.hidden)
      message('Disconnected. Check the code on the game, then Connect again.');
  };
};
$('enable').onclick = async () => {
  if (!window.isSecureContext) {
    message('Open the HTTPS controller after trusting the local certificate.');
    return;
  }
  if (!('DeviceOrientationEvent' in window)) {
    message(
      'This browser does not expose phone orientation. Open this page in iPhone Safari.',
    );
    return;
  }
  try {
    // Called directly from this tap: iOS requires transient user activation.
    const permission =
      typeof DeviceOrientationEvent.requestPermission === 'function'
        ? await DeviceOrientationEvent.requestPermission()
        : 'granted';
    if (permission !== 'granted') {
      message(
        'Motion access was denied. Reload this page and allow Motion & Orientation access when prompted.',
      );
      return;
    }
    if (!enabled) window.addEventListener('deviceorientation', orientation);
    enabled = true;
    $('motion-state').textContent = 'SET ZERO';
    message(
      'Hold the phone comfortably in portrait. Tap Calibrate neutral to instantly set this position to zero.',
    );
    controls();
    setTimeout(() => {
      if (enabled && !sample)
        message(
          'No orientation readings received. Keep Safari visible and check Motion & Orientation permission.',
        );
    }, 2500);
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {
      /* Locking the screen will safely pause. */
    }
  } catch {
    message(
      'Motion permission failed. Open this page directly in Safari over trusted HTTPS.',
    );
  }
};
$('calibrate').onclick = () => {
  if (!paired || !enabled) return;
  send({ type: 'command', action: 'pause' });
  if (document.hidden || !portrait()) {
    suspend('Rotate back to portrait before calibrating.');
    return;
  }
  if (!sample || !freshMotion(performance.now() - lastEvent)) {
    message(
      'No motion reading yet. Enable motion and allow Safari access, then tap Calibrate again.',
    );
    $('enable').disabled = false;
    return;
  }
  // A local zero-offset capture, not a sampling or network operation.
  neutral = { ...sample };
  updateMeasurements();
  $('motion-state').textContent = 'CALIBRATED';
  message('Zero set. Pitch 0% · Roll 0%. Tilt to see the readings change.');
  controls();
  transmit();
  $('motion-controls').scrollIntoView({ block: 'start', behavior: 'auto' });
};
function updateMeasurements() {
  if (!sample || !neutral) return null;
  const value = tiltSample(sample.beta, sample.gamma, neutral, sensitivity);
  if (!value) return null;
  $('pitch').textContent = `${Math.round(value.pitch * 100)}%`;
  $('roll').textContent = `${Math.round(value.roll * 100)}%`;
  $('pitch-meter').value = value.pitch;
  $('roll-meter').value = value.roll;
  return value;
}
function transmit() {
  const value = updateMeasurements();
  if (!paired || !value) return false;
  if (
    document.hidden ||
    !portrait() ||
    !freshMotion(performance.now() - lastEvent)
  ) {
    if (streaming)
      suspend(
        'Motion interrupted. Return to portrait with Safari visible. Your zero position is saved.',
      );
    controls();
    return false;
  }
  if (
    !send({
      type: 'input',
      ...value,
      seq: seq++,
      ageMs: performance.now() - lastEvent,
    })
  ) {
    streaming = false;
    $('motion-state').textContent = 'SIGNAL BLOCKED';
    message(
      'Signal delayed. Measurements and zero are kept; check Wi-Fi before resuming.',
    );
    controls();
    return false;
  }
  streaming = true;
  $('motion-state').textContent = 'CALIBRATED';
  return true;
}
setInterval(transmit, MOTION_INTERVAL_MS);
for (const action of ['start', 'pause', 'restart'])
  $(action).onclick = () => {
    if (action !== 'pause') {
      if (!transmit()) return;
    }
    send({ type: 'command', action });
  };
function showSensitivity() {
  for (const axis of ['roll', 'pitch']) {
    const slider = $(`${axis}-sensitivity`),
      gain = Number(slider.value);
    $(`${axis}-gain`).textContent = `${gain.toFixed(1)}×`;
    const response = axis === 'roll' ? 'steering' : 'acceleration / braking';
    $(`${axis}-response`).textContent =
      `Full ${response} at ${(2 + 23 / gain).toFixed(1)}° from neutral.`;
    slider.setAttribute(
      'aria-valuetext',
      `${gain.toFixed(1)} times ${response} sensitivity`,
    );
  }
}
function applySensitivity() {
  // Pause once on commit, not for every slider movement. Keep the neutral pose.
  if (paired) send({ type: 'command', action: 'pause' });
  sensitivity = normalizeSensitivity({
    roll: Number($('roll-sensitivity').value),
    pitch: Number($('pitch-sensitivity').value),
  });
  try {
    localStorage.setItem(sensitivityKey, JSON.stringify(sensitivity));
  } catch {
    /* Continue for this session if storage is unavailable. */
  }
  showSensitivity();
  message(
    paired
      ? neutral
        ? 'Sensitivity updated. Calibration kept—tap Start / Resume when ready.'
        : 'Sensitivity updated. Enable motion and calibrate before starting.'
      : 'Sensitivity updated. Connect to the game when ready.',
  );
}
for (const axis of ['roll', 'pitch']) {
  const slider = $(`${axis}-sensitivity`);
  slider.value = sensitivity[axis];
  slider.oninput = showSensitivity;
  slider.onchange = applySensitivity;
}
$('reset-sensitivity').onclick = () => {
  for (const axis of ['roll', 'pitch'])
    $(`${axis}-sensitivity`).value = DEFAULT_SENSITIVITY[axis];
  applySensitivity();
};
showSensitivity();
$('disconnect').onclick = () => {
  suspend('Phone disconnected.');
  socket?.close();
  wake?.release();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden)
    suspend(
      'Phone was hidden or locked. Zero saved; tap Start / Resume when ready.',
    );
});
window.addEventListener('pagehide', () => {
  send({ type: 'suspend' });
  socket?.close();
});
window.addEventListener('orientationchange', () =>
  suspend('Return to portrait. Zero saved; tap Start / Resume when ready.'),
);
screen.orientation?.addEventListener('change', () =>
  suspend('Return to portrait. Zero saved; tap Start / Resume when ready.'),
);
controls();
