const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_SESSION_PREFIX = "admin:session:";
const MANAGED_CONFIGS_KEY = "configs:managed:v1";
const VISITOR_INDEX_KEY = "analytics:visitors:index:v1";
const VISITOR_PREFIX = "analytics:visitor:";
const DAILY_PREFIX = "analytics:day:";
const MAX_MANAGED_GROUPS = 40;
const MAX_CONFIGS_PER_GROUP = 500;
const MAX_VISITOR_INDEX = 2500;
const DIAGNOSTIC_INSTALL_ID = "abcdefabcdefabcdefabcdefabcdefab";
const SUPPORTED_SCHEMES = new Set([
  "vless:",
  "vmess:",
  "trojan:",
  "ss:",
  "ssr:",
  "hysteria2:",
  "hy2:",
  "tuic:",
]);

export async function adminConsoleRouter(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/admin") {
    return adminPage();
  }
  if (request.method === "POST" && url.pathname === "/v1/internal/admin/login") {
    return adminLogin(request, env);
  }
  if (request.method === "POST" && url.pathname === "/v1/internal/admin/logout") {
    return adminLogout(request, env);
  }
  if (request.method === "GET" && url.pathname === "/v1/internal/admin/session") {
    const auth = await requireAdmin(request, env);
    return auth.ok
      ? json({ authenticated: true })
      : json({ authenticated: false }, 401);
  }
  if (request.method === "GET" && url.pathname === "/v1/internal/admin/summary") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return adminSummary(env);
  }
  if (request.method === "GET" && url.pathname === "/v1/internal/admin/visitors") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return adminVisitors(url, env);
  }
  if (request.method === "GET" && url.pathname === "/v1/internal/admin/configs") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return json({ groups: await readManagedConfigGroups(env) });
  }
  if (request.method === "POST" && url.pathname === "/v1/internal/admin/configs") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return createManagedConfigGroup(request, env);
  }
  const configMatch = url.pathname.match(/^\/v1\/internal\/admin\/configs\/([a-f0-9]{24})$/);
  if (configMatch && ["PUT", "DELETE"].includes(request.method)) {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return request.method === "PUT"
      ? updateManagedConfigGroup(request, env, configMatch[1])
      : deleteManagedConfigGroup(env, configMatch[1]);
  }
  if (request.method === "POST" && url.pathname === "/v1/telemetry/app-open") {
    return recordAppOpen(request, env);
  }
  return null;
}

export async function readManagedConfigLines(env) {
  const groups = await readManagedConfigGroups(env);
  return groups
    .filter((group) => group.enabled !== false)
    .flatMap((group) => Array.isArray(group.configs) ? group.configs : []);
}

