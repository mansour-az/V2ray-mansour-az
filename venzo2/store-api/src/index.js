import { DurableObject } from "cloudflare:workers";

const GIB = 1024 ** 3;
const DAY = 86400;
const ORDER_TTL_MS = 30 * 60 * 1000;
const STORE_SETTINGS_KEY = "settings:store";
const TRX_RATE_CACHE_KEY = "rate:trx-irr";
const TRX_RATE_MAX_AGE_MS = 5 * 60 * 1000;
const TRX_RATE_STALE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TRX_RATE_SAFETY_FACTOR = 0.98;
const USD_RATE_CACHE_KEY = "rate:usd-irr";
const USD_RATE_MAX_AGE_MS = 5 * 60 * 1000;
const USD_RATE_STALE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PRICE_PER_GB_IRR = 30_000;
const VOLUMES = [5, 10, 20, 50, 100];
const DURATIONS = [
  { months: 1, days: 30, label: "یک‌ماهه" },
  { months: 2, days: 60, label: "دوماهه" },
  { months: 3, days: 90, label: "سه‌ماهه" },
];

export class AccountLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS account (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          customer TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          balance_irr INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          subscription_json TEXT
        );
        CREATE TABLE IF NOT EXISTS ledger (
          reference TEXT PRIMARY KEY,
          amount_irr INTEGER NOT NULL,
          kind TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    });
  }

  initialize(customer, tokenHash) {
    const now = Date.now();
    this.sql.exec(
      "INSERT OR IGNORE INTO account(singleton,customer,token_hash,balance_irr,created_at,updated_at) VALUES(1,?,?,0,?,?)",
      customer,
      tokenHash,
      now,
      now,
    );
    return this.snapshotByHash(tokenHash);
  }

  snapshotByHash(tokenHash) {
    const account = this.sql.exec(
      "SELECT customer,token_hash,balance_irr,created_at,updated_at,subscription_json FROM account WHERE singleton=1",
    ).toArray()[0];
    if (!account || !timingSafeTextEqual(account.token_hash, tokenHash)) {
      return { ok: false, error: "UNAUTHORIZED" };
    }
    const transactions = this.sql.exec(
      "SELECT reference,amount_irr,kind,description,created_at FROM ledger ORDER BY created_at DESC LIMIT 30",
    ).toArray();
    return {
      ok: true,
      account: {
        customer: account.customer,
        balance_irr: Number(account.balance_irr || 0),
        created_at: Number(account.created_at || 0),
        updated_at: Number(account.updated_at || 0),
        subscription: parseStoredJson(account.subscription_json),
        transactions,
      },
    };
  }

  credit(tokenHash, amountIrr, reference, description) {
    return this.ctx.storage.transactionSync(() => {
      const auth = this.snapshotByHash(tokenHash);
      if (!auth.ok) return auth;
      const now = Date.now();
      const written = this.sql.exec(
        "INSERT OR IGNORE INTO ledger(reference,amount_irr,kind,description,created_at) VALUES(?,?,'credit',?,?)",
        reference,
        amountIrr,
        description,
        now,
      );
      if (written.rowsWritten > 0) {
        this.sql.exec(
          "UPDATE account SET balance_irr=balance_irr+?,updated_at=? WHERE singleton=1",
          amountIrr,
          now,
        );
      }
      return this.snapshotByHash(tokenHash);
    });
  }

  debit(tokenHash, amountIrr, reference, description) {
    return this.ctx.storage.transactionSync(() => {
      const auth = this.snapshotByHash(tokenHash);
      if (!auth.ok) return auth;
      const exists = this.sql.exec(
        "SELECT reference FROM ledger WHERE reference=?",
        reference,
      ).toArray()[0];
      if (exists) return { ok: true, account: auth.account, duplicate: true };
      const balance = Number(auth.account.balance_irr || 0);
      if (balance < amountIrr) return { ok: false, error: "INSUFFICIENT_BALANCE" };
      const now = Date.now();
      this.sql.exec(
        "INSERT INTO ledger(reference,amount_irr,kind,description,created_at) VALUES(?,?,'debit',?,?)",
        reference,
        -amountIrr,
        description,
        now,
      );
      this.sql.exec(
        "UPDATE account SET balance_irr=balance_irr-?,updated_at=? WHERE singleton=1",
        amountIrr,
        now,
      );
      return this.snapshotByHash(tokenHash);
    });
  }

  setSubscription(tokenHash, subscription) {
    const auth = this.snapshotByHash(tokenHash);
    if (!auth.ok) return auth;
    this.sql.exec(
      "UPDATE account SET subscription_json=?,updated_at=? WHERE singleton=1",
      JSON.stringify(subscription),
      Date.now(),
    );
    return this.snapshotByHash(tokenHash);
  }
}

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
    if (request.method === "GET" && url.pathname === "/v1/payment-methods") {
      const availability = await paymentAvailability(env);
      return json(
        { methods: Object.entries(availability).filter(([, enabled]) => enabled).map(([method]) => method) },
        200,
        publicHeaders(),
      );
    }
    if (request.method === "POST" && url.pathname === "/v1/account/register") {
      return registerAccount(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/account") {
      return getAccount(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/wallet/topups") {
      return createWalletTopup(request, env);
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
        const settings = await storeSettings(env);
        const rate = await trxRate(env);
        return json(
          {
            settings: {
              ...settings,
              trx_rate_irr: rate.ok ? rate.rate_irr : 0,
              trx_rate_market_irr: rate.ok ? rate.market_rate_irr : 0,
              trx_rate_updated_at: rate.ok ? rate.updated_at : 0,
              trx_rate_source: rate.ok ? rate.source : "unavailable",
            },
          },
          200,
          noStoreHeaders(),
        );
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
    if (
      request.method === "GET" &&
      url.pathname === "/v1/internal/card-orders"
    ) {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401, noStoreHeaders());
      }
      return listCardOrders(env);
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

async function registerAccount(request, env) {
  if (!env.ACCOUNT_LEDGER) return json({ error: "ACCOUNTS_NOT_CONFIGURED" }, 503);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const customer = clean(parsed.value.customer, 120);
  if (!customer) return json({ error: "INVALID_CUSTOMER" }, 400, noStoreHeaders());
  const accountId = crypto.randomUUID().toLowerCase();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const stub = env.ACCOUNT_LEDGER.getByName(accountId);
  const created = await stub.initialize(customer, tokenHash);
  if (!created.ok) return json({ error: created.error }, 500, noStoreHeaders());
  return json(
    { account: publicAccount(created.account, accountId), account_token: token },
    201,
    noStoreHeaders(),
  );
}

async function getAccount(request, env) {
  const auth = await requiredAccountAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, noStoreHeaders());
  let snapshot = await auth.stub.snapshotByHash(auth.tokenHash);
  if (!snapshot.ok) return json({ error: snapshot.error }, 401, noStoreHeaders());
  const subscription = snapshot.account.subscription;
  if (subscription?.username) {
    const live = await pasarGuardUser(subscription.username, env);
    if (live.ok) {
      const normalized = subscriptionFromPasarGuard(live.user, subscription.subscription_url);
      snapshot = await auth.stub.setSubscription(auth.tokenHash, normalized);
    }
  }
  return json({ account: publicAccount(snapshot.account, auth.accountId) }, 200, noStoreHeaders());
}

async function createWalletTopup(request, env) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const auth = await requiredAccountAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, noStoreHeaders());
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const amount = positiveInteger(parsed.value.amount_irr);
  const method = String(parsed.value.payment_method || "");
  if (amount < 50_000 || amount > 100_000_000 || !["trx", "card", "rial_gateway", "swappay", "oxapay"].includes(method)) {
    return json({ error: "INVALID_TOPUP" }, 400, noStoreHeaders());
  }
  const id = crypto.randomUUID().toLowerCase();
  const clientSecret = randomToken(32);
  const now = Date.now();
  const payment = await paymentFor(method, { price: amount }, env, {
    orderId: id,
    description: "شارژ کیف پول Venzo",
  });
  if (!payment.ok) return json({ error: payment.error }, 503, noStoreHeaders());
  const storedPayment = method === "card"
    ? { amount: payment.value.amount, currency: payment.value.currency, card_last4: payment.value.card_number.slice(-4) }
    : payment.value;
  const order = {
    id,
    plan_id: "wallet-topup",
    customer: auth.account.customer,
    account_id: auth.accountId,
    account_token_hash: auth.tokenHash,
    purpose: "wallet_topup",
    payment_method: method,
    status: "awaiting_payment",
    price_irr: amount,
    payment: storedPayment,
    client_secret_hash: await sha256(clientSecret),
    created_at: now,
    expires_at: now + ORDER_TTL_MS,
    last_checked_at: 0,
  };
  await saveOrder(env, order);
  return json({ order: publicOrder(order, env), client_secret: clientSecret }, 201, noStoreHeaders());
}

