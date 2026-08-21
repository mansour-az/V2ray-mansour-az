const GIB = 1024 ** 3;
const DAY = 24 * 60 * 60;
const VOLUMES = [5, 10, 20, 50, 100];
const DURATIONS = [
  { months: 1, days: 30, label: "یک‌ماهه" },
  { months: 2, days: 60, label: "دوماهه" },
  { months: 3, days: 90, label: "سه‌ماهه" },
];

// Current Venzo retail rule: 3,000 toman per GB per month. API prices are IRR.
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

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "venzo-store-api" });
    }

    if (request.method === "GET" && url.pathname === "/v1/plans") {
      return json({ plans: PLANS }, 200, publicHeaders());
    }

    if (request.method === "POST" && url.pathname === "/v1/orders") {
      return json(
        {
          error: "CHECKOUT_NOT_CONFIGURED",
          support_url: env.SUPPORT_URL || "https://t.me/Venzzo_vpn",
        },
        503,
        publicHeaders(),
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/internal/provision"
    ) {
      if (!(await authorized(request, env.PROVISION_SECRET))) {
        return json({ error: "UNAUTHORIZED" }, 401);
      }
      return provision(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};

async function provision(request, env) {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 8192) return json({ error: "BODY_TOO_LARGE" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const orderId = clean(body.order_id, 80);
  const customer = clean(body.customer, 120);
  const plan = PLANS.find((item) => item.id === body.plan_id);
  if (!orderId || !customer || !plan) {
    return json({ error: "INVALID_ORDER" }, 400);
  }

  const baseUrl = validHttpsOrigin(env.PASARGUARD_BASE_URL);
  const apiKey = String(env.PASARGUARD_API_KEY || "");
  const groupIds = String(env.PASARGUARD_GROUP_IDS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (!baseUrl || !apiKey.startsWith("pg_key_") || groupIds.length === 0) {
    return json({ error: "PASARGUARD_NOT_CONFIGURED" }, 503);
  }

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

  const created = await fetch(`${baseUrl}/api/user`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  let response = created;
  if (created.status === 409) {
    response = await fetch(
      `${baseUrl}/api/user/by-username/${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json", "X-API-Key": apiKey } },
    );
  }

  if (!response.ok) {
    console.error("PasarGuard provisioning failed", {
      status: response.status,
      order_id: orderId,
    });
    return json({ error: "PROVISIONING_FAILED" }, 502);
  }

  const user = await response.json();
  if (!String(user.subscription_url || "").startsWith("https://")) {
    return json({ error: "INVALID_SUBSCRIPTION_URL" }, 502);
  }

  return json({
    order_id: orderId,
    username: user.username || username,
    subscription_url: user.subscription_url,
    plan_id: plan.id,
  });
}

async function usernameFor(orderId) {
  const bytes = new TextEncoder().encode(`venzo:${orderId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `vz_${hex.slice(0, 18)}`;
}

async function authorized(request, expected) {
  const supplied = request.headers.get("authorization") || "";
  const wanted = `Bearer ${String(expected || "")}`;
  if (supplied.length !== wanted.length || wanted.length < 40) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(wanted)]);
  return a === b;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clean(value, maxLength) {
  const result = String(value || "").trim();
  if (result.length < 3 || result.length > maxLength) return "";
  return result.replace(/[\r\n\t]/g, " ");
}

function validHttpsOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function publicHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };
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