async function adminLogin(request, env) {
  if (!env.ORDERS || !validSecret(env.PROVISION_SECRET)) {
    return json({ error: "ADMIN_NOT_CONFIGURED" }, 503);
  }
  const clientKey = await clientFingerprint(request);
  const blocked = await env.ORDERS.get(`admin:attempt:${clientKey}`, "json");
  if (Number(blocked?.count || 0) >= 8) {
    return json({ error: "TOO_MANY_ATTEMPTS" }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const supplied = String(body?.secret || "");
  if (!(await safeSecretEqual(supplied, String(env.PROVISION_SECRET || "")))) {
    await env.ORDERS.put(
      `admin:attempt:${clientKey}`,
      JSON.stringify({ count: Number(blocked?.count || 0) + 1 }),
      { expirationTtl: 10 * 60 },
    );
    return json({ error: "INVALID_CREDENTIALS" }, 401);
  }
  await env.ORDERS.delete(`admin:attempt:${clientKey}`);
  const session = randomHex(32);
  await env.ORDERS.put(
    `${ADMIN_SESSION_PREFIX}${await sha256(session)}`,
    JSON.stringify({ created_at: Date.now() }),
    { expirationTtl: ADMIN_SESSION_TTL_SECONDS },
  );
  return json(
    { authenticated: true, expires_in: ADMIN_SESSION_TTL_SECONDS },
    200,
    { "Set-Cookie": adminCookie(session, ADMIN_SESSION_TTL_SECONDS) },
  );
}

async function adminLogout(request, env) {
  const session = cookieValue(request, "venzo_admin");
  if (session && env.ORDERS) {
    await env.ORDERS.delete(`${ADMIN_SESSION_PREFIX}${await sha256(session)}`);
  }
  return json(
    { authenticated: false },
    200,
    { "Set-Cookie": adminCookie("", 0) },
  );
}

export async function requireAdmin(request, env) {
  if (!env.ORDERS || !validSecret(env.PROVISION_SECRET)) {
    return { ok: false, error: "ADMIN_NOT_CONFIGURED", status: 503 };
  }
  const authorization = String(request.headers.get("authorization") || "");
  if (authorization.startsWith("Bearer ")) {
    const supplied = authorization.slice(7).trim();
    if (await safeSecretEqual(supplied, String(env.PROVISION_SECRET))) return { ok: true };
  }
  const session = cookieValue(request, "venzo_admin");
  if (!/^[a-f0-9]{64}$/.test(session)) {
    return { ok: false, error: "ADMIN_LOGIN_REQUIRED", status: 401 };
  }
  const stored = await env.ORDERS.get(`${ADMIN_SESSION_PREFIX}${await sha256(session)}`);
  return stored
    ? { ok: true }
    : { ok: false, error: "ADMIN_SESSION_EXPIRED", status: 401 };
}

async function createManagedConfigGroup(request, env) {
  const parsed = await configPayload(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const groups = await readManagedConfigGroups(env);
  if (groups.length >= MAX_MANAGED_GROUPS) return json({ error: "CONFIG_GROUP_LIMIT" }, 409);
  const now = Date.now();
  const group = {
    id: randomHex(12),
    name: parsed.name,
    enabled: parsed.enabled,
    configs: parsed.configs,
    created_at: now,
    updated_at: now,
  };
  groups.unshift(group);
  await writeManagedConfigGroups(env, groups);
  return json({ group: publicConfigGroup(group) }, 201);
}

async function updateManagedConfigGroup(request, env, id) {
  const parsed = await configPayload(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const groups = await readManagedConfigGroups(env);
  const index = groups.findIndex((group) => group.id === id);
  if (index < 0) return json({ error: "CONFIG_GROUP_NOT_FOUND" }, 404);
  groups[index] = {
    ...groups[index],
    name: parsed.name,
    enabled: parsed.enabled,
    configs: parsed.configs,
    updated_at: Date.now(),
  };
  await writeManagedConfigGroups(env, groups);
  return json({ group: publicConfigGroup(groups[index]) });
}

async function deleteManagedConfigGroup(env, id) {
  const groups = await readManagedConfigGroups(env);
  const next = groups.filter((group) => group.id !== id);
  if (next.length === groups.length) return json({ error: "CONFIG_GROUP_NOT_FOUND" }, 404);
  await writeManagedConfigGroups(env, next);
  return json({ deleted: true });
}

async function configPayload(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "INVALID_JSON", status: 400 };
  }
  const name = cleanText(body?.name, 80);
  if (name.length < 2) return { ok: false, error: "INVALID_CONFIG_GROUP_NAME", status: 400 };
  const raw = Array.isArray(body?.configs)
    ? body.configs.map(String)
    : String(body?.configs || "").split(/\r?\n/);
  const seen = new Set();
  const configs = [];
  for (const value of raw) {
    const config = String(value || "").trim();
    if (!config || config.length > 8192 || !validConfig(config) || seen.has(config)) continue;
    seen.add(config);
    configs.push(config);
    if (configs.length >= MAX_CONFIGS_PER_GROUP) break;
  }
  if (configs.length === 0) return { ok: false, error: "NO_VALID_CONFIGS", status: 400 };
  return { ok: true, name, enabled: body?.enabled !== false, configs };
}

async function readManagedConfigGroups(env) {
  if (!env.ORDERS) return [];
  const stored = await env.ORDERS.get(MANAGED_CONFIGS_KEY, "json");
  return Array.isArray(stored?.groups) ? stored.groups.slice(0, MAX_MANAGED_GROUPS) : [];
}

async function writeManagedConfigGroups(env, groups) {
  await env.ORDERS.put(MANAGED_CONFIGS_KEY, JSON.stringify({
    version: 1,
    updated_at: Date.now(),
    groups: groups.slice(0, MAX_MANAGED_GROUPS),
  }));
}

function publicConfigGroup(group) {
  return {
    id: group.id,
    name: group.name,
    enabled: group.enabled !== false,
    config_count: Array.isArray(group.configs) ? group.configs.length : 0,
    configs: Array.isArray(group.configs) ? group.configs : [],
    created_at: Number(group.created_at || 0),
    updated_at: Number(group.updated_at || 0),
  };
}

async function recordAppOpen(request, env) {
  if (!env.ORDERS) return json({ accepted: false }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const installId = String(body?.install_id || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(installId)) return json({ error: "INVALID_INSTALL_ID" }, 400);
  if (installId === DIAGNOSTIC_INSTALL_ID) return json({ accepted: true, diagnostic: true }, 202);
  const now = Date.now();
  const visitorKey = `${VISITOR_PREFIX}${installId}`;
  const previous = await env.ORDERS.get(visitorKey, "json");
  const visitor = {
    install_id: installId,
    display_id: `VZ-${installId.slice(0, 8).toUpperCase()}`,
    platform: cleanToken(body?.platform, 24) || "android",
    app_version: cleanText(body?.app_version, 32) || "unknown",
    build_number: cleanText(body?.build_number, 24) || null,
    locale: cleanToken(body?.locale, 16) || null,
    country: cleanToken(request.cf?.country, 3) || null,
    first_seen_at: Number(previous?.first_seen_at || now),
    last_seen_at: now,
    open_count: Math.min(Number(previous?.open_count || 0) + 1, 1_000_000_000),
  };
  await env.ORDERS.put(visitorKey, JSON.stringify(visitor), { expirationTtl: 365 * 86400 });

  const index = await env.ORDERS.get(VISITOR_INDEX_KEY, "json");
  const ids = Array.isArray(index?.ids) ? index.ids.filter((id) => id !== installId) : [];
  ids.unshift(installId);
  await env.ORDERS.put(VISITOR_INDEX_KEY, JSON.stringify({ ids: ids.slice(0, MAX_VISITOR_INDEX) }));

  const day = new Date(now).toISOString().slice(0, 10);
  const dayKey = `${DAILY_PREFIX}${day}`;
  const daily = await env.ORDERS.get(dayKey, "json");
  const unique = Array.isArray(daily?.unique) ? daily.unique : [];
  if (!unique.includes(installId) && unique.length < MAX_VISITOR_INDEX) unique.push(installId);
  await env.ORDERS.put(dayKey, JSON.stringify({
    date: day,
    opens: Math.min(Number(daily?.opens || 0) + 1, 1_000_000_000),
    unique,
  }), { expirationTtl: 400 * 86400 });
  return json({ accepted: true }, 202);
}

async function adminSummary(env) {
  const groups = await readManagedConfigGroups(env);
  const days = [];
  let opens7d = 0;
  let unique7d = new Set();
  for (let offset = 0; offset < 30; offset += 1) {
    const time = Date.now() - offset * 86400 * 1000;
    const date = new Date(time).toISOString().slice(0, 10);
    const row = await env.ORDERS.get(`${DAILY_PREFIX}${date}`, "json");
    const rawIds = Array.isArray(row?.unique) ? row.unique : [];
    const hadDiagnostic = rawIds.includes(DIAGNOSTIC_INSTALL_ID);
    const ids = rawIds.filter((id) => id !== DIAGNOSTIC_INSTALL_ID);
    const opens = Math.max(0, Number(row?.opens || 0) - (hadDiagnostic ? 1 : 0));
    if (offset < 7) {
      opens7d += opens;
      for (const id of ids) unique7d.add(id);
    }
    days.unshift({ date, opens, unique: ids.length });
  }
  const index = await env.ORDERS.get(VISITOR_INDEX_KEY, "json");
  return json({
    metrics: {
      opens_today: days.at(-1)?.opens || 0,
      unique_today: days.at(-1)?.unique || 0,
      opens_7d: opens7d,
      unique_7d: unique7d.size,
      known_installations: Array.isArray(index?.ids) ? index.ids.length : 0,
      managed_groups: groups.length,
      managed_configs: groups.reduce((sum, group) => sum + (Array.isArray(group.configs) ? group.configs.length : 0), 0),
    },
    days,
  });
}

async function adminVisitors(url, env) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 250);
  const index = await env.ORDERS.get(VISITOR_INDEX_KEY, "json");
  const ids = Array.isArray(index?.ids)
    ? index.ids.filter((id) => id !== DIAGNOSTIC_INSTALL_ID).slice(0, limit)
    : [];
  const visitors = (await Promise.all(ids.map((id) => env.ORDERS.get(`${VISITOR_PREFIX}${id}`, "json"))))
    .filter(Boolean)
    .sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0));
  return json({ visitors });
}

