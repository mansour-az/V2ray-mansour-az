const GIB = 1024 ** 3;
const DAY = 86400;
const ORDER_TTL_MS = 30 * 60 * 1000;
const STORE_SETTINGS_KEY = "settings:store";
const DEFAULT_PRICE_PER_GB_IRR = 30_000;
const VOLUMES = [5, 10, 20, 50, 100];
const DURATIONS = [
  { months: 1, days: 30, label: "یک‌ماهه" },
  { months: 2, days: 60, label: "دوماهه" },
  { months: 3, days: 90, label: "سه‌ماهه" },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "venzo-store-api",
        store: Boolean(env.ORDERS),
        pasarguard: Boolean(validHttpsOrigin(env.PASARGUARD_BASE_URL)),
        payments: await paymentAvailability(env),
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/plans") {
      return json({ plans: await plansFor(env) }, 200, publicHeaders());
    }
    if (request.method === "GET" && url.pathname === "/admin") {
      return adminPage();
    }
    if (
      ["GET", "PUT"].includes(request.method) &&
      url.pathname === "/v1/internal/settings"
    ) {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401, noStoreHeaders());
      }
      if (request.method === "GET") {
        return json({ settings: await storeSettings(env) }, 200, noStoreHeaders());
      }
      return updateStoreSettings(request, env);
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/internal/pasarguard-groups"
    ) {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401, noStoreHeaders());
      }
      const result = await pasarGuardGroups(env);
      return result.ok
        ? json({ groups: result.groups }, 200, noStoreHeaders())
        : json({ error: result.error }, 502, noStoreHeaders());
    }
    if (request.method === "POST" && url.pathname === "/v1/orders") {
      return createOrder(request, env);
    }

    const orderMatch = url.pathname.match(/^\/v1\/orders\/([a-z0-9-]+)$/);
    if (request.method === "GET" && orderMatch) {
      return getOrder(request, env, orderMatch[1]);
    }
    const receiptMatch = url.pathname.match(
      /^\/v1\/orders\/([a-z0-9-]+)\/card-receipt$/,
    );
    if (request.method === "POST" && receiptMatch) {
      return submitCardReceipt(request, env, receiptMatch[1]);
    }
    const approveMatch = url.pathname.match(
      /^\/v1\/internal\/card-orders\/([a-z0-9-]+)\/approve$/,
    );
    if (request.method === "POST" && approveMatch) {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401);
      }
      return approveCardOrder(request, env, approveMatch[1]);
    }
    if (request.method === "POST" && url.pathname === "/v1/internal/provision") {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401);
      }
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      const result = await provision(parsed.value, env);
      return result.ok ? json(result.value) : json({ error: result.error }, 502);
    }
    return json({ error: "NOT_FOUND" }, 404);
  },
};

async function createOrder(request, env) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const settings = await storeSettings(env);
  const plan = plansFrom(settings).find((item) => item.id === parsed.value.plan_id);
  const customer = clean(parsed.value.customer, 120);
  const method = String(parsed.value.payment_method || "");
  if (!plan || !customer || method !== "trx") {
    return json({ error: "INVALID_ORDER" }, 400);
  }
  const payment = paymentFor(method, plan, env, settings);
  if (!payment.ok) return json({ error: payment.error }, 503);

  const id = crypto.randomUUID().toLowerCase();
  const clientSecret = randomToken(32);
  const now = Date.now();
  const order = {
    id,
    plan_id: plan.id,
    customer,
    payment_method: method,
    status: "awaiting_payment",
    price_irr: plan.price,
    payment: payment.value,
    client_secret_hash: await sha256(clientSecret),
    created_at: now,
    expires_at: now + ORDER_TTL_MS,
    last_checked_at: 0,
  };
  await saveOrder(env, order);
  return json(
    { order: publicOrder(order), client_secret: clientSecret },
    201,
    noStoreHeaders(),
  );
}