async function createOrder(request, env) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const settings = await storeSettings(env);
  const plan = plansFrom(settings).find((item) => item.id === parsed.value.plan_id);
  const customer = clean(parsed.value.customer, 120);
  const method = String(parsed.value.payment_method || "");
  const accountAuth = await optionalAccountAuth(request, env);
  const effectiveCustomer = accountAuth.ok ? accountAuth.account.customer : customer;
  const renewUsername = clean(parsed.value.renew_username, 64);
  if (!plan || !effectiveCustomer || !["trx", "card", "rial_gateway", "wallet", "swappay", "oxapay"].includes(method)) {
    return json({ error: "INVALID_ORDER" }, 400);
  }
  if ((method === "wallet" || renewUsername) && !accountAuth.ok) {
    return json({ error: "ACCOUNT_REQUIRED" }, 401, noStoreHeaders());
  }
  const id = crypto.randomUUID().toLowerCase();
  const clientSecret = randomToken(32);
  const now = Date.now();
  const payment = method === "wallet"
    ? { ok: true, value: { amount: String(plan.price), currency: "IRR" } }
    : await paymentFor(method, plan, env, {
        orderId: id,
        description: `${renewUsername ? "تمدید" : "خرید"} ${plan.title}`,
      });
  if (!payment.ok) return json({ error: payment.error }, 503);
  const storedPayment = method === "card"
    ? {
        amount: payment.value.amount,
        currency: payment.value.currency,
        card_last4: payment.value.card_number.slice(-4),
      }
    : payment.value;

  const order = {
    id,
    plan_id: plan.id,
    customer: effectiveCustomer,
    account_id: accountAuth.ok ? accountAuth.accountId : null,
    account_token_hash: accountAuth.ok ? accountAuth.tokenHash : null,
    purpose: renewUsername ? "renewal" : "subscription",
    renew_username: renewUsername || null,
    payment_method: method,
    status: "awaiting_payment",
    price_irr: plan.price,
    payment: storedPayment,
    client_secret_hash: await sha256(clientSecret),
    created_at: now,
    expires_at: now + ORDER_TTL_MS,
    last_checked_at: 0,
  };
  if (method === "wallet") {
    order.status = "wallet_processing";
    await saveOrder(env, order);
    const fulfilled = await processWalletOrder(order, env);
    await saveOrder(env, fulfilled);
    if (fulfilled.status === "payment_failed") {
      return json({ error: fulfilled.payment_error }, 409, noStoreHeaders());
    }
    return json(
      { order: publicOrder(fulfilled, env), client_secret: clientSecret },
      201,
      noStoreHeaders(),
    );
  }
  await saveOrder(env, order);
  return json(
    { order: publicOrder(order, env), client_secret: clientSecret },
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
  if (order.status === "wallet_processing") {
    order = await processWalletOrder(order, env);
    await saveOrder(env, order);
  } else if (order.status === "awaiting_payment" && Date.now() > order.expires_at) {
    order.status = "expired";
    await saveOrder(env, order);
  } else if (
    order.status === "awaiting_payment" &&
    order.payment_method !== "card" &&
    Date.now() - Number(order.last_checked_at || 0) >= 15_000
  ) {
    order.last_checked_at = Date.now();
    const match = ["swappay", "oxapay"].includes(order.payment_method)
      ? await findHostedPayment(order, env)
      : await findCryptoPayment(order, env);
    if (match?.status === "failed") {
      order.status = "payment_failed";
      order.payment_error = match.error || "PAYMENT_FAILED";
    } else if (match) {
      order.status = "paid";
      order.payment_txid = match.txid;
      order.paid_at = match.paid_at;
      order = await fulfillOrder(order, env);
    }
    await saveOrder(env, order);
  }
  return json({ order: publicOrder(order, env) }, 200, noStoreHeaders());
}

