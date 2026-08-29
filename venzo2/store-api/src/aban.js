const ABAN_ORIGIN = "https://abangateway.ir";

function tokenFor(env) {
  const token = String(env.ABAN_API_TOKEN || "").trim();
  return token.length >= 8 ? token : "";
}

async function abanRequest(env, path, init = {}) {
  const token = tokenFor(env);
  if (!token) return { ok: false, error: "ABAN_NOT_CONFIGURED" };
  try {
    const response = await fetch(`${ABAN_ORIGIN}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* map by HTTP status */ }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    console.error("AbanGateway request failed", {
      message: String(error?.message || "unknown").slice(0, 80),
    });
    return { ok: false, error: "ABAN_UNAVAILABLE" };
  }
}

function providerError(result, fallback) {
  if (result.error) return result.error;
  const code = String(result.payload?.error?.code || "").toUpperCase();
  if ([401, 403].includes(result.status)) return "ABAN_AUTH_FAILED";
  if (result.status === 429) return "ABAN_RATE_LIMITED";
  if (result.status >= 500) return "ABAN_PROVIDER_ERROR";
  return code ? `ABAN_${code}` : fallback;
}

export function abanConfigured(env) {
  return Boolean(tokenFor(env));
}

export function publicPaymentMethods(env) {
  return abanConfigured(env) ? ["aban"] : [];
}

export async function createAbanInvoice(plan, env, context = {}) {
  const orderId = String(context.orderId || "").slice(0, 128);
  const callbackUrl = /^https:\/\//.test(String(context.callbackUrl || ""))
    ? String(context.callbackUrl) : undefined;
  const body = {
    amount_rial: Number(plan.price),
    order_id: orderId,
    description: String(context.description || "Venzo VPN").slice(0, 1000),
    metadata: { order_id: orderId, product: "venzo-vpn" },
    expiry_minutes: 30,
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  };
  const result = await abanRequest(env, "/api/v1/invoices", {
    method: "POST", body: JSON.stringify(body),
  });
  const invoice = result.payload;
  if (!result.ok || !invoice?.invoice_id || !invoice?.payment_url) {
    return { ok: false, error: providerError(result, "ABAN_INVOICE_FAILED") };
  }
  return { ok: true, value: {
    provider: "AbanGateway",
    invoice_id: String(invoice.invoice_id),
    amount: String(invoice.payable_rial ?? invoice.amount_rial),
    amount_rial: Number(invoice.amount_rial || plan.price),
    payable_rial: Number(invoice.payable_rial || plan.price),
    payable_toman: Number(invoice.payable_toman || 0),
    currency: "IRR",
    checkout_url: String(invoice.payment_url),
    card_number: String(invoice.card_number || ""),
    card_holder: String(invoice.card_holder || ""),
    card_last4: String(invoice.card_last4 || ""),
    iban: String(invoice.iban || ""),
    expires_at: String(invoice.expires_at || ""),
    is_test: Boolean(invoice.is_test),
  }};
}

export async function findAbanPayment(order, env) {
  const invoiceId = String(order.payment?.invoice_id || "").slice(0, 160);
  if (!invoiceId) return null;
  const statusResult = await abanRequest(env, `/api/v1/invoices/${encodeURIComponent(invoiceId)}`);
  if (!statusResult.ok) return null;
  const invoice = statusResult.payload;
  if (["expired", "cancelled"].includes(String(invoice?.status || ""))) {
    return { status: "failed", error: `ABAN_${String(invoice.status).toUpperCase()}` };
  }
  if (String(invoice?.status || "") !== "paid") return null;
  const verify = await abanRequest(env, `/api/v1/invoices/${encodeURIComponent(invoiceId)}/verify`, { method: "POST" });
  if (verify.ok && verify.payload?.verified === true) {
    return {
      status: "paid", txid: invoiceId,
      paid_at: Date.parse(verify.payload?.paid_at || invoice?.paid_at || "") || Date.now(),
    };
  }
  const code = String(verify.payload?.error?.code || "");
  if (verify.status === 409 && code === "already_verified") {
    return { status: "already_verified", txid: invoiceId };
  }
  return { status: "failed", error: providerError(verify, "ABAN_VERIFY_FAILED") };
}

export async function verifyAbanWebhook(rawBody, signature, secret) {
  const key = String(secret || "");
  const given = String(signature || "").toLowerCase();
  if (!key || !/^[a-f0-9]{64}$/.test(given)) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  let mismatch = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return mismatch === 0;
}
