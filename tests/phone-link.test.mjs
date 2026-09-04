import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Unit harness: render the component's element tree and run its real receiver
// against a fake socket, without a browser or a new rendering dependency.
function harness() {
  const cells = [],
    effects = [],
    sockets = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      return [
        cells[index],
        (value) => {
          cells[index] = value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect(fn) {
      const index = cursor++;
      if (!(index in cells)) {
        cells[index] = true;
        effects.push(fn);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() {
      sockets.push(this);
    }
    receive(message) {
      this.onmessage({ data: JSON.stringify(message) });
    }
    close() {
      this.onclose?.();
    }
    send() {}
  }
  const globals = {
    WebSocket: Socket,
    performance,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    window: new EventTarget(),
    CustomEvent,
    location: { hostname: 'localhost', protocol: 'http:' },
  };
  function compile(path, imports = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      ...globals,
      exports,
      require(name) {
        assert.ok(name in imports, `Unexpected import: ${name}`);
        return imports[name];
      },
    });
    return exports;
  }
  const receiver = compile('../lib/game/phone-client.ts');
  const dialogs = Object.fromEntries(
    [
      'Dialog',
      'DialogContent',
      'DialogDescription',
      'DialogTitle',
      'DialogTrigger',
    ].map((name) => [name, name]),
  );
  const { PhoneLink } = compile('../components/phone-link.tsx', {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': { Smartphone: 'Smartphone', CircleCheck: 'CircleCheck' },
    '@/components/ui/dialog': dialogs,
    '@/lib/game/phone-client': receiver,
  });
  const game = { current: { status: 'paused', speed: 0 } };
  const render = () => {
    cursor = 0;
    return PhoneLink({ game });
  };
  render();
  effects.forEach((fn) => fn());
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child, predicate);
      if (found) return found;
    }
  };
  const dialog = () => find(render(), (node) => node.type === 'Dialog');
  const trigger = () => find(render(), (node) => node.type === 'DialogTrigger');
  const notice = () =>
    find(render(), (node) => node.props?.['aria-live'] === 'polite');
  const text = (node) =>
    !node || typeof node === 'boolean'
      ? ''
      : typeof node !== 'object'
        ? String(node)
        : [node.props?.children].flat(Infinity).map(text).join(' ');
  return { render, dialog, trigger, notice, text, sockets };
}

test('pairing immediately closes the dialog and announces connection before motion or Start', () => {
  const ui = harness();
  ui.dialog().props.onOpenChange(true);
  const socket = ui.sockets[0];
  socket.receive({
    type: 'room',
    code: '42',
    setupUrl: 'setup',
    controllerUrl: 'controller',
    fingerprint: 'test',
  });
  assert.equal(ui.dialog().props.open, true);
  socket.receive({ type: 'paired' });
  assert.equal(ui.dialog().props.open, false);
  assert.equal(ui.trigger().props['data-connected'], true);
  assert.match(ui.text(ui.trigger()), /iPhone connected/);
  assert.match(
    ui.text(ui.notice()),
    /Pairing successful! Enable motion and calibrate/,
  );
  socket.receive({ type: 'input', pitch: 0, roll: 0 });
  assert.match(ui.text(ui.notice()), /Motion is live/);

  // Live packets must not close a settings dialog the user deliberately opens.
  ui.dialog().props.onOpenChange(true);
  socket.receive({ type: 'input', pitch: 0.2, roll: 0.1 });
  assert.equal(ui.dialog().props.open, true);
  assert.doesNotMatch(ui.text(ui.dialog()), /PAIRING CODE/);
});

test('loss and re-pairing never leave a stale success indicator', () => {
  const ui = harness();
  ui.dialog().props.onOpenChange(true);
  const socket = ui.sockets[0];
  socket.receive({ type: 'paired' });
  socket.receive({ type: 'suspended' });
  assert.match(ui.text(ui.notice()), /motion paused/);
  socket.receive({ type: 'unpaired' });
  assert.equal(ui.trigger().props['data-connected'], false);
  assert.match(ui.text(ui.notice()), /iPhone not connected/);
  socket.receive({ type: 'paired' });
  assert.equal(ui.trigger().props['data-connected'], true);
  socket.close();
  assert.equal(ui.trigger().props['data-connected'], false);
  assert.match(ui.text(ui.notice()), /Connection ended/);
});

test('relay loss clears the old code and reopening creates a fresh room', () => {
  const ui = harness();
  ui.dialog().props.onOpenChange(true);
  const oldSocket = ui.sockets[0];
  oldSocket.receive({
    type: 'room',
    code: '42',
    setupUrl: 'setup',
    controllerUrl: 'controller',
    fingerprint: 'test',
  });
  assert.match(ui.text(ui.dialog()), /PAIRING CODE.*42/);
  oldSocket.close();
  assert.doesNotMatch(ui.text(ui.dialog()), /PAIRING CODE|42/);
  assert.match(ui.text(ui.dialog()), /Reconnect/);
  ui.dialog().props.onOpenChange(false);
  ui.dialog().props.onOpenChange(true);
  assert.equal(ui.sockets.length, 2);
  ui.sockets[1].receive({
    type: 'room',
    code: '73',
    setupUrl: 'setup',
    controllerUrl: 'controller',
    fingerprint: 'test',
  });
  assert.match(ui.text(ui.dialog()), /PAIRING CODE.*73/);
  oldSocket.receive({ type: 'room', code: '42' });
  assert.doesNotMatch(ui.text(ui.dialog()), /42/);
});

test('a legacy six-digit relay cannot display an unusable code', () => {
  const ui = harness();
  ui.dialog().props.onOpenChange(true);
  ui.sockets[0].receive({ type: 'room', code: '566956' });
  assert.doesNotMatch(ui.text(ui.dialog()), /566956|PAIRING CODE/);
  assert.match(ui.text(ui.dialog()), /relay is outdated/);
});

test('all phone states share one two-line control, with no floating notice', () => {
  const ui = harness();
  ui.dialog().props.onOpenChange(true);
  const socket = ui.sockets[0];
  for (const [message, summary] of [
    [{ type: 'room', code: '42' }, 'Waiting for pairing'],
    [{ type: 'paired' }, 'Enable motion & calibrate'],
    [{ type: 'input', pitch: 0, roll: 0 }, 'Motion live'],
    [{ type: 'suspended' }, 'Motion paused · recalibrate'],
    [{ type: 'unpaired' }, 'Waiting for pairing'],
  ]) {
    socket.receive(message);
    assert.equal(
      ui.trigger().props.className,
      'phone-link-button phone-controller-control',
    );
    assert.ok(ui.text(ui.trigger()).includes(summary));
    assert.equal(ui.notice().props.className, 'sr-only');
    assert.doesNotMatch(
      JSON.stringify(ui.render()),
      /phone-connection-notice|phone-connection-feedback/,
    );
  }
});