async function processWalletOrder(order, env) {
  const account = accountStubForOrder(order, env);
  if (!account) {
    order.status = "payment_failed";
    order.payment_error = "ACCOUNT_NOT_CONFIGURED";
    return order;
  }
  const plan = (await plansFor(env)).find((item) => item.id === order.plan_id);
  if (!plan) {
    order.status = "payment_failed";
    order.payment_error = "PLAN_NOT_FOUND";
    return order;
  }
  const debit = await account.stub.debit(
    order.account_token_hash,
    order.price_irr,
    `order:${order.id}`,
    order.purpose === "renewal" ? `تمدید ${plan.title}` : `خرید ${plan.title}`,
  );
  if (!debit.ok) {
    order.status = "payment_failed";
    order.payment_error = debit.error;
    return order;
  }
  order.status = "paid";
  order.paid_at = order.paid_at || Date.now();
  const fulfilled = await fulfillOrder(order, env);
  if (fulfilled.status === "provisioning_failed") {
    await account.stub.credit(
      order.account_token_hash,
      order.price_irr,
      `refund:${order.id}`,
      "بازگشت وجه سفارش ناموفق",
    );
  }
  return fulfilled;
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
  return json({ order: publicOrder(order, env) }, 202, noStoreHeaders());
}

async function approveCardOrder(request, env, id) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  let order = await loadOrder(env, id);
  if (!order) return json({ error: "ORDER_NOT_FOUND" }, 404);
  const retryable = ["awaiting_manual_review", "provisioning_failed"].includes(order.status);
  if (order.payment_method !== "card" || !retryable) {
    return json({ error: "INVALID_ORDER_STATE" }, 409);
  }
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  order.status = "paid";
  order.payment_reference = clean(parsed.value.bank_reference, 120) || "manual";
  order.paid_at = Date.now();
  order = await fulfillOrder(order, env);
  await saveOrder(env, order);
  return json({ order: publicOrder(order, env) }, 200, noStoreHeaders());
}

async function listCardOrders(env) {
  if (!env.ORDERS) return json({ error: "STORE_NOT_CONFIGURED" }, 503);
  const rows = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: "order:", cursor, limit: 200 });
    for (const key of page.keys) {
      const order = await env.ORDERS.get(key.name, "json");
      if (order?.payment_method === "card" &&
          ["awaiting_manual_review", "provisioning_failed"].includes(order?.status)) {
        rows.push({
          ...publicOrder(order),
          customer: order.customer,
          card_receipt: order.card_receipt,
        });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && rows.length < 500);
  rows.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  return json({ orders: rows }, 200, noStoreHeaders());
}