async function getOrder(request, env, id) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  let order = await loadOrder(env, id);
  if (!order) return json({ error: "ORDER_NOT_FOUND" }, 404);
  if (!(await orderAuthorized(request, order))) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  if (order.status === "awaiting_payment" && Date.now() > order.expires_at) {
    order.status = "expired";
    await saveOrder(env, order);
  } else if (
    order.status === "awaiting_payment" &&
    order.payment_method !== "card" &&
    Date.now() - Number(order.last_checked_at || 0) >= 15_000
  ) {
    order.last_checked_at = Date.now();
    const match = await findCryptoPayment(order, env);
    if (match) {
      order.status = "paid";
      order.payment_txid = match.txid;
      order.paid_at = match.paid_at;
      order = await fulfillOrder(order, env);
    }
    await saveOrder(env, order);
  }
  return json({ order: publicOrder(order) }, 200, noStoreHeaders());
}

async function submitCardReceipt(request, env, id) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const order = await loadOrder(env, id);
  if (!order) return json({ error: "ORDER_NOT_FOUND" }, 404);
  if (!(await orderAuthorized(request, order))) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  if (order.payment_method !== "card" || order.status !== "awaiting_payment") {
    return json({ error: "INVALID_ORDER_STATE" }, 409);
  }
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const reference = clean(parsed.value.reference, 120);
  const telegram = clean(parsed.value.telegram_username, 64);
  if (!reference || !telegram) return json({ error: "INVALID_RECEIPT" }, 400);
  order.status = "awaiting_manual_review";
  order.card_receipt = { reference, telegram_username: telegram, submitted_at: Date.now() };
  await saveOrder(env, order);
  return json({ order: publicOrder(order) }, 202, noStoreHeaders());
}

async function approveCardOrder(request, env, id) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  let order = await loadOrder(env, id);
  if (!order) return json({ error: "ORDER_NOT_FOUND" }, 404);
  if (order.payment_method !== "card" || order.status !== "awaiting_manual_review") {
    return json({ error: "INVALID_ORDER_STATE" }, 409);
  }
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  order.status = "paid";
  order.payment_reference = clean(parsed.value.bank_reference, 120) || "manual";
  order.paid_at = Date.now();
  order = await fulfillOrder(order, env);
  await saveOrder(env, order);
  return json({ order: publicOrder(order) }, 200, noStoreHeaders());
}

async function fulfillOrder(order, env) {
  const result = await provision(
    { order_id: order.id, plan_id: order.plan_id, customer: order.customer },
    env,
  );
  if (!result.ok) {
    order.status = "provisioning_failed";
    order.provisioning_error = result.error;
    return order;
  }
  order.status = "fulfilled";
  order.fulfilled_at = Date.now();
  order.subscription_url = result.value.subscription_url;
  order.pasarguard_username = result.value.username;
  return order;
}

