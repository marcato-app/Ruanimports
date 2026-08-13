const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveHash(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return bytesToHex(bits);
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await deriveHash(password, saltBytes);
  return `${bytesToHex(saltBytes)}:${hashHex}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const saltBytes = hexToBytes(saltHex);
  const computed = await deriveHash(password, saltBytes);
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

export function newToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

const SESSION_DAYS = 7;

export async function createSession(db, adminId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, adminId, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function getSessionAdmin(db, token) {
  if (!token) return null;
  const row = await db.prepare(
    'SELECT a.id, a.username FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id WHERE s.token = ? AND s.expires_at > ?'
  ).bind(token, new Date().toISOString()).first();
  return row || null;
}

export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `rpi_admin_session=${token}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie() {
  return 'rpi_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict';
}
