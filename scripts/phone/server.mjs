import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureCertificates } from './certificates.mjs';
import { attachRelay, isLoopback } from './relay.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const addresses = [
  ...new Set(
    Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address),
  ),
];
const httpPort = Number(process.env.ROADTILT_HTTP_PORT || 8786),
  httpsPort = Number(process.env.ROADTILT_HTTPS_PORT || 8787);
const preferred =
  process.env.ROADTILT_LAN_IP ||
  addresses.find((ip) => ip.startsWith('192.168.')) ||
  addresses[0] ||
  '127.0.0.1';
if (!addresses.includes(preferred) && preferred !== '127.0.0.1')
  throw new Error('ROADTILT_LAN_IP must be assigned to this computer.');
const certs = ensureCertificates(resolve(project, '.local/phone'), addresses);
const origins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const hosts = ['localhost', '127.0.0.1', ...addresses];
const phoneOrigins = hosts.map((host) => `https://${host}:${httpsPort}`);
const info = {
  setupUrl: `http://${preferred}:${httpPort}/setup`,
  controllerUrl: `https://${preferred}:${httpsPort}/controller`,
  fingerprint: certs.fingerprint,
};
const payloadUUID = randomUUID(),
  profileUUID = randomUUID();
const profile = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadCertificateFileName</key><string>RoadTilt-local-ca.cer</string><key>PayloadContent</key><data>${certs.publicDer.toString('base64')}</data><key>PayloadDescription</key><string>Development root certificate for your local RoadTilt controller. Remove after testing.</string><key>PayloadDisplayName</key><string>RoadTilt Local Controller</string><key>PayloadIdentifier</key><string>local.roadtilt.ca</string><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadUUID</key><string>${payloadUUID}</string><key>PayloadVersion</key><integer>1</integer></dict></array><key>PayloadDisplayName</key><string>RoadTilt Local Controller</string><key>PayloadDescription</key><string>Installs only the local development certificate. No management, VPN, or data collection.</string><key>PayloadIdentifier</key><string>local.roadtilt.profile</string><key>PayloadOrganization</key><string>RoadTilt</string><key>PayloadRemovalDisallowed</key><false/><key>PayloadType</key><string>Configuration</string><key>PayloadUUID</key><string>${profileUUID}</string><key>PayloadVersion</key><integer>1</integer></dict></plist>`;
const assets = new Map([
  ['/controller', ['controller.html', 'text/html; charset=utf-8']],
  ['/controller.js', ['controller.js', 'text/javascript; charset=utf-8']],
  ['/motion.js', ['motion.js', 'text/javascript; charset=utf-8']],
  ['/controller.css', ['controller.css', 'text/css; charset=utf-8']],
]);
async function handler(req, res) {
  const secure = Boolean(req.socket.encrypted),
    port = secure ? httpsPort : httpPort;
  if (!hosts.some((host) => req.headers.host === `${host}:${port}`)) {
    res.writeHead(403).end('Unknown host');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(self), gyroscope=(self), magnetometer=()',
  );
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'roadtilt-phone' }));
    return;
  }
  if (path === '/info') {
    if (
      !isLoopback(req.socket.remoteAddress) ||
      !origins.includes(req.headers.origin)
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(info));
    return;
  }
  if (path === '/roadtilt.mobileconfig') {
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="RoadTilt.mobileconfig"',
    );
    res.end(profile);
    return;
  }
  if (path === '/' || path === '/setup') {
    let page = await readFile(resolve(project, 'phone/setup.html'), 'utf8');
    page = page
      .replaceAll('{{CONTROLLER_URL}}', info.controllerUrl)
      .replaceAll('{{FINGERPRINT}}', certs.fingerprint)
      .replaceAll('{{EXPIRY}}', certs.expires);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page);
    return;
  }
  if (assets.has(path)) {
    if (!secure && path !== '/controller.css') {
      res.writeHead(302, { Location: `${info.controllerUrl}` }).end();
      return;
    }
    const [file, type] = assets.get(path);
    res.setHeader('Content-Type', type);
    res.end(await readFile(resolve(project, 'phone', file)));
    return;
  }
  res.writeHead(404).end('Not found');
}
const listener = (req, res) => {
  handler(req, res).catch((error) => {
    console.error('Request failed:', error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('Local server error');
  });
};
const plain = http.createServer(listener),
  tls = https.createServer(
    { key: certs.key, cert: certs.cert, minVersion: 'TLSv1.2' },
    listener,
  );
const relay = attachRelay(plain, tls, { origins, phoneOrigins, info });
for (const server of [plain, tls])
  server.on('error', (error) => {
    console.error(error.message);
    relay.close();
    plain.close();
    tls.close();
    process.exitCode = 1;
  });
plain.listen(httpPort, '0.0.0.0', () =>
  console.log(`iPhone setup: ${info.setupUrl}`),
);
tls.listen(httpsPort, '0.0.0.0', () => {
  console.log(`iPhone controller: ${info.controllerUrl}`);
  console.log(`CA SHA-256: ${certs.fingerprint}`);
  console.log(
    'Game stays at http://localhost:3000 — click Connect iPhone. Keep both devices on the same LAN.',
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    relay.close();
    plain.close();
    tls.close();
  });