async function provision(body, env) {
  const orderId = clean(body.order_id, 80);
  const customer = clean(body.customer, 120);
  const plan = (await plansFor(env)).find((item) => item.id === body.plan_id);
  if (!orderId || !customer || !plan) return { ok: false, error: "INVALID_ORDER" };

  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  const settings = await storeSettings(env);
  const groupIds = settings.pasarguard_group_ids.length
    ? settings.pasarguard_group_ids
    : numericIds(String(env.PASARGUARD_GROUP_IDS || "").split(","));
  if (!baseUrl || groupIds.length === 0) {
    return { ok: false, error: "PASARGUARD_NOT_CONFIGURED" };
  }
  const auth = await pasarGuardAuth(baseUrl, env);
  if (!auth.ok) return auth;

  const username = await usernameFor(orderId);
  const payload = {
    username,
    status: "active",
    expire: Math.floor(Date.now() / 1000) + plan.days * DAY,
    data_limit: plan.data_gb * GIB,
    data_limit_reset_strategy: "no_reset",
    group_ids: groupIds,
    note: `Venzo order ${orderId}; customer ${customer}`,
  };
  let response = await fetch(`${baseUrl}/api/user`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...auth.headers },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) {
    response = await fetch(
      `${baseUrl}/api/user/by-username/${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json", ...auth.headers } },
    );
  }
  if (!response.ok) {
    console.error("PasarGuard provisioning failed", { status: response.status, order_id: orderId });
    return { ok: false, error: "PROVISIONING_FAILED" };
  }
  const user = await response.json();
  if (!String(user.subscription_url || "").startsWith("https://")) {
    return { ok: false, error: "INVALID_SUBSCRIPTION_URL" };
  }
  return {
    ok: true,
    value: {
      order_id: orderId,
      username: user.username || username,
      subscription_url: user.subscription_url,
      plan_id: plan.id,
    },
  };
}

async function pasarGuardAuth(baseUrl, env) {
  const apiKey = String(env.PASARGUARD_API_KEY || "");
  if (apiKey.startsWith("pg_key_")) {
    return { ok: true, headers: { "X-API-Key": apiKey } };
  }
  const username = String(env.PASARGUARD_ADMIN_USERNAME || "");
  const password = String(env.PASARGUARD_ADMIN_PASSWORD || "");
  if (!username || !password) {
    return { ok: false, error: "PASARGUARD_AUTH_NOT_CONFIGURED" };
  }
  const response = await fetch(`${baseUrl}/api/admin/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!response.ok) {
    console.error("PasarGuard login failed", { status: response.status });
    return { ok: false, error: "PASARGUARD_LOGIN_FAILED" };
  }
  const token = await response.json();
  if (!token.access_token) return { ok: false, error: "PASARGUARD_TOKEN_INVALID" };
  return { ok: true, headers: { Authorization: `Bearer ${token.access_token}` } };
}

async function pasarGuardGroups(env) {
  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  if (!baseUrl) return { ok: false, error: "PASARGUARD_NOT_CONFIGURED" };
  const auth = await pasarGuardAuth(baseUrl, env);
  if (!auth.ok) return auth;
  const response = await fetch(`${baseUrl}/api/groups/simple`, {
    headers: { Accept: "application/json", ...auth.headers },
  });
  if (!response.ok) return { ok: false, error: "PASARGUARD_GROUPS_FAILED" };
  const payload = await response.json();
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.groups)
      ? payload.groups
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.data?.groups)
          ? payload.data.groups
          : [];
  const groups = rows
    .map((row) => ({ id: positiveInteger(row?.id), name: clean(row?.name, 120) }))
    .filter((row) => row.id && row.name);
  return groups.length
    ? { ok: true, groups }
    : { ok: false, error: "PASARGUARD_GROUPS_INVALID" };
}

function paymentFor(method, plan, env, settings) {
  if (method !== "trx") return { ok: false, error: "INVALID_PAYMENT_METHOD" };
  const wallet = clean(env.TRON_WALLET_ADDRESS, 64);
  const rate = positiveInteger(settings.trx_rate_irr);
  if (!wallet || !rate) return { ok: false, error: "CRYPTO_PAYMENT_NOT_CONFIGURED" };
  const baseAtomic = Math.ceil((plan.price * 1_000_000) / rate);
  const marker = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  const amountAtomic = Math.ceil(baseAtomic / 1000) * 1000 + marker;
  return {
    ok: true,
    value: {
      amount: (amountAtomic / 1_000_000).toFixed(6),
      amount_atomic: String(amountAtomic),
      currency: "TRX",
      network: "TRON",
      wallet_address: wallet,
      rate_irr: rate,
    },
  };
}

