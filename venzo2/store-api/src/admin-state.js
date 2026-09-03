// A single owner object serializes admin mutations and counters. Never exposed
// as a public route. ORDERS remains untouched as the pre-upgrade backup.
export class AdminState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const { action, data = {} } = await request.json();
    const now = Date.now();
    const legacy = action.startsWith('config_') && !(await this.ctx.storage.get('configs'))
      ? await this.env.ORDERS?.get('configs:managed:v1', 'json') : null;
    let legacyAnnouncements = null;
    if (action.startsWith('announcements_') && !(await this.ctx.storage.get('announcements'))) {
      legacyAnnouncements = await this.env.ORDERS?.get('announcements:current', 'json');
      if (!legacyAnnouncements && this.env.ANNOUNCEMENTS_JSON) {
        try { legacyAnnouncements = JSON.parse(this.env.ANNOUNCEMENTS_JSON); } catch { /* optional legacy setting */ }
      }
    }
    const result = await this.ctx.storage.transaction(async (s) => {
      const audit = async (event) => {
        const rows = await s.get('audit') || [];
        await s.put('audit', [{ event, at: now }, ...rows].slice(0, 200));
      };
      if (action === 'rate') {
        const key = `rate:${data.key}`;
        const old = await s.get(key);
        const row = old?.until > now ? old : { count: 0, until: now + data.window };
        row.count++;
        await s.put(key, row);
        await s.put(`expiry:${row.until}:${key}`, key);
        return { allowed: row.count <= data.limit };
      }
      if (action === 'login') {
        const last = await s.get('otp-step') ?? -1;
        if (data.step <= last) return { ok: false };
        await s.put('otp-step', data.step);
        const epoch = await s.get('epoch') || 0;
        await s.put(`session:${data.hash}`, { epoch, until: now + 4 * 3600000, credential: data.credential });
        await s.put(`expiry:${now + 4 * 3600000}:session:${data.hash}`, `session:${data.hash}`);
        await audit('login');
        return { ok: true };
      }
      if (action === 'session') {
        const row = await s.get(`session:${data.hash}`);
        return { ok: !!row && row.until > now && row.epoch === (await s.get('epoch') || 0) && row.credential === data.credential };
      }
      if (action === 'logout') { await s.delete(`session:${data.hash}`); return { ok: true }; }
      if (action === 'revoke') { await s.put('epoch', (await s.get('epoch') || 0) + 1); await audit('revoke_all_sessions'); return { ok: true }; }
      if (action === 'audit') return { events: await s.get('audit') || [] };
      if (action.startsWith('config_')) {
        let doc = await s.get('configs');
        if (!doc) {
          doc = { revision: 1, groups: legacy?.groups || [], policy: { order: ['normal', 'masque', 'warp', 'wireguard'], enabled: true }, updated_at: now };
          if (new TextEncoder().encode(JSON.stringify(doc)).length > 110000) return { error: 'LEGACY_CONFIG_TOO_LARGE', status: 409 };
          await s.put('configs', doc);
          await s.put('config-history:1', doc);
        }
        if (action === 'config_get') return doc;
        const history = await s.get('config-history-index') || [1];
        if (action === 'config_history') return { revisions: history };
        if (Number(data.revision) !== doc.revision) return { error: 'REVISION_CONFLICT', status: 409 };
        let next;
        if (action === 'config_restore') {
          next = await s.get(`config-history:${data.target}`);
          if (!next) return { error: 'REVISION_NOT_FOUND', status: 404 };
        } else if (action === 'config_publish') next = data.document;
        else return { error: 'UNKNOWN_ACTION', status: 400 };
        next = { ...next, revision: doc.revision + 1, updated_at: now };
        if (new TextEncoder().encode(JSON.stringify(next)).length > 110000) return { error: 'CONFIG_TOO_LARGE', status: 413 };
        const revisions = [next.revision, ...history];
        for (const id of revisions.slice(20)) await s.delete(`config-history:${id}`);
        await s.put('config-history-index', revisions.slice(0, 20));
        await s.put(`config-history:${next.revision}`, next);
        await s.put('configs', next);
        await audit(action);
        return next;
      }
      if (action === 'announcements_get') return await s.get('announcements') || { revision: 0, announcements: Array.isArray(legacyAnnouncements) ? legacyAnnouncements.slice(0, 20) : [] };
      if (action === 'announcements_put') {
        const old = await s.get('announcements') || { revision: 0 };
        if (Number(data.revision) !== old.revision) return { error: 'REVISION_CONFLICT', status: 409 };
        const next = { revision: old.revision + 1, announcements: data.announcements };
        await s.put('announcements', next); await audit('announcements_publish'); return next;
      }
      if (action === 'connection') {
        const day = new Date(now).toISOString().slice(0, 10);
        const dedup = `event:${data.event_id}`;
        if (await s.get(dedup)) return { accepted: true, duplicate: true };
        const key = `quality:${day}`;
        const row = await s.get(key) || { date: day, attempts: 0, success: 0, failure: 0, cancelled: 0, duration_ms: 0, success_duration_ms: 0, transports: {}, versions: {}, errors: {} };
        row.attempts++; row[data.outcome]++; row.duration_ms += data.duration_ms;
        if (data.outcome === 'success') row.success_duration_ms += data.duration_ms;
        for (const [field, value] of [['transports', data.transport], ['versions', data.app_version], ['errors', data.error]]) {
          if (!value) continue;
          const name = Object.hasOwn(row[field], value) || Object.keys(row[field]).length < 30 ? value : 'other';
          const bucket = row[field][name] || { attempts: 0, success: 0, failure: 0, cancelled: 0 };
          bucket.attempts++; bucket[data.outcome]++; row[field][name] = bucket;
        }
        await s.put(key, row); await s.put(dedup, true);
        const until = now + 31 * 86400000;
        await s.put(`expiry:${until}:${dedup}`, dedup);
        // Same daily expiry key is reused; counters are retained for 31 days.
        await s.put(`expiry:${Date.parse(day) + 32 * 86400000}:${key}`, key);
        return { accepted: true };
      }
      if (action === 'quality') {
        const days = [];
        for (let i = 29; i >= 0; i--) {
          const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
          days.push(await s.get(`quality:${date}`) || { date, attempts: 0, success: 0, failure: 0, cancelled: 0, success_duration_ms: 0 });
        }
        return { days, source: 'opt-in-client-reports', retention_days: 31 };
      }
      if (action === 'open') {
        const day = new Date(now).toISOString().slice(0, 10);
        const key = `opens:${day}`;
        const row = await s.get(key) || { date: day, opens: 0, unique: 0 };
        const visitorKey = `seen:${day}:${data.install_id}`;
        if (!(await s.get(visitorKey))) {
          row.unique++;
          await s.put(visitorKey, true);
          await s.put(`expiry:${now + 31 * 86400000}:${visitorKey}`, visitorKey);
        }
        row.opens++;
        await s.put(key, row);
        await s.put(`expiry:${Date.parse(day) + 32 * 86400000}:${key}`, key);
        return { accepted: true };
      }
      if (action === 'opens') return { days: [...(await s.list({ prefix: 'opens:' })).values()] };
      return { error: 'UNKNOWN_ACTION', status: 400 };
    });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 86400000);
    return Response.json(result, { status: result.status || 200 });
  }

  async alarm() {
    const now = Date.now();
    const entries = await this.ctx.storage.list({ prefix: 'expiry:', end: `expiry:${now}:~`, limit: 1000 });
    await this.ctx.storage.transaction(async s => {
      for (const [index, key] of entries) {
        const row = await s.get(key);
        if (!row?.until || row.until <= now) await s.delete(key);
        await s.delete(index);
      }
    });
    await this.ctx.storage.setAlarm(now + (entries.size === 1000 ? 60000 : 86400000));
  }
}

export async function adminState(env, action, data = {}) {
  if (!env.ADMIN_STATE) throw new Error('ADMIN_STATE_NOT_CONFIGURED');
  const stub = env.ADMIN_STATE.get(env.ADMIN_STATE.idFromName('venzo-owner-v1'));
  const response = await stub.fetch('https://state.internal/', { method: 'POST', body: JSON.stringify({ action, data }) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error); error.status = response.status; throw error; }
  return result;
}