function adminPage() {
  const nonce = randomHex(16);
  const html = `<!doctype html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>کنترل پنل Venzo VPN</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#090a0d;--surface:#121419;--surface2:#191c23;--line:#292d36;--text:#f7f7f8;--muted:#a8adb8;--red:#f5223d;--red2:#b91027;--green:#2dd184;--amber:#f0b84b;--radius:16px}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 100% 0,#2b0a10 0,transparent 34%),var(--bg);color:var(--text);font-family:Tahoma,Arial,sans-serif;min-height:100vh}button,input,textarea{font:inherit}.hidden{display:none!important}
.login{min-height:100vh;display:grid;place-items:center;padding:24px}.login-card{width:min(420px,100%);background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:28px}.mark{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;background:var(--red);font-weight:900;font-size:23px;margin-bottom:18px}h1,h2,h3,p{margin-top:0}.login h1{font-size:24px;margin-bottom:8px}.muted{color:var(--muted);line-height:1.8}.field{display:grid;gap:7px;margin:16px 0}.field span{font-size:13px;color:#d8dbe1}.input{width:100%;min-height:46px;background:#0c0e12;color:#fff;border:1px solid var(--line);border-radius:12px;padding:11px 13px;outline:none}.input:focus{border-color:var(--red);box-shadow:0 0 0 3px #f5223d25}textarea.input{min-height:210px;resize:vertical;direction:ltr;text-align:left;line-height:1.55}.btn{min-height:44px;border:0;border-radius:12px;padding:10px 16px;color:#fff;cursor:pointer;font-weight:700;background:#282c35;transition:.18s}.btn:hover{filter:brightness(1.12)}.btn:focus-visible{outline:3px solid #fff;outline-offset:2px}.btn.primary{background:var(--red)}.btn.danger{background:#561923;color:#ffb6c0}.btn.ghost{background:transparent;border:1px solid var(--line)}.wide{width:100%}.error{color:#ff8d9c;min-height:22px;margin-top:12px}.ok{color:var(--green)}
.shell{display:grid;grid-template-columns:230px 1fr;min-height:100vh}.sidebar{background:#0d0f13;border-left:1px solid var(--line);padding:22px 16px;position:sticky;top:0;height:100vh}.brand{display:flex;align-items:center;gap:11px;font-weight:900;margin-bottom:28px}.brand .mark{width:42px;height:42px;margin:0;border-radius:12px;font-size:18px}.nav{display:grid;gap:7px}.nav button{display:flex;align-items:center;gap:9px;text-align:right;background:transparent;border:0;color:var(--muted);padding:12px;border-radius:11px;cursor:pointer}.nav button.active,.nav button:hover{background:var(--surface2);color:#fff}.logout{position:absolute;bottom:20px;right:16px;left:16px}.content{padding:24px;max-width:1500px;width:100%;margin:auto}.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.topbar h1{font-size:25px;margin:0}.status-dot{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:13px}.status-dot:before{content:"";width:9px;height:9px;background:var(--green);border-radius:50%}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:17px}.metric strong{display:block;font-size:28px;margin-top:10px}.metric span{color:var(--muted);font-size:13px}.panel{margin-top:14px}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.panel-head h2{font-size:17px;margin:0}.chart{height:190px;display:flex;align-items:end;gap:5px;border-bottom:1px solid var(--line);padding-top:15px}.bar{flex:1;min-width:5px;background:linear-gradient(var(--red),var(--red2));border-radius:5px 5px 0 0;position:relative}.bar:hover:after{content:attr(data-tip);position:absolute;bottom:calc(100% + 7px);right:50%;transform:translateX(50%);background:#000;padding:5px 7px;border-radius:7px;white-space:nowrap;font-size:11px;z-index:2}
.toolbar{display:flex;gap:9px;flex-wrap:wrap}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:13px}table{border-collapse:collapse;width:100%;min-width:720px;background:#0e1014}th,td{padding:12px 14px;text-align:right;border-bottom:1px solid #22262e;font-size:13px}th{color:var(--muted);background:#14171c;position:sticky;top:0}tr:hover td{background:#151820}.badge{display:inline-flex;padding:4px 8px;border-radius:999px;background:#243128;color:#77e7ae;font-size:11px}.badge.off{background:#33252a;color:#ff9baa}.empty{text-align:center;color:var(--muted);padding:34px}.catalog-panel{margin-bottom:14px}.source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.source-card{background:#0e1014;border:1px solid var(--line);border-radius:12px;padding:13px}.source-card strong{display:block;margin-bottom:8px}.source-meta{display:flex;justify-content:space-between;align-items:center;gap:8px}.source-meta small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.check{display:flex;align-items:center;gap:8px;margin:12px 0;color:var(--muted)}.actions{display:flex;gap:8px;flex-wrap:wrap}.toast{position:fixed;left:20px;bottom:20px;background:#20242c;border:1px solid var(--line);padding:12px 16px;border-radius:12px;z-index:10}.mobile-menu{display:none}
@media(max-width:980px){.grid{grid-template-columns:repeat(2,1fr)}.source-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.shell{grid-template-columns:1fr}.sidebar{position:fixed;z-index:20;right:0;width:240px;transform:translateX(105%);transition:.2s}.sidebar.open{transform:none}.content{padding:17px}.mobile-menu{display:inline-block}.form-grid{grid-template-columns:1fr}}
@media(max-width:540px){.grid,.source-grid{grid-template-columns:1fr}.topbar h1{font-size:20px}.card{padding:14px}.content{padding:12px}.chart{height:150px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<section id="login" class="login"><form id="login-form" class="login-card"><div class="mark">V</div><h1>کنترل پنل Venzo</h1><p class="muted">این بخش فقط برای مدیر سرویس است.</p><label class="field"><span>رمز مدیریت</span><input id="secret" class="input" type="password" autocomplete="current-password" required></label><button class="btn primary wide" type="submit">ورود امن</button><div id="login-error" class="error" role="alert"></div></form></section>
<div id="app" class="shell hidden"><aside id="sidebar" class="sidebar"><div class="brand"><div class="mark">V</div><span>Venzo Admin</span></div><nav class="nav"><button class="active" data-page="dashboard">داشبورد</button><button data-page="configs">مدیریت کانفیگ‌ها</button><button data-page="visitors">بازدیدکنندگان</button></nav><button id="logout" class="btn ghost logout">خروج از پنل</button></aside><main class="content"><header class="topbar"><div><button id="menu" class="btn ghost mobile-menu">منو</button><h1 id="page-title">داشبورد مدیریتی</h1></div><div class="status-dot">اتصال امن</div></header>
<section id="page-dashboard"><div class="grid"><article class="card metric"><span>بازدید امروز</span><strong id="opens-today">۰</strong></article><article class="card metric"><span>کاربر یکتای امروز</span><strong id="unique-today">۰</strong></article><article class="card metric"><span>کاربران ۷ روز</span><strong id="unique-week">۰</strong></article><article class="card metric"><span>کانفیگ‌های قابل دریافت</span><strong id="config-count">۰</strong></article></div><article class="card panel"><div class="panel-head"><h2>روند اجرای برنامه در ۳۰ روز اخیر</h2><button id="refresh" class="btn ghost">به‌روزرسانی</button></div><div id="chart" class="chart" aria-label="نمودار بازدید سی روز اخیر"></div></article></section>
<section id="page-configs" class="hidden"><article class="card catalog-panel"><div class="panel-head"><div><h2>منابع خودکار داخل برنامه</h2><p id="catalog-updated" class="muted"></p></div><div class="toolbar"><span id="catalog-total" class="badge"></span><button id="sources-refresh" class="btn ghost">به‌روزرسانی</button></div></div><div id="source-list" class="source-grid"></div></article><div class="form-grid"><form id="config-form" class="card"><div class="panel-head"><h2 id="config-form-title">افزودن کانفیگ جدید</h2><button id="cancel-edit" class="btn ghost hidden" type="button">لغو ویرایش</button></div><input id="config-id" type="hidden"><label class="field"><span>نام گروه</span><input id="config-name" class="input" maxlength="80" placeholder="مثلاً سرورهای ویژه شهریور" required></label><label class="field"><span>کانفیگ‌ها؛ هر خط یک کانفیگ</span><textarea id="config-lines" class="input" spellcheck="false" required></textarea></label><label class="check"><input id="config-enabled" type="checkbox" checked> فعال و قابل دریافت در برنامه</label><button class="btn primary wide" type="submit">ذخیره کانفیگ‌ها</button></form><article class="card"><div class="panel-head"><h2>گروه‌های دستی منتشرشده</h2><span id="groups-total" class="muted"></span></div><div id="config-list"></div></article></div></section>
<section id="page-visitors" class="hidden"><article class="card"><div class="panel-head"><h2>آخرین بازدیدکنندگان</h2><div class="toolbar"><input id="visitor-search" class="input" style="width:230px" placeholder="جست‌وجوی شناسه یا نسخه"><button id="visitors-refresh" class="btn ghost">به‌روزرسانی</button></div></div><div class="table-wrap"><table><thead><tr><th>شناسه نصب</th><th>نسخه</th><th>کشور</th><th>اولین بازدید</th><th>آخرین بازدید</th><th>دفعات اجرا</th></tr></thead><tbody id="visitor-rows"></tbody></table></div><p class="muted" style="margin:14px 0 0;font-size:12px">برای حفظ حریم خصوصی، IP خام، IMEI و اطلاعات مرور کاربر ذخیره نمی‌شود.</p></article></section>
</main></div><div id="toast" class="toast hidden" role="status"></div>
<script nonce="${nonce}">
const $=s=>document.querySelector(s), fa=n=>Number(n||0).toLocaleString('fa-IR'), date=v=>v?new Date(v).toLocaleString('fa-IR'):'—';let groups=[],visitors=[],catalog={sources:[]};
function toast(text,bad=false){const el=$('#toast');el.textContent=text;el.style.color=bad?'#ff9baa':'#8af0bc';el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),3200)}
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.headers||{})}});if(r.status===401){showLogin();throw new Error('UNAUTHORIZED')}const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||String(r.status));return b}
function showLogin(){$('#login').classList.remove('hidden');$('#app').classList.add('hidden')}function showApp(){$('#login').classList.add('hidden');$('#app').classList.remove('hidden')}
async function loadSummary(){const [b,c]=await Promise.all([api('/v1/internal/admin/summary'),api('/v1/free/sources')]);const m=b.metrics||{};catalog=c||{sources:[]};$('#opens-today').textContent=fa(m.opens_today);$('#unique-today').textContent=fa(m.unique_today);$('#unique-week').textContent=fa(m.unique_7d);$('#config-count').textContent=fa(Number(catalog.config_count||0)+Number(m.managed_configs||0));const max=Math.max(1,...(b.days||[]).map(x=>x.opens));const chart=$('#chart');chart.replaceChildren();for(const row of b.days||[]){const bar=document.createElement('div');bar.className='bar';bar.style.height=Math.max(2,row.opens/max*100)+'%';bar.dataset.tip=row.date+' — '+fa(row.opens);chart.append(bar)}}
function renderSources(){const list=$('#source-list');list.replaceChildren();$('#catalog-total').textContent=fa(catalog.config_count)+' کانفیگ خودکار';$('#catalog-updated').textContent='آخرین دریافت: '+date(catalog.updated_at)+' · بروزرسانی خودکار هر '+fa(catalog.refresh_interval_hours||4)+' ساعت';const sources=Array.isArray(catalog.sources)?catalog.sources:[];if(!sources.length){list.className='empty';list.textContent='هنوز اطلاعات منابع خودکار ثبت نشده است.';return}list.className='source-grid';for(const source of sources){const card=document.createElement('div');card.className='source-card';const name=document.createElement('strong');name.textContent=source.name||source.id;const meta=document.createElement('div');meta.className='source-meta';const repo=document.createElement('small');repo.textContent=source.repository||'منبع خودکار';const badge=document.createElement('span');badge.className='badge '+(source.healthy?'':'off');badge.textContent=source.healthy?fa(source.config_count)+' فعال':'در دسترس نیست';meta.append(repo,badge);card.append(name,meta);list.append(card)}}
async function loadConfigs(){const [b,c]=await Promise.all([api('/v1/internal/admin/configs'),api('/v1/free/sources')]);groups=b.groups||[];catalog=c||{sources:[]};renderSources();$('#groups-total').textContent=fa(groups.length)+' گروه';const list=$('#config-list');list.replaceChildren();if(!groups.length){list.className='empty';list.textContent='هنوز کانفیگ دستی ثبت نشده است.';return}list.className='';for(const g of groups){const card=document.createElement('div');card.className='card';card.style.marginBottom='9px';const head=document.createElement('div');head.className='panel-head';const title=document.createElement('strong');title.textContent=g.name;const badge=document.createElement('span');badge.className='badge '+(g.enabled?'':'off');badge.textContent=g.enabled?'فعال':'غیرفعال';head.append(title,badge);const meta=document.createElement('p');meta.className='muted';meta.style.fontSize='12px';meta.textContent=fa(g.config_count)+' کانفیگ · ویرایش '+date(g.updated_at);const actions=document.createElement('div');actions.className='actions';const edit=document.createElement('button');edit.className='btn ghost';edit.textContent='ویرایش';edit.onclick=()=>editGroup(g);const del=document.createElement('button');del.className='btn danger';del.textContent='حذف';del.onclick=()=>deleteGroup(g);actions.append(edit,del);card.append(head,meta,actions);list.append(card)}}
function resetForm(){$('#config-id').value='';$('#config-name').value='';$('#config-lines').value='';$('#config-enabled').checked=true;$('#config-form-title').textContent='افزودن کانفیگ جدید';$('#cancel-edit').classList.add('hidden')}
function editGroup(g){$('#config-id').value=g.id;$('#config-name').value=g.name;$('#config-lines').value=(g.configs||[]).join('\\n');$('#config-enabled').checked=g.enabled;$('#config-form-title').textContent='ویرایش '+g.name;$('#cancel-edit').classList.remove('hidden');$('#config-name').focus()}
async function deleteGroup(g){if(!confirm('گروه «'+g.name+'» حذف شود؟'))return;await api('/v1/internal/admin/configs/'+g.id,{method:'DELETE'});toast('گروه حذف شد.');await Promise.all([loadConfigs(),loadSummary()])}
function renderVisitors(){const q=$('#visitor-search').value.trim().toLowerCase();const rows=$('#visitor-rows');rows.replaceChildren();const filtered=visitors.filter(v=>!q||[v.display_id,v.app_version,v.country].join(' ').toLowerCase().includes(q));if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.className='empty';td.textContent='بازدیدی ثبت نشده است.';tr.append(td);rows.append(tr);return}for(const v of filtered){const tr=document.createElement('tr');for(const value of [v.display_id,v.app_version+(v.build_number?' ('+v.build_number+')':''),v.country||'—',date(v.first_seen_at),date(v.last_seen_at),fa(v.open_count)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}rows.append(tr)}}
async function loadVisitors(){const b=await api('/v1/internal/admin/visitors?limit=250');visitors=b.visitors||[];renderVisitors()}
async function switchPage(page){for(const el of document.querySelectorAll('[id^=page-]'))el.classList.add('hidden');$('#page-'+page).classList.remove('hidden');for(const b of document.querySelectorAll('.nav button'))b.classList.toggle('active',b.dataset.page===page);$('#page-title').textContent={dashboard:'داشبورد مدیریتی',configs:'مدیریت کانفیگ‌ها',visitors:'بازدیدکنندگان'}[page];$('#sidebar').classList.remove('open');if(page==='configs')await loadConfigs();if(page==='visitors')await loadVisitors()}
$('#login-form').onsubmit=async e=>{e.preventDefault();$('#login-error').textContent='در حال بررسی...';try{await api('/v1/internal/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:$('#secret').value})});$('#secret').value='';$('#login-error').textContent='';showApp();await loadSummary()}catch(err){$('#login-error').textContent=err.message==='TOO_MANY_ATTEMPTS'?'تلاش‌های ناموفق زیاد است؛ ده دقیقه بعد امتحان کنید.':'رمز مدیریت نادرست است.'}};
$('#config-form').onsubmit=async e=>{e.preventDefault();const id=$('#config-id').value;try{await api('/v1/internal/admin/configs'+(id?'/'+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#config-name').value,configs:$('#config-lines').value,enabled:$('#config-enabled').checked})});toast(id?'تغییرات ذخیره شد.':'کانفیگ‌ها منتشر شدند.');resetForm();await Promise.all([loadConfigs(),loadSummary()])}catch(err){toast(err.message==='NO_VALID_CONFIGS'?'هیچ کانفیگ معتبر پیدا نشد.':'ذخیره‌سازی ناموفق بود: '+err.message,true)}};
$('#cancel-edit').onclick=resetForm;$('#refresh').onclick=()=>loadSummary().then(()=>toast('آمار به‌روز شد.')).catch(()=>toast('خطای دریافت آمار',true));$('#sources-refresh').onclick=()=>loadConfigs().then(()=>toast('منابع به‌روز شدند.')).catch(()=>toast('خطای دریافت منابع',true));$('#visitors-refresh').onclick=()=>loadVisitors().then(()=>toast('فهرست به‌روز شد.')).catch(()=>toast('خطای دریافت بازدیدها',true));$('#visitor-search').oninput=renderVisitors;$('#logout').onclick=async()=>{await fetch('/v1/internal/admin/logout',{method:'POST',credentials:'same-origin'});showLogin()};$('#menu').onclick=()=>$('#sidebar').classList.toggle('open');for(const b of document.querySelectorAll('.nav button'))b.onclick=()=>switchPage(b.dataset.page).catch(()=>toast('دریافت اطلاعات ناموفق بود.',true));
api('/v1/internal/admin/session').then(()=>{showApp();return loadSummary()}).catch(showLogin);
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": `default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

function validConfig(value) {
  try {
    return SUPPORTED_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validSecret(value) {
  return String(value || "").length >= 8;
}

async function safeSecretEqual(left, right) {
  const a = await sha256(String(left || ""));
  const b = await sha256(String(right || ""));
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function clientFingerprint(request) {
  const ip = String(request.headers.get("cf-connecting-ip") || "unknown");
  return (await sha256(ip)).slice(0, 24);
}

function cookieValue(request, name) {
  const source = String(request.headers.get("cookie") || "");
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function adminCookie(value, maxAge) {
  return `venzo_admin=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function cleanText(value, max) {
  return String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);
}

function cleanToken(value, max) {
  const result = String(value || "").trim().slice(0, max);
  return /^[A-Za-z0-9_.-]+$/.test(result) ? result : "";
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