async function findCryptoPayment(order, env) {
  const apiKey = String(env.TRONGRID_API_KEY || "");
  const wallet = clean(env.TRON_WALLET_ADDRESS, 64);
  if (!apiKey || !wallet) return null;
  const headers = { Accept: "application/json", "TRON-PRO-API-KEY": apiKey };

  if (order.payment_method === "usdt_trc20") {
    const contract = clean(env.USDT_TRC20_CONTRACT, 64);
    if (!contract) return null;
    const query = new URLSearchParams({
      only_confirmed: "true",
      limit: "200",
      min_timestamp: String(order.created_at),
      contract_address: contract,
    });
    const response = await fetch(
      `https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet)}/transactions/trc20?${query}`,
      { headers },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const expected = BigInt(order.payment.amount_atomic);
    const tx = (payload.data || []).find(
      (item) =>
        String(item.to || "") === wallet &&
        String(item.token_info?.address || "") === contract &&
        BigInt(String(item.value || "0")) === expected,
    );
    return tx ? { txid: tx.transaction_id, paid_at: Number(tx.block_timestamp) } : null;
  }

  const query = new URLSearchParams({
    only_to: "true",
    only_confirmed: "true",
    limit: "200",
    min_timestamp: String(order.created_at),
  });
  const response = await fetch(
    `https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet)}/transactions?${query}`,
    { headers },
  );
  if (!response.ok) return null;
  const payload = await response.json();
  const expected = BigInt(order.payment.amount_atomic);
  const tx = (payload.data || []).find((item) => {
    const value = item.raw_data?.contract?.[0]?.parameter?.value;
    return value && BigInt(String(value.amount || "0")) === expected;
  });
  return tx ? { txid: tx.txID, paid_at: Number(tx.block_timestamp) } : null;
}

async function storeSettings(env) {
  let saved = null;
  if (env.ORDERS) {
    try {
      saved = await env.ORDERS.get(STORE_SETTINGS_KEY, "json");
    } catch {
      saved = null;
    }
  }
  return {
    price_per_gb_irr:
      positiveInteger(saved?.price_per_gb_irr) || DEFAULT_PRICE_PER_GB_IRR,
    trx_rate_irr: positiveInteger(saved?.trx_rate_irr),
    pasarguard_group_ids: numericIds(saved?.pasarguard_group_ids),
    updated_at: Number(saved?.updated_at || 0),
  };
}

function plansFrom(settings) {
  return DURATIONS.flatMap((duration) =>
    VOLUMES.map((dataGb) => ({
      id: `${duration.months}m-${dataGb}gb`,
      title: `${duration.label} ${dataGb} گیگ`,
      price: dataGb * duration.months * settings.price_per_gb_irr,
      currency: "IRR",
      days: duration.days,
      data_gb: dataGb,
      devices: "unlimited",
    })),
  );
}

async function plansFor(env) {
  return plansFrom(await storeSettings(env));
}

async function updateStoreSettings(request, env) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const pricePerGb = positiveInteger(parsed.value.price_per_gb_irr);
  const trxRate = positiveInteger(parsed.value.trx_rate_irr);
  const groupIds = numericIds(parsed.value.pasarguard_group_ids);
  if (
    pricePerGb < 1_000 ||
    pricePerGb > 100_000_000 ||
    trxRate < 1_000 ||
    trxRate > 1_000_000_000 ||
    groupIds.length === 0
  ) {
    return json({ error: "INVALID_SETTINGS" }, 400, noStoreHeaders());
  }
  const settings = {
    price_per_gb_irr: pricePerGb,
    trx_rate_irr: trxRate,
    pasarguard_group_ids: groupIds,
    updated_at: Date.now(),
  };
  await env.ORDERS.put(STORE_SETTINGS_KEY, JSON.stringify(settings));
  return json({ settings }, 200, noStoreHeaders());
}

async function paymentAvailability(env) {
  const settings = await storeSettings(env);
  return {
    trx: Boolean(
      env.TRON_WALLET_ADDRESS &&
        settings.trx_rate_irr &&
        env.TRONGRID_API_KEY,
    ),
  };
}