async function fulfillOrder(order, env) {
  if (order.purpose === "wallet_topup") {
    const account = accountStubForOrder(order, env);
    if (!account) {
      order.status = "provisioning_failed";
      order.provisioning_error = "ACCOUNT_NOT_CONFIGURED";
      return order;
    }
    const credited = await account.stub.credit(
      order.account_token_hash,
      order.price_irr,
      `topup:${order.id}`,
      "شارژ کیف پول Venzo",
    );
    if (!credited.ok) {
      order.status = "provisioning_failed";
      order.provisioning_error = credited.error;
      return order;
    }
    order.status = "fulfilled";
    order.fulfilled_at = Date.now();
    order.wallet_balance_irr = credited.account.balance_irr;
    return order;
  }
  const result = order.purpose === "renewal"
    ? await renewProvision(order, env)
    : await provision(
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
  order.subscription = result.value.subscription || null;
  const account = accountStubForOrder(order, env);
  if (account) {
    await account.stub.setSubscription(
      order.account_token_hash,
      result.value.subscription || {
        username: result.value.username,
        subscription_url: result.value.subscription_url,
      },
    );
  }
  return order;
}

async function provision(body, env) {
  const orderId = clean(body.order_id, 80);
  const customer = clean(body.customer, 120);
  const plan = (await plansFor(env)).find((item) => item.id === body.plan_id);
  if (!orderId || !customer || !plan) return { ok: false, error: "INVALID_ORDER" };

  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  const settings = await storeSettings(env);
  let groupIds = settings.pasarguard_group_ids.length
    ? settings.pasarguard_group_ids
    : numericIds(String(env.PASARGUARD_GROUP_IDS || "").split(","));
  if (!baseUrl) {
    return { ok: false, error: "PASARGUARD_NOT_CONFIGURED" };
  }
  if (groupIds.length === 0) {
    const discovered = await pasarGuardGroups(env);
    if (discovered.ok) groupIds = discovered.groups.map((group) => group.id);
  }
  if (groupIds.length === 0) {
    return { ok: false, error: "PASARGUARD_GROUPS_NOT_CONFIGURED" };
  }
  const auth = await pasarGuardAuth(baseUrl, env);
  if (!auth.ok) return auth;

  const username = await usernameFor(orderId);
  const payload = {
    username,
    status: "active",
    proxy_settings: {},
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
    const error = response.status === 401 || response.status === 403
      ? "PASARGUARD_PERMISSION_DENIED"
      : response.status === 422
        ? "PASARGUARD_PAYLOAD_REJECTED"
        : `PROVISIONING_FAILED_${response.status}`;
    return { ok: false, error };
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
      subscription: subscriptionFromPasarGuard(user, user.subscription_url),
    },
  };
}

async function renewProvision(order, env) {
  const plan = (await plansFor(env)).find((item) => item.id === order.plan_id);
  if (!plan || !order.renew_username) return { ok: false, error: "INVALID_RENEWAL" };
  const current = await pasarGuardUser(order.renew_username, env);
  if (!current.ok) return current;
  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  const auth = await pasarGuardAuth(baseUrl, env);
  if (!auth.ok) return auth;
  const now = Math.floor(Date.now() / 1000);
  const currentExpire = epochSeconds(current.user.expire);
  const currentLimit = Math.max(0, Number(current.user.data_limit || 0));
  const used = Math.max(0, Number(current.user.used_traffic || 0));
  const dataLimit = Math.max(currentLimit, used) + plan.data_gb * GIB;
  const payload = {
    status: "active",
    expire: Math.max(now, currentExpire) + plan.days * DAY,
    data_limit: dataLimit,
    data_limit_reset_strategy: "no_reset",
  };
  const response = await fetch(
    `${baseUrl}/api/user/by-id/${encodeURIComponent(String(current.user.id))}`,
    {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...auth.headers },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    console.error("PasarGuard renewal failed", { status: response.status, order_id: order.id });
    return { ok: false, error: "RENEWAL_FAILED" };
  }
  const user = await response.json();
  const subscriptionUrl = String(user.subscription_url || current.user.subscription_url || "");
  if (!subscriptionUrl.startsWith("https://")) {
    return { ok: false, error: "INVALID_SUBSCRIPTION_URL" };
  }
  return {
    ok: true,
    value: {
      order_id: order.id,
      username: user.username || order.renew_username,
      subscription_url: subscriptionUrl,
      plan_id: plan.id,
      subscription: subscriptionFromPasarGuard(user, subscriptionUrl),
    },
  };
}

async function pasarGuardUser(username, env) {
  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  if (!baseUrl) return { ok: false, error: "PASARGUARD_NOT_CONFIGURED" };
  const auth = await pasarGuardAuth(baseUrl, env);
  if (!auth.ok) return auth;
  const response = await fetch(
    `${baseUrl}/api/user/by-username/${encodeURIComponent(username)}`,
    { headers: { Accept: "application/json", ...auth.headers } },
  );
  if (!response.ok) return { ok: false, error: "PASARGUARD_USER_FAILED" };
  return { ok: true, user: await response.json() };
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

async function paymentFor(method, plan, env, context = {}) {
  if (method === "card") {
    const cardNumber = digits(env.CARD_NUMBER, 16);
    const cardHolder = clean(env.CARD_HOLDER, 120);
    if (cardNumber.length !== 16 || !cardHolder) {
      return { ok: false, error: "CARD_PAYMENT_NOT_CONFIGURED" };
    }
    return {
      ok: true,
      value: {
        amount: String(plan.price),
        currency: "IRR",
        card_number: cardNumber,
        card_holder: cardHolder,
      },
    };
  }
  if (method === "rial_gateway") {
    return { ok: false, error: "RIAL_GATEWAY_NOT_CONFIGURED" };
  }
  if (method === "swappay") {
    return createSwapPayInvoice(plan, env, context);
  }
  if (method === "oxapay") {
    return createOxaPayInvoice(plan, env, context);
  }
  if (method !== "trx") return { ok: false, error: "INVALID_PAYMENT_METHOD" };
  const wallet = clean(env.TRON_WALLET_ADDRESS, 64);
  const rate = await trxRate(env);
  if (!wallet || !rate.ok) {
    return { ok: false, error: "CRYPTO_PAYMENT_NOT_CONFIGURED" };
  }
  const baseAtomic = Math.ceil((plan.price * 1_000_000) / rate.rate_irr);
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
      rate_irr: rate.rate_irr,
      market_rate_irr: rate.market_rate_irr,
      rate_source: rate.source,
      rate_updated_at: rate.updated_at,
    },
  };
}

