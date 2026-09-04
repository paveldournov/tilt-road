import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';

export function ensureCertificates(directory, addresses) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const openssl =
    process.env.ROADTILT_OPENSSL ||
    (existsSync('D:/git/usr/bin/openssl.exe')
      ? 'D:/git/usr/bin/openssl.exe'
      : 'openssl');
  const run = (...args) =>
    execFileSync(openssl, args, {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  try {
    run('version');
  } catch {
    throw new Error(
      'OpenSSL is required. Install OpenSSL or set ROADTILT_OPENSSL to its executable path.',
    );
  }
  const root = resolve(directory, 'ca.pem'),
    rootKey = resolve(directory, 'ca-key.pem');
  if (!existsSync(root) && !existsSync(rootKey)) {
    run(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '30',
      '-keyout',
      'ca-key.pem',
      '-out',
      'ca.pem',
      '-subj',
      '/CN=RoadTilt Local Controller/O=RoadTilt Development',
      '-addext',
      'basicConstraints=critical,CA:TRUE,pathlen:0',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    );
  }
  if (!existsSync(root) || !existsSync(rootKey))
    throw new Error(
      'Local CA files are incomplete. Restore the matching CA certificate and key before starting.',
    );
  const ca = new X509Certificate(readFileSync(root));
  if (new Date(ca.validTo).getTime() < Date.now() + 86400000)
    throw new Error(
      'The local CA expires soon. Remove its profile from the iPhone, archive .local/phone, then run phone:server to create a new CA.',
    );
  const sans = [
    'DNS:localhost',
    'IP:127.0.0.1',
    ...addresses.map((ip) => `IP:${ip}`),
  ].join(',');
  const last = existsSync(resolve(directory, 'sans.txt'))
    ? readFileSync(resolve(directory, 'sans.txt'), 'utf8')
    : '';
  if (
    last !== sans ||
    !existsSync(resolve(directory, 'server.pem')) ||
    new Date(
      new X509Certificate(readFileSync(resolve(directory, 'server.pem')))
        .validTo,
    ).getTime() <
      Date.now() + 86400000
  ) {
    run(
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-keyout',
      'server-key.pem',
      '-out',
      'server.csr',
      '-subj',
      '/CN=RoadTilt Local Controller',
      '-addext',
      `subjectAltName=${sans}`,
      '-addext',
      'extendedKeyUsage=serverAuth',
      '-addext',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext',
      'basicConstraints=critical,CA:FALSE',
    );
    run(
      'x509',
      '-req',
      '-in',
      'server.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca-key.pem',
      '-CAcreateserial',
      '-out',
      'server.pem',
      '-days',
      '29',
      '-sha256',
      '-copy_extensions',
      'copy',
    );
    writeFileSync(resolve(directory, 'sans.txt'), sans, { mode: 0o600 });
  }
  return {
    key: readFileSync(resolve(directory, 'server-key.pem')),
    cert: readFileSync(resolve(directory, 'server.pem')),
    ca: readFileSync(root),
    publicDer: ca.raw,
    fingerprint: ca.fingerprint256,
    expires: ca.validTo,
  };
}
