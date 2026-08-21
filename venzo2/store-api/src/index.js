const GIB = 1024 ** 3;
const DAY = 86400;
const ORDER_TTL_MS = 30 * 60 * 1000;
const VOLUMES = [5, 10, 20, 50, 100];
const DURATIONS = [
  { months: 1, days: 30, label: "یک‌ماهه" },
  { months: 2, days: 60, label: "دوماهه" },
  { months: 3, days: 90, label: "سه‌ماهه" },
];

const PLANS = DURATIONS.flatMap((duration) =>
  VOLUMES.map((dataGb) => ({
    id: `${duration.months}m-${dataGb}gb`,
    title: `${duration.label} ${dataGb} گیگ`,
    price: dataGb * duration.months * 30_000,
    currency: "IRR",
    days: duration.days,
    data_gb: dataGb,
    devices: "unlimited",
  })),
);

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
        payments: paymentAvailability(env),
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/plans") {
      return json({ plans: PLANS }, 200, publicHeaders());
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
  const plan = PLANS.find((item) => item.id === parsed.value.plan_id);
  const customer = clean(parsed.value.customer, 120);
  const method = String(parsed.value.payment_method || "");
  if (!plan || !customer || !["usdt_trc20", "trx", "card"].includes(method)) {
    return json({ error: "INVALID_ORDER" }, 400);
  }
  const payment = paymentFor(method, plan, env);
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
  const plan = PLANS.find((item) => item.id === body.plan_id);
  if (!orderId || !customer || !plan) return { ok: false, error: "INVALID_ORDER" };

  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  const groupIds = String(env.PASARGUARD_GROUP_IDS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
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

function paymentFor(method, plan, env) {
  if (method === "card") {
    const cardNumber = digits(env.CARD_NUMBER, 24);
    const holder = clean(env.CARD_HOLDER, 120);
    if (cardNumber.length < 16 || !holder) {
      return { ok: false, error: "CARD_PAYMENT_NOT_CONFIGURED" };
    }
    return {
      ok: true,
      value: {
        amount: plan.price,
        currency: "IRR",
        card_number: cardNumber,
        card_holder: holder,
        review: "manual",
      },
    };
  }

  const usdt = method === "usdt_trc20";
  const wallet = clean(env.TRON_WALLET_ADDRESS, 64);
  const rate = positiveInteger(usdt ? env.USDT_IRR : env.TRX_IRR);
  if (!wallet || !rate) return { ok: false, error: "CRYPTO_PAYMENT_NOT_CONFIGURED" };
  const baseAtomic = Math.ceil((plan.price * 1_000_000) / rate);
  const marker = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  const amountAtomic = Math.ceil(baseAtomic / 1000) * 1000 + marker;
  return {
    ok: true,
    value: {
      amount: (amountAtomic / 1_000_000).toFixed(6),
      amount_atomic: String(amountAtomic),
      currency: usdt ? "USDT" : "TRX",
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

function paymentAvailability(env) {
  return {
    usdt_trc20: Boolean(env.TRON_WALLET_ADDRESS && env.USDT_IRR && env.TRONGRID_API_KEY),
    trx: Boolean(env.TRON_WALLET_ADDRESS && env.TRX_IRR && env.TRONGRID_API_KEY),
    card: Boolean(env.CARD_NUMBER && env.CARD_HOLDER),
  };
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