function adminPage() {
  const nonce = randomToken(16);
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>مدیریت فروش Venzo VPN</title>
  <style nonce="${nonce}">
    :root{color-scheme:dark;--red:#ef233c;--panel:#17181c;--muted:#a7a9b1}
    *{box-sizing:border-box}body{margin:0;background:#0b0c0f;color:#fff;font-family:Tahoma,Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
    main{width:min(560px,100%);background:var(--panel);border:1px solid #292b31;border-radius:22px;padding:24px;box-shadow:0 22px 70px #0008}
    h1{margin:0 0 8px;color:var(--red);font-size:25px}p{color:var(--muted);line-height:1.8;margin:0 0 20px}
    label{display:block;margin:14px 0 7px;font-weight:700}input{width:100%;background:#0e0f12;color:#fff;border:1px solid #34363e;border-radius:12px;padding:13px;font-size:16px;direction:ltr}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}button{border:0;border-radius:12px;padding:13px;font-weight:800;cursor:pointer}button.primary{background:var(--red);color:#fff}button.secondary{background:#30323a;color:#fff}
    #groups{display:grid;gap:8px;margin-top:8px}.group{display:flex;align-items:center;gap:10px;background:#0e0f12;border:1px solid #34363e;border-radius:12px;padding:12px}.group input{width:auto}.group label{margin:0;font-weight:600}
    #status{min-height:26px;margin-top:14px;color:#ffcf70}.note{font-size:13px;margin-top:18px}.ok{color:#63e6a4!important}.error{color:#ff808e!important}
  </style>
</head>
<body><main>
  <h1>Venzo VPN Store</h1>
  <p>قیمت پلن‌ها و نرخ تبدیل TRX را بدون انتشار نسخه جدید اپ تغییر دهید.</p>
  <form id="settings">
    <label for="secret">رمز مدیریت</label>
    <input id="secret" type="password" autocomplete="off" required>
    <label for="price">قیمت هر گیگ به ریال</label>
    <input id="price" type="number" min="1000" step="1000" required>
    <label for="rate">قیمت هر TRX به ریال</label>
    <input id="rate" type="number" min="1000" step="1" required>
    <label>گروه‌های دسترسی پاسارگارد</label>
    <div id="groups"><span>پس از واردکردن رمز، «دریافت تنظیمات» را بزنید.</span></div>
    <div class="actions">
      <button class="secondary" type="button" id="load">دریافت قیمت فعلی</button>
      <button class="primary" type="submit">ذخیره تغییرات</button>
    </div>
  </form>
  <div id="status" role="status"></div>
  <p class="note">رمز مدیریت در مرورگر ذخیره نمی‌شود. نرخ‌ها را فقط به ریال و بدون جداکننده وارد کنید.</p>
</main>
<script nonce="${nonce}">
  const secret=document.querySelector('#secret'),price=document.querySelector('#price'),rate=document.querySelector('#rate'),groups=document.querySelector('#groups'),status=document.querySelector('#status');
  const headers=()=>({'Accept':'application/json','Authorization':'Bearer '+secret.value});
  const message=(text,kind='')=>{status.textContent=text;status.className=kind};
  const selectedGroups=()=>[...groups.querySelectorAll('input:checked')].map(input=>Number(input.value));
  function renderGroups(rows,selected){
    groups.replaceChildren();
    for(const row of rows){
      const wrap=document.createElement('div');wrap.className='group';
      const input=document.createElement('input');input.type='checkbox';input.value=String(row.id);input.id='group-'+row.id;input.checked=selected.length===0||selected.includes(row.id);
      const label=document.createElement('label');label.htmlFor=input.id;label.textContent=row.name;
      wrap.append(input,label);groups.append(wrap);
    }
  }
  async function load(){
    if(!secret.value){message('ابتدا رمز مدیریت را وارد کنید.','error');return}
    message('در حال دریافت...');
    const [settingsResponse,groupsResponse]=await Promise.all([
      fetch('/v1/internal/settings',{headers:headers(),cache:'no-store'}),
      fetch('/v1/internal/pasarguard-groups',{headers:headers(),cache:'no-store'})
    ]);
    if(!settingsResponse.ok||!groupsResponse.ok){message(settingsResponse.status===401||groupsResponse.status===401?'رمز مدیریت نادرست است.':'دریافت تنظیمات یا گروه‌ها ناموفق بود.','error');return}
    const body=await settingsResponse.json(),groupBody=await groupsResponse.json();
    price.value=body.settings.price_per_gb_irr;rate.value=body.settings.trx_rate_irr||'';
    renderGroups(groupBody.groups,body.settings.pasarguard_group_ids||[]);message('تنظیمات و گروه‌ها دریافت شد.','ok');
  }
  document.querySelector('#load').addEventListener('click',()=>load().catch(()=>message('خطای ارتباط با سرور.','error')));
  document.querySelector('#settings').addEventListener('submit',async event=>{
    event.preventDefault();message('در حال ذخیره...');
    try{
      const response=await fetch('/v1/internal/settings',{method:'PUT',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({price_per_gb_irr:Number(price.value),trx_rate_irr:Number(rate.value),pasarguard_group_ids:selectedGroups()})});
      if(!response.ok){message(response.status===401?'رمز مدیریت نادرست است.':'مقادیر واردشده معتبر نیست.','error');return}
      message('قیمت‌ها و گروه‌ها با موفقیت ذخیره شد.','ok');
    }catch{message('خطای ارتباط با سرور.','error')}
  });
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

async function saveOrder(env, order) {
  await env.ORDERS.put(`order:${order.id}`, JSON.stringify(order), {
    expirationTtl: 60 * 60 * 24 * 120,
  });
}

async function loadOrder(env, id) {
  return env.ORDERS.get(`order:${id}`, "json");
}

async function orderAuthorized(request, order) {
  const supplied = request.headers.get("authorization") || "";
  if (!supplied.startsWith("Bearer ")) return false;
  return (await sha256(supplied.slice(7))) === order.client_secret_hash;
}

function publicOrder(order) {
  const value = {
    id: order.id,
    plan_id: order.plan_id,
    payment_method: order.payment_method,
    status: order.status,
    price_irr: order.price_irr,
    payment: order.payment,
    created_at: order.created_at,
    expires_at: order.expires_at,
  };
  if (order.payment_txid) value.payment_txid = order.payment_txid;
  if (order.subscription_url) value.subscription_url = order.subscription_url;
  if (order.provisioning_error) value.provisioning_error = order.provisioning_error;
  return value;
}

async function readJson(request) {
  if (Number(request.headers.get("content-length") || "0") > 8192) {
    return { ok: false, response: json({ error: "BODY_TOO_LARGE" }, 413) };
  }
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "INVALID_JSON" }, 400) };
  }
}

async function usernameFor(orderId) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`venzo:${orderId}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `vz_${hex.slice(0, 18)}`;
}

async function authorized(request, expected) {
  const supplied = request.headers.get("authorization") || "";
  const wanted = `Bearer ${String(expected || "")}`;
  if (supplied.length !== wanted.length || wanted.length < 40) return false;
  return (await sha256(supplied)) === (await sha256(wanted));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clean(value, maxLength) {
  const result = String(value || "").trim();
  if (result.length < 3 || result.length > maxLength) return "";
  return result.replace(/[\r\n\t]/g, " ");
}

function digits(value, maxLength) {
  return String(value || "").replace(/\D/g, "").slice(0, maxLength);
}

function positiveInteger(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : 0;
}

function numericIds(values) {
  const rows = Array.isArray(values) ? values : [];
  return [...new Set(rows.map(positiveInteger).filter(Boolean))].slice(0, 100);
}

function validHttpsOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname ? url.origin : "";
  } catch {
    return "";
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function publicHeaders() {
  return { ...corsHeaders(), "Cache-Control": "public, max-age=300" };
}

function noStoreHeaders() {
  return { ...corsHeaders(), "Cache-Control": "no-store" };
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
