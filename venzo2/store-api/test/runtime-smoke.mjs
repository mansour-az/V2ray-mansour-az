// Run manually after installing the same Wrangler version as deployment:
// npm install --no-save --package-lock=false wrangler@4.45.0
// node test/runtime-smoke.mjs
// No production account, credentials, network endpoints or persistent storage.
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { totp } from '../src/admin-phase1.js';

const secret = 'runtime-test-only-password-at-least-32-characters';
const otpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  cf: false,
  scriptPath: new URL('../src/router.js', import.meta.url).pathname,
  compatibilityDate: '2025-10-01',
  compatibilityFlags: ['nodejs_compat'],
  kvNamespaces: ['ORDERS'],
  durableObjects: {
    ADMIN_STATE: { className: 'AdminState', useSQLite: true },
    ACCOUNT_LEDGER: { className: 'AccountLedger', useSQLite: true },
  },
  bindings: { ADMIN_LOGIN_SECRET: secret, ADMIN_TOTP_SECRET: otpSecret, PROVISION_SECRET: 'test-provision-not-owner' },
});
const base = 'https://venzo.example';
let cookie = '';
async function send(path, method = 'GET', body) {
  return mf.dispatchFetch(base + path, { method, headers: { origin: base,
    'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
try {
  await mf.ready;
  assert.equal((await send('/admin')).status, 200);
  assert.equal((await send('/v1/internal/admin/configs')).status, 401);
  const response = await send('/v1/internal/admin/login', 'POST', {
    secret, otp: await totp(otpSecret, Math.floor(Date.now()/30000)),
  });
  assert.equal(response.status, 200, await response.text());
  cookie = response.headers.get('set-cookie').split(';')[0];
  const doc = await (await send('/v1/internal/admin/configs')).json();
  const input = { ...doc, groups: [{ id:'one',name:'fixture',configs:['vless://test@example.invalid:443'],enabled:true }] };
  const preview = await (await send('/v1/internal/admin/configs/preview','POST',input)).json();
  const published = await send('/v1/internal/admin/configs/publish','POST',{...input,fingerprint:preview.fingerprint});
  assert.equal(published.status, 200, await published.text());
  assert.equal((await send('/v1/internal/admin/configs/publish','POST',{...input,fingerprint:preview.fingerprint})).status,409);
  assert.equal((await (await send('/v1/connection-policy')).json()).revision,2);
  const event={consent:true,install_id:'a'.repeat(32),event_id:'b'.repeat(32),app_version:'2.11.0',outcome:'success',transport:'masque',duration_ms:500,error:'none'};
  const responses=await Promise.all(Array.from({length:8},()=>send('/v1/telemetry/connection','POST',event)));
  assert.ok(responses.every(r=>r.status===202));
  const quality=await(await send('/v1/internal/admin/quality')).json();
  assert.equal(quality.days.at(-1).attempts,1);
  assert.equal((await send('/v1/internal/admin/revoke','POST',{})).status,200);
  assert.equal((await send('/v1/internal/admin/configs')).status,401);
  console.log('PASS: real workerd + SQLite owner login, revision conflict, concurrent telemetry dedup and session revocation');
} finally {
  await mf.dispose();
}