async function hostedAmountUsd(priceIrr, env) {
  const rate = await usdRate(env);
  if (!rate.ok) return null;
  const amount = Number((Number(priceIrr) / rate.rate_irr).toFixed(2));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function createSwapPayInvoice(plan, env, context) {
  const apiKey = clean(env.SWAPPAY_API_KEY, 240);
  if (!apiKey) return { ok: false, error: "SWAPPAY_NOT_CONFIGURED" };
  const base = validHttpsOrigin(env.SWAPPAY_API_BASE) || "https://swapwallet.app/api";
  const orderId = clean(context.orderId, 80);
  const body = {
    amount: {
      number: String(Math.max(1, Math.ceil(Number(plan.price) / 10))),
      unit: "IRT",
    },
    allowedToken: "USDT",
    network: "TRON",
    ttl: Math.floor(ORDER_TTL_MS / 1000),
    orderId,
    description: clean(context.description, 160) || "Venzo VPN",
    customData: JSON.stringify({ order_id: orderId }),
  };
  const returnUrl = validHttpsUrl(env.PAYMENT_RETURN_URL);
  if (returnUrl) body.returnUrl = returnUrl;
  try {
    const response = await fetch(`${base}/v1/merchants/invoices/temporary-wallet`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await safeResponseJson(response);
    const invoice = payload?.result || payload?.data || payload;
    const invoiceId = clean(invoice?.id || invoice?.invoiceId, 120);
    const links = Array.isArray(invoice?.links) ? invoice.links : [];
    const checkoutUrl = validHttpsUrl(
      links.find((item) => String(item?.name || "").toUpperCase() === "SWAP_WALLET")?.url ||
        links.find((item) => validHttpsUrl(item?.url))?.url,
    );
    if (!response.ok || !invoiceId || !checkoutUrl) {
      console.error("SwapPay invoice failed", { status: response.status });
      if ([401, 403].includes(response.status)) {
        return { ok: false, error: "SWAPPAY_AUTH_FAILED" };
      }
      if ([400, 409, 422].includes(response.status)) {
        return { ok: false, error: "SWAPPAY_REQUEST_REJECTED" };
      }
      if (response.status >= 500) {
        return { ok: false, error: "SWAPPAY_PROVIDER_ERROR" };
      }
      return {
        ok: false,
        error: response.ok ? "SWAPPAY_RESPONSE_INVALID" : "SWAPPAY_INVOICE_FAILED",
      };
    }
    return {
      ok: true,
      value: {
        provider: "SwapPay",
        amount: String(plan.price),
        currency: "IRR",
        network: "TRON",
        token: "USDT",
        invoice_id: invoiceId,
        wallet_address: clean(invoice?.walletAddress, 160) || undefined,
        checkout_url: checkoutUrl,
      },
    };
  } catch (error) {
    console.error("SwapPay invoice failed", {
      message: String(error?.message || "unknown").slice(0, 80),
    });
    return { ok: false, error: "SWAPPAY_UNAVAILABLE" };
  }
}

async function createOxaPayInvoice(plan, env, context) {
  const apiKey = clean(env.OXAPAY_MERCHANT_API_KEY, 240);
  const amount = await hostedAmountUsd(plan.price, env);
  if (!apiKey || !amount) return { ok: false, error: "OXAPAY_NOT_CONFIGURED" };
  if (amount < 0.1) return { ok: false, error: "OXAPAY_AMOUNT_TOO_LOW" };
  const body = {
    amount,
    currency: "USD",
    lifetime: Math.ceil(ORDER_TTL_MS / 60_000),
    order_id: clean(context.orderId, 80),
    description: clean(context.description, 160) || "Venzo VPN",
  };
  const returnUrl = validHttpsUrl(env.PAYMENT_RETURN_URL);
  if (returnUrl) body.return_url = returnUrl;
  try {
    const response = await fetch("https://api.oxapay.com/v1/payment/invoice", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        merchant_api_key: apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await safeResponseJson(response);
    const data = payload?.data || payload;
    const trackId = clean(data?.track_id || data?.trackId, 120);
    const checkoutUrl = validHttpsUrl(data?.payment_url || data?.payLink);
    if (!response.ok || !trackId || !checkoutUrl) {
      console.error("OxaPay invoice failed", { status: response.status });
      if ([401, 403].includes(response.status)) {
        return { ok: false, error: "OXAPAY_AUTH_FAILED" };
      }
      if ([400, 409, 422].includes(response.status)) {
        return { ok: false, error: "OXAPAY_REQUEST_REJECTED" };
      }
      return {
        ok: false,
        error: response.ok ? "OXAPAY_RESPONSE_INVALID" : "OXAPAY_INVOICE_FAILED",
      };
    }
    return {
      ok: true,
      value: {
        provider: "OxaPay",
        amount: amount.toFixed(2),
        currency: "USD",
        track_id: trackId,
        checkout_url: checkoutUrl,
      },
    };
  } catch (error) {
    console.error("OxaPay invoice failed", {
      message: String(error?.message || "unknown").slice(0, 80),
    });
    return { ok: false, error: "OXAPAY_UNAVAILABLE" };
  }
}

async function findHostedPayment(order, env) {
  if (order.payment_method === "swappay") return findSwapPayPayment(order, env);
  if (order.payment_method === "oxapay") return findOxaPayPayment(order, env);
  return null;
}

async function findSwapPayPayment(order, env) {
  const apiKey = clean(env.SWAPPAY_API_KEY, 240);
  const invoiceId = clean(order.payment?.invoice_id, 120);
  if (!apiKey || !invoiceId) return null;
  const base = validHttpsOrigin(env.SWAPPAY_API_BASE) || "https://swapwallet.app/api";
  try {
    const response = await fetch(
      `${base}/v1/merchants/invoices/${encodeURIComponent(invoiceId)}`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const payload = await safeResponseJson(response);
    const invoice = payload?.result || payload?.data || payload;
    const status = String(invoice?.status || "").toUpperCase();
    if (["PAID", "COMPLETE", "COMPLETED"].includes(status)) {
      return {
        status: "paid",
        txid: clean(invoice?.transactionId || invoice?.txid, 160) || invoiceId,
        paid_at: providerTimestamp(invoice?.paidAt || invoice?.updatedAt),
      };
    }
    if (["EXPIRED", "CANCELLED", "CANCELED", "FAILED"].includes(status)) {
      return { status: "failed", error: `SWAPPAY_${status}` };
    }
    return null;
  } catch {
    return null;
  }
}

async function findOxaPayPayment(order, env) {
  const apiKey = clean(env.OXAPAY_MERCHANT_API_KEY, 240);
  const trackId = clean(order.payment?.track_id, 120);
  if (!apiKey || !trackId) return null;
  try {
    const response = await fetch(
      `https://api.oxapay.com/v1/payment/${encodeURIComponent(trackId)}`,
      {
        headers: { Accept: "application/json", merchant_api_key: apiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const payload = await safeResponseJson(response);
    const data = payload?.data || payload;
    const status = String(data?.status || "").toLowerCase();
    if (["paid", "manual_accept"].includes(status)) {
      return {
        status: "paid",
        txid: clean(data?.txid || data?.transaction_id, 160) || trackId,
        paid_at: providerTimestamp(data?.date || data?.paid_at || data?.updated_at),
      };
    }
    if (["expired", "refunded", "failed", "canceled", "cancelled"].includes(status)) {
      return { status: "failed", error: `OXAPAY_${status.toUpperCase()}` };
    }
    return null;
  } catch {
    return null;
  }
}

async function safeResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function providerTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
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

async function trxRate(env) {
  const now = Date.now();
  let cached = null;
  if (env.ORDERS) {
    try {
      cached = await env.ORDERS.get(TRX_RATE_CACHE_KEY, "json");
    } catch {
      cached = null;
    }
  }
  const cachedRate = positiveInteger(cached?.rate_irr);
  const cachedMarketRate = positiveInteger(cached?.market_rate_irr);
  const cachedAt = Number(cached?.updated_at || 0);
  if (cachedRate && cachedMarketRate && now - cachedAt <= TRX_RATE_MAX_AGE_MS) {
    return {
      ok: true,
      rate_irr: cachedRate,
      market_rate_irr: cachedMarketRate,
      updated_at: cachedAt,
      source: "nobitex-cache",
    };
  }

  try {
    const response = await fetch(
      "https://apiv2.nobitex.ir/market/stats?srcCurrency=trx&dstCurrency=rls",
      {
        headers: { Accept: "application/json", "User-Agent": "Venzo-Store/1.0" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const marketRate = positiveInteger(payload?.stats?.["trx-rls"]?.bestBuy);
    if (!marketRate) throw new Error("INVALID_TRX_RATE");
    const rate = Math.floor(marketRate * TRX_RATE_SAFETY_FACTOR);
    const value = {
      rate_irr: rate,
      market_rate_irr: marketRate,
      updated_at: now,
    };
    if (env.ORDERS) {
      await env.ORDERS.put(TRX_RATE_CACHE_KEY, JSON.stringify(value), {
        expirationTtl: 24 * 60 * 60,
      });
    }
    return { ok: true, ...value, source: "nobitex" };
  } catch (error) {
    console.error("TRX rate fetch failed", {
      message: String(error?.message || "unknown").slice(0, 80),
    });
  }

  if (
    cachedRate &&
    cachedMarketRate &&
    now - cachedAt <= TRX_RATE_STALE_MAX_AGE_MS
  ) {
    return {
      ok: true,
      rate_irr: cachedRate,
      market_rate_irr: cachedMarketRate,
      updated_at: cachedAt,
      source: "nobitex-stale-cache",
    };
  }
  return { ok: false, error: "TRX_RATE_UNAVAILABLE" };
}

async function usdRate(env) {
  const override = positiveInteger(env.USD_IRR);
  if (override) {
    return { ok: true, rate_irr: override, updated_at: Date.now(), source: "env" };
  }
  const now = Date.now();
  let cached = null;
  if (env.ORDERS) {
    try {
      cached = await env.ORDERS.get(USD_RATE_CACHE_KEY, "json");
    } catch {
      cached = null;
    }
  }
  const cachedRate = positiveInteger(cached?.rate_irr);
  const cachedAt = Number(cached?.updated_at || 0);
  if (cachedRate && now - cachedAt <= USD_RATE_MAX_AGE_MS) {
    return { ok: true, rate_irr: cachedRate, updated_at: cachedAt, source: "nobitex-cache" };
  }
  try {
    const response = await fetch(
      "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls",
      {
        headers: { Accept: "application/json", "User-Agent": "Venzo-Store/1.0" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const rate = positiveInteger(payload?.stats?.["usdt-rls"]?.bestBuy);
    if (!rate) throw new Error("INVALID_USD_RATE");
    const value = { rate_irr: rate, updated_at: now };
    if (env.ORDERS) {
      await env.ORDERS.put(USD_RATE_CACHE_KEY, JSON.stringify(value), {
        expirationTtl: 24 * 60 * 60,
      });
    }
    return { ok: true, ...value, source: "nobitex-usdt" };
  } catch (error) {
    console.error("USD rate fetch failed", {
      message: String(error?.message || "unknown").slice(0, 80),
    });
  }
  if (cachedRate && now - cachedAt <= USD_RATE_STALE_MAX_AGE_MS) {
    return { ok: true, rate_irr: cachedRate, updated_at: cachedAt, source: "nobitex-stale-cache" };
  }
  return { ok: false, error: "USD_RATE_UNAVAILABLE" };
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
  const groupIds = numericIds(parsed.value.pasarguard_group_ids);
  if (
    pricePerGb < 1_000 ||
    pricePerGb > 100_000_000 ||
    groupIds.length === 0
  ) {
    return json({ error: "INVALID_SETTINGS" }, 400, noStoreHeaders());
  }
  const settings = {
    price_per_gb_irr: pricePerGb,
    pasarguard_group_ids: groupIds,
    updated_at: Date.now(),
  };
  await env.ORDERS.put(STORE_SETTINGS_KEY, JSON.stringify(settings));
  return json({ settings }, 200, noStoreHeaders());
}

async function paymentAvailability(env) {
  const [rate, hostedRate] = await Promise.all([trxRate(env), usdRate(env)]);
  const hostedRateReady = hostedRate.ok;
  return {
    trx: Boolean(
      env.TRON_WALLET_ADDRESS &&
        rate.ok &&
        env.TRONGRID_API_KEY,
    ),
    card: digits(env.CARD_NUMBER, 16).length === 16 && Boolean(clean(env.CARD_HOLDER, 120)),
    swappay: Boolean(clean(env.SWAPPAY_API_KEY, 240)),
    oxapay: Boolean(hostedRateReady && clean(env.OXAPAY_MERCHANT_API_KEY, 240)),
    rial_gateway: false,
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
    #orders{display:grid;gap:10px;margin-top:12px}.order{background:#0e0f12;border:1px solid #34363e;border-radius:12px;padding:12px}.order small{display:block;color:var(--muted);direction:ltr;margin:4px 0}.order button{width:100%;margin-top:8px;background:#2e7d55;color:#fff}
    #status{min-height:26px;margin-top:14px;color:#ffcf70}.note{font-size:13px;margin-top:18px}.ok{color:#63e6a4!important}.error{color:#ff808e!important}
  </style>
</head>
<body><main>
  <h1>Venzo VPN Store</h1>
  <p>قیمت پلن‌ها را بدون انتشار نسخه جدید اپ تغییر دهید. نرخ TRX خودکار و زنده دریافت می‌شود.</p>
  <form id="settings">
    <label for="secret">رمز مدیریت</label>
    <input id="secret" type="password" autocomplete="off" required>
    <label for="price">قیمت هر گیگ به ریال</label>
    <input id="price" type="number" min="1000" step="1000" required>
    <label for="rate">نرخ خودکار هر TRX به ریال</label>
    <input id="rate" type="number" readonly>
    <label>گروه‌های دسترسی پاسارگارد</label>
    <div id="groups"><span>پس از واردکردن رمز، «دریافت تنظیمات» را بزنید.</span></div>
    <div class="actions">
      <button class="secondary" type="button" id="load">دریافت قیمت فعلی</button>
      <button class="primary" type="submit">ذخیره تغییرات</button>
    </div>
  </form>
  <div class="actions">
    <button class="secondary" type="button" id="card-orders">رسیدهای کارت‌به‌کارت</button>
  </div>
  <div id="orders"></div>
  <div id="status" role="status"></div>
  <p class="note">رمز مدیریت در مرورگر ذخیره نمی‌شود. قیمت هر گیگ را به ریال و بدون جداکننده وارد کنید.</p>
</main>
<script nonce="${nonce}">
  const secret=document.querySelector('#secret'),price=document.querySelector('#price'),rate=document.querySelector('#rate'),groups=document.querySelector('#groups'),orders=document.querySelector('#orders'),status=document.querySelector('#status');
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
  function renderOrders(rows){
    orders.replaceChildren();
    if(!rows.length){orders.textContent='رسید در انتظار تأیید وجود ندارد.';return}
    for(const row of rows){
      const wrap=document.createElement('div');wrap.className='order';
      const title=document.createElement('strong');title.textContent=row.customer||'مشتری';
      const plan=document.createElement('small');plan.textContent='پلن: '+row.plan_id+' | مبلغ: '+row.price_irr+' ریال';
      const reference=document.createElement('small');reference.textContent='پیگیری: '+(row.card_receipt?.reference||'—')+' | تلگرام: '+(row.card_receipt?.telegram_username||'—');
      const id=document.createElement('small');id.textContent='سفارش: '+row.id;
      const failure=document.createElement('small');failure.textContent=row.provisioning_error?'خطای ساخت: '+row.provisioning_error:'';
      const approve=document.createElement('button');approve.type='button';approve.textContent=row.status==='provisioning_failed'?'تلاش مجدد برای ساخت اشتراک':'تأیید و ساخت اشتراک';approve.addEventListener('click',()=>approveOrder(row.id));
      wrap.append(title,plan,reference,id,failure,approve);orders.append(wrap);
    }
  }
  async function loadOrders(){
    if(!secret.value){message('ابتدا رمز مدیریت را وارد کنید.','error');return}
    message('در حال دریافت رسیدها...');
    const response=await fetch('/v1/internal/card-orders',{headers:headers(),cache:'no-store'});
    if(!response.ok){message(response.status===401?'رمز مدیریت نادرست است.':'دریافت رسیدها ناموفق بود.','error');return}
    const body=await response.json();renderOrders(body.orders||[]);message('رسیدها دریافت شد.','ok');
  }
  async function approveOrder(id){
    const bankReference=prompt('شماره مرجع بانکی را وارد کنید:','manual');if(bankReference===null)return;
    message('در حال تأیید و ساخت اشتراک...');
    const response=await fetch('/v1/internal/card-orders/'+encodeURIComponent(id)+'/approve',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({bank_reference:bankReference})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){message('تأیید سفارش ناموفق بود: '+(body.error||response.status),'error');return}
    if(body.order?.status!=='fulfilled'){message('ساخت اشتراک ناموفق بود: '+(body.order?.provisioning_error||body.order?.status||'unknown'),'error');await loadOrders();return}
    message('پرداخت تأیید و اشتراک ساخته شد.','ok');await loadOrders();
  }
  document.querySelector('#load').addEventListener('click',()=>load().catch(()=>message('خطای ارتباط با سرور.','error')));
  document.querySelector('#card-orders').addEventListener('click',()=>loadOrders().catch(()=>message('خطای ارتباط با سرور.','error')));
  document.querySelector('#settings').addEventListener('submit',async event=>{
    event.preventDefault();message('در حال ذخیره...');
    try{
      const response=await fetch('/v1/internal/settings',{method:'PUT',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({price_per_gb_irr:Number(price.value),pasarguard_group_ids:selectedGroups()})});
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

function publicOrder(order, env) {
  const value = {
    id: order.id,
    plan_id: order.plan_id,
    payment_method: order.payment_method,
    status: order.status,
    price_irr: order.price_irr,
    payment: order.payment,
    created_at: order.created_at,
    expires_at: order.expires_at,
    purpose: order.purpose || "subscription",
  };
  if (order.payment_method === "card" && env) {
    const cardNumber = digits(env.CARD_NUMBER, 16);
    const cardHolder = clean(env.CARD_HOLDER, 120);
    if (cardNumber.length === 16 && cardHolder) {
      value.payment = {
        ...order.payment,
        card_number: cardNumber,
        card_holder: cardHolder,
      };
    }
  }
  if (order.payment_txid) value.payment_txid = order.payment_txid;
  if (order.subscription_url) value.subscription_url = order.subscription_url;
  if (order.subscription) value.subscription = order.subscription;
  if (Number.isSafeInteger(order.wallet_balance_irr)) {
    value.wallet_balance_irr = order.wallet_balance_irr;
  }
  if (order.provisioning_error) value.provisioning_error = order.provisioning_error;
  if (order.payment_error) value.payment_error = order.payment_error;
  return value;
}

async function optionalAccountAuth(request, env) {
  const accountId = clean(request.headers.get("x-venzo-account"), 80);
  const supplied = request.headers.get("authorization") || "";
  if (!accountId || !supplied.startsWith("Bearer ") || !env.ACCOUNT_LEDGER) {
    return { ok: false, error: "ACCOUNT_REQUIRED", status: 401 };
  }
  const token = supplied.slice(7);
  if (token.length < 40 || token.length > 160) {
    return { ok: false, error: "UNAUTHORIZED", status: 401 };
  }
  const tokenHash = await sha256(token);
  const stub = env.ACCOUNT_LEDGER.getByName(accountId);
  const snapshot = await stub.snapshotByHash(tokenHash);
  if (!snapshot.ok) return { ok: false, error: "UNAUTHORIZED", status: 401 };
  return { ok: true, accountId, tokenHash, stub, account: snapshot.account };
}

async function requiredAccountAuth(request, env) {
  return optionalAccountAuth(request, env);
}

function accountStubForOrder(order, env) {
  if (!order.account_id || !order.account_token_hash || !env.ACCOUNT_LEDGER) return null;
  return { stub: env.ACCOUNT_LEDGER.getByName(order.account_id) };
}

function publicAccount(account, id) {
  return {
    id,
    customer: account.customer,
    balance_irr: Number(account.balance_irr || 0),
    created_at: Number(account.created_at || 0),
    updated_at: Number(account.updated_at || 0),
    subscription: account.subscription || null,
    transactions: Array.isArray(account.transactions) ? account.transactions : [],
  };
}

function subscriptionFromPasarGuard(user, fallbackUrl = "") {
  return {
    id: positiveInteger(user?.id),
    username: clean(user?.username, 64),
    status: clean(user?.status, 32) || "unknown",
    subscription_url: String(user?.subscription_url || fallbackUrl || ""),
    expire_at: epochSeconds(user?.expire),
    data_limit_bytes: Math.max(0, Number(user?.data_limit || 0)),
    used_traffic_bytes: Math.max(0, Number(user?.used_traffic || 0)),
    updated_at: Date.now(),
  };
}

function epochSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function parseStoredJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function timingSafeTextEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  const secret = String(expected || "");
  const supplied = request.headers.get("authorization") || "";
  const wanted = `Bearer ${secret}`;
  if (secret.length < 8 || supplied.length !== wanted.length) return false;
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Venzo-Account",
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
