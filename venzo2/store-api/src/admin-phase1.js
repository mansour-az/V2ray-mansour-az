import { adminState } from './admin-state.js';
import { ownerPage } from './admin-ui.js';

const ENCODER = new TextEncoder();
const TRANSPORTS = ['normal', 'masque', 'warp', 'wireguard'];
const SCHEMES = new Set(['vless:', 'vmess:', 'trojan:', 'ss:', 'ssr:', 'hysteria2:', 'hy2:', 'tuic:', 'masque:', 'wireguard:']);
const COOKIE = '__Host-venzo_owner';
export function reply(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function randomHex() { return [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''); }
function configured(env) {
  return !!env.ADMIN_STATE && String(env.ADMIN_LOGIN_SECRET || '').length >= 32 && /^[A-Z2-7]{32,128}$/.test(env.ADMIN_TOTP_SECRET || '') && env.ADMIN_LOGIN_SECRET !== env.PROVISION_SECRET;
}
async function credentialVersion(env) { return digest(`${env.ADMIN_LOGIN_SECRET}:${env.ADMIN_TOTP_SECRET}`); }
function cookie(request) {
  return (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
}
function sessionCookie(value, age = 14400) { return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`; }
async function equal(a, b) {
  const left = await digest(a), right = await digest(b);
  let diff = 0; for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export async function totp(secret, step, digits = 6) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let buffer = 0, bits = 0; const bytes = [];
  for (const ch of secret) { buffer = (buffer << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
  const key = await crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new Uint8Array(8); new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const n = mac[mac.length - 1] & 15;
  const value = ((mac[n] & 127) << 24) | (mac[n + 1] << 16) | (mac[n + 2] << 8) | mac[n + 3];
  return String(value % 10 ** digits).padStart(digits, '0');
}
async function jsonBody(request, max = 120000) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw httpError('JSON_REQUIRED', 415);
  const reader = request.body?.getReader(); if (!reader) throw httpError('INVALID_JSON', 400);
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw httpError('BODY_TOO_LARGE', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch { throw httpError('INVALID_JSON', 400); }
}
function httpError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function sameOrigin(request) { return request.headers.get('origin') === new URL(request.url).origin; }

export async function requireOwnerSession(request, env) {
  if (!configured(env)) return { ok: false, error: 'ADMIN_NOT_CONFIGURED', status: 503 };
  const value = cookie(request);
  if (!/^[a-f0-9]{64}$/.test(value)) return { ok: false, error: 'ADMIN_LOGIN_REQUIRED', status: 401 };
  const result = await adminState(env, 'session', { hash: await digest(value), credential: await credentialVersion(env) });
  return result.ok ? { ok: true } : { ok: false, error: 'ADMIN_SESSION_EXPIRED', status: 401 };
}

export function normalizeDocument(body) {
  if (!Array.isArray(body.groups) || body.groups.length > 40) throw httpError('INVALID_GROUPS');
  const diagnostics = { invalid: 0, duplicates: 0, valid: 0, enabled: 0 };
  const seen = new Set(), ids = new Set(); let total = 0;
  const groups = body.groups.map((raw, i) => {
    const name = String(raw.name || '').trim();
    const id = String(raw.id || `group-${i + 1}`);
    const transport = raw.transport || 'normal';
    if (!name || name.length > 80 || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id) || !TRANSPORTS.includes(transport)) throw httpError('INVALID_GROUP');
    ids.add(id);
    const expires = Number(raw.expires_at || 0);
    if (!Number.isSafeInteger(expires) || expires < 0) throw httpError('INVALID_EXPIRY');
    const lines = Array.isArray(raw.configs) ? raw.configs : String(raw.configs || '').split(/\r?\n/);
    const configs = [];
    for (const line of lines) {
      const value = String(line).trim(); if (!value) continue;
      let valid = false;
      try {
        const url = new URL(value);
        valid = value.length <= 8192 && SCHEMES.has(url.protocol) && !!url.hostname;
        if (transport === 'masque') valid &&= url.protocol === 'masque:';
        if (transport === 'warp' || transport === 'wireguard') valid &&= url.protocol === 'wireguard:';
      } catch { /* Invalid config is counted, never silently published. */ }
      if (!valid) { diagnostics.invalid++; continue; }
      // Fragments only name a node and are ignored for duplicate detection.
      const identity = value.split('#')[0];
      if (seen.has(identity)) { diagnostics.duplicates++; continue; }
      seen.add(identity); configs.push(value); total++;
    }
    diagnostics.valid += configs.length;
    if (raw.enabled !== false && (!expires || expires > Date.now())) diagnostics.enabled += configs.length;
    return { id, name, transport, enabled: raw.enabled !== false, expires_at: expires, configs };
  });
  if (total > 500 || ENCODER.encode(JSON.stringify(groups)).length > 100000) throw httpError('CONFIG_TOO_LARGE', 413);
  const order = body.policy?.order || TRANSPORTS;
  if (!Array.isArray(order) || order.length !== 4 || new Set(order).size !== 4 || order[0] !== 'normal' || order.some(x => !TRANSPORTS.includes(x))) throw httpError('INVALID_FALLBACK_ORDER');
  return { document: { groups, policy: { order, enabled: body.policy?.enabled !== false } }, diagnostics };
}

export function normalizeAnnouncements(body) {
  if (!Array.isArray(body.announcements) || body.announcements.length > 20) throw httpError('INVALID_ANNOUNCEMENTS');
  const ids = new Set();
  return body.announcements.map(raw => {
    const item = { id: String(raw.id || ''), title: String(raw.title || '').trim(), body: String(raw.body || '').trim(), type: raw.type, action_url: raw.action_url || null, starts_at: Number(raw.starts_at || 0), expires_at: Number(raw.expires_at || 0), enabled: raw.enabled !== false };
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || !item.title || item.title.length > 120 || !item.body || item.body.length > 500 || !['news', 'discount', 'update'].includes(item.type)) throw httpError('INVALID_ANNOUNCEMENT');
    ids.add(item.id);
    if (![item.starts_at, item.expires_at].every(n => Number.isSafeInteger(n) && n >= 0) || (item.expires_at && item.expires_at <= item.starts_at)) throw httpError('INVALID_SCHEDULE');
    if (item.action_url) { let url; try { url = new URL(item.action_url); } catch { throw httpError('INVALID_ACTION_URL'); } if (url.protocol !== 'https:' || url.username || url.password || item.action_url.length > 2048) throw httpError('INVALID_ACTION_URL'); }
    return item;
  });
}

export async function publicManagedLines(env) {
  const doc = await adminState(env, 'config_get');
  const legacy = doc.legacy_fallback ? await env.ORDERS?.get('configs:managed:v1', 'json') : null;
  const groups = doc.legacy_fallback ? (legacy?.groups || []) : doc.groups;
  return groups.filter(g => g.enabled !== false && (!g.expires_at || g.expires_at > Date.now())).flatMap(g => (g.configs || []).map(line => g.transport === 'warp' ? `${line.split('#')[0]}#WARP-${encodeURIComponent(g.name)}` : line));
}

export async function phaseOneRouter(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/admin' && request.method === 'GET') return ownerPage();
  const admin = path.startsWith('/v1/internal/admin/');
  const telemetry = path === '/v1/telemetry/connection' || path === '/v1/telemetry/app-open';
  const publicRoute = path === '/v1/connection-policy' || path === '/v1/announcements';
  if (!admin && !telemetry && !publicRoute) return null;
  try {
    if (!env.ADMIN_STATE) return reply({ error: 'ADMIN_NOT_CONFIGURED' }, 503);
    if (admin && !['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) return reply({ error: 'ORIGIN_REJECTED' }, 403);
    if (path.endsWith('/admin/login') && request.method === 'POST') {
      if (!configured(env)) return reply({ error: 'ADMIN_NOT_CONFIGURED' }, 503);
      const hash = await digest(`${env.ADMIN_LOGIN_SECRET}:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
      const rate = await adminState(env, 'rate', { key: `login:${hash}`, window: 600000, limit: 8 });
      if (!rate.allowed) return reply({ error: 'TOO_MANY_ATTEMPTS' }, 429);
      const b = await jsonBody(request, 4096);
      let validStep = -1;
      const step = Math.floor(Date.now() / 30000);
      if (/^[0-9]{6}$/.test(String(b.otp || ''))) for (const offset of [-1, 0, 1]) if (await equal(String(b.otp), await totp(env.ADMIN_TOTP_SECRET, step + offset))) validStep = step + offset;
      if (!(await equal(String(b.secret || ''), env.ADMIN_LOGIN_SECRET)) || validStep < 0) return reply({ error: 'INVALID_CREDENTIALS' }, 401);
      const session = randomHex();
      const accepted = await adminState(env, 'login', { step: validStep, hash: await digest(session), credential: await credentialVersion(env) });
      if (!accepted.ok) return reply({ error: 'OTP_ALREADY_USED' }, 401);
      return reply({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(session) });
    }
    if (admin) {
      const auth = await requireOwnerSession(request, env); if (!auth.ok) return reply({ error: auth.error }, auth.status);
      if (path.endsWith('/session') && request.method === 'GET') return reply({ authenticated: true });
      if (path.endsWith('/logout') && request.method === 'POST') { await adminState(env, 'logout', { hash: await digest(cookie(request)) }); return reply({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) }); }
      if (path.endsWith('/revoke') && request.method === 'POST') { await adminState(env, 'revoke'); return reply({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) }); }
      if (path.endsWith('/audit') && request.method === 'GET') return reply(await adminState(env, 'audit'));
      if (path.endsWith('/quality') && request.method === 'GET') return reply(await adminState(env, 'quality'));
      if (path.endsWith('/legacy-usage') && request.method === 'GET') {
        const { readLegacyUsage } = await import('./admin-console.js');
        return reply(await readLegacyUsage(env));
      }
      if (path.endsWith('/catalog') && request.method === 'GET') {
        const catalog = await env.ORDERS?.get('free:catalog:v3', 'json');
        return reply({ updated_at: catalog?.updated_at || 0, configs: catalog?.configs || [], sources: catalog?.sources || [] });
      }
      if (path.endsWith('/opens') && request.method === 'GET') return reply(await adminState(env, 'opens'));
      if (path.endsWith('/configs') && request.method === 'GET') return reply(await adminState(env, 'config_get'));
      if (path.endsWith('/configs/history') && request.method === 'GET') return reply(await adminState(env, 'config_history'));
      if (path.endsWith('/configs/restore') && request.method === 'POST') return reply(await adminState(env, 'config_restore', await jsonBody(request, 1024)));
      if ((path.endsWith('/configs/preview') || path.endsWith('/configs/publish')) && request.method === 'POST') {
        const b = await jsonBody(request); const parsed = normalizeDocument(b);
        const current = await adminState(env, 'config_get');
        const legacy = current.legacy_fallback ? await env.ORDERS?.get('configs:managed:v1', 'json') : null;
        const oldGroups = current.legacy_fallback ? (legacy?.groups || []) : current.groups;
        const old = new Set(oldGroups.flatMap(g => g.configs || [])), next = new Set(parsed.document.groups.flatMap(g => g.configs));
        const diff = { added: [...next].filter(x => !old.has(x)).length, removed: [...old].filter(x => !next.has(x)).length };
        const fingerprint = await digest(JSON.stringify(parsed.document));
        if (path.endsWith('/preview')) return reply({ ...parsed, diff, fingerprint, revision: current.revision });
        if (parsed.diagnostics.invalid || parsed.diagnostics.duplicates) throw httpError('PREVIEW_HAS_REJECTED_LINES');
        if (b.fingerprint !== fingerprint) throw httpError('PREVIEW_REQUIRED');
        return reply(await adminState(env, 'config_publish', { revision: b.revision, document: parsed.document }));
      }
      if (path.endsWith('/announcements') && request.method === 'GET') return reply(await adminState(env, 'announcements_get'));
      if (path.endsWith('/announcements') && request.method === 'PUT') { const b = await jsonBody(request, 25000); return reply(await adminState(env, 'announcements_put', { revision: b.revision, announcements: normalizeAnnouncements(b) })); }
      return reply({ error: 'NOT_FOUND' }, 404);
    }
    if (publicRoute && request.method === 'GET') {
      if (path === '/v1/connection-policy') { const doc = await adminState(env, 'config_get'); return reply({ version: 1, revision: doc.revision, ...doc.policy }); }
      const stored = await adminState(env, 'announcements_get');
      const now = Date.now();
      return reply({ announcements: stored.announcements.filter(a => a.enabled !== false && (!a.starts_at || a.starts_at <= now) && (!a.expires_at || a.expires_at > now)), checked_at: now });
    }
    if (telemetry && request.method === 'POST') {
      const b = await jsonBody(request, 2048);
      // Old clients have not consented to this upgraded analytics pipeline.
      if (b.consent !== true) return reply({ accepted: false, reason: 'CONSENT_REQUIRED' }, 202);
      if (!/^[a-f0-9]{32}$/.test(b.install_id || '') || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b.app_version || '')) throw httpError('INVALID_EVENT');
      if (b.install_id === 'abcdefabcdefabcdefabcdefabcdefab') return reply({ accepted: true, diagnostic: true }, 202);
      const ipBucket = await digest(`${env.ADMIN_LOGIN_SECRET}:${new Date().toISOString().slice(0, 10)}:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
      const globalRate = await adminState(env, 'rate', { key: `ip:${ipBucket}`, window: 3600000, limit: 600 });
      if (!globalRate.allowed) return reply({ error: 'TOO_MANY_EVENTS' }, 429);
      const clientRate = await adminState(env, 'rate', { key: `telemetry:${b.install_id}`, window: 3600000, limit: 60 });
      if (!clientRate.allowed) return reply({ error: 'TOO_MANY_EVENTS' }, 429);
      if (path.endsWith('/app-open')) return reply(await adminState(env, 'open', { install_id: b.install_id }), 202);
      if (!/^[a-f0-9]{32}$/.test(b.event_id || '') || !['success', 'failure', 'cancelled'].includes(b.outcome) || !TRANSPORTS.includes(b.transport) || !Number.isInteger(b.duration_ms) || b.duration_ms < 0 || b.duration_ms > 600000 || !['none', 'no_candidates', 'no_traffic', 'route_unverified', 'internal', 'cancelled'].includes(b.error)) throw httpError('INVALID_EVENT');
      const data = Object.fromEntries(['event_id', 'app_version', 'outcome', 'transport', 'duration_ms', 'error'].map(k => [k, b[k]]));
      return reply(await adminState(env, 'connection', data), 202);
    }
    return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  } catch (error) {
    return reply({ error: error.status ? error.message : 'SERVICE_UNAVAILABLE' }, error.status || 503);
  }
}
