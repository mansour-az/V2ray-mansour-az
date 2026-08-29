const LOGIN_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MEMBERSHIP_CACHE_MS = 5 * 60 * 1000;

export function telegramConfigured(env) {
  return Boolean(
    env.ORDERS &&
      token(env.TELEGRAM_BOT_TOKEN, 20) &&
      token(env.TELEGRAM_WEBHOOK_SECRET, 8) &&
      botUsername(env.TELEGRAM_BOT_USERNAME) &&
      channelId(env.TELEGRAM_REQUIRED_CHANNEL) &&
      ownerId(env.TELEGRAM_OWNER_ID),
  );
}

export async function telegramAuthRouter(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/auth/telegram/config") {
    const username = botUsername(env.TELEGRAM_BOT_USERNAME);
    const channel = channelId(env.TELEGRAM_REQUIRED_CHANNEL);
    return json({
      configured: telegramConfigured(env),
      bot_username: username || null,
      channel_url: channelUrl(env, channel),
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/telegram/sessions") {
    return createLoginSession(env);
  }
  const poll = url.pathname.match(/^\/v1\/auth\/telegram\/sessions\/([a-f0-9]{48})$/);
  if (request.method === "GET" && poll) {
    return pollLoginSession(request, env, poll[1]);
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/telegram/webhook") {
    return telegramWebhook(request, env);
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/telegram/membership") {
    const auth = await requireTelegramSession(request, env, { requireMember: false });
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const checked = await checkMembership(env, auth.session, { force: true });
    if (!checked.ok) return json({ error: checked.error }, checked.status);
    return json({ user: publicUser(checked.session), channel_member: checked.member });
  }
  if (request.method === "GET" && url.pathname === "/v1/auth/me") {
    const auth = await requireTelegramSession(request, env, { requireMember: false });
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return json({
      user: publicUser(auth.session),
      channel_member: Boolean(auth.session.channel_member),
      channel_url: channelUrl(env, channelId(env.TELEGRAM_REQUIRED_CHANNEL)),
    });
  }
  return null;
}

export async function requireTelegramSession(request, env, { requireMember = true, ownerOnly = false } = {}) {
  if (!telegramConfigured(env)) return { ok: false, error: "TELEGRAM_AUTH_NOT_CONFIGURED", status: 503 };
  const supplied = String(request.headers.get("authorization") || "");
  if (!supplied.startsWith("Bearer ") || supplied.length < 40) {
    return { ok: false, error: "TELEGRAM_LOGIN_REQUIRED", status: 401 };
  }
  const accessToken = supplied.slice(7).trim();
  const key = `telegram:session:${await sha256(accessToken)}`;
  const session = await env.ORDERS.get(key, "json");
  if (!session || Number(session.expires_at || 0) <= Date.now()) {
    return { ok: false, error: "TELEGRAM_SESSION_EXPIRED", status: 401 };
  }
  session._key = key;
  if (ownerOnly && String(session.telegram_id) !== String(ownerId(env.TELEGRAM_OWNER_ID))) {
    return { ok: false, error: "OWNER_ONLY", status: 403 };
  }
  if (!requireMember) return { ok: true, session };
  const checked = await checkMembership(env, session);
  if (!checked.ok) return checked;
  if (!checked.member) return { ok: false, error: "CHANNEL_MEMBERSHIP_REQUIRED", status: 403 };
  return { ok: true, session: checked.session };
}

export function acceptedMemberStatus(member) {
  const status = String(member?.status || "");
  return ["creator", "administrator", "member"].includes(status) ||
    (status === "restricted" && member?.is_member === true);
}

async function createLoginSession(env) {
  if (!telegramConfigured(env)) return json({ error: "TELEGRAM_AUTH_NOT_CONFIGURED" }, 503);
  const loginToken = randomHex(24);
  const pollSecret = randomHex(32);
  await env.ORDERS.put(
    `telegram:login:${loginToken}`,
    JSON.stringify({
      status: "pending",
      poll_secret_hash: await sha256(pollSecret),
      created_at: Date.now(),
    }),
    { expirationTtl: LOGIN_TTL_SECONDS },
  );
  const username = botUsername(env.TELEGRAM_BOT_USERNAME);
  return json({
    login_token: loginToken,
    poll_secret: pollSecret,
    bot_url: `https://t.me/${username}?start=${loginToken}`,
    expires_in: LOGIN_TTL_SECONDS,
  }, 201);
}

async function pollLoginSession(request, env, loginToken) {
  if (!telegramConfigured(env)) return json({ error: "TELEGRAM_AUTH_NOT_CONFIGURED" }, 503);
  const key = `telegram:login:${loginToken}`;
  const login = await env.ORDERS.get(key, "json");
  if (!login) return json({ error: "LOGIN_SESSION_EXPIRED" }, 410);
  const pollSecret = String(request.headers.get("x-venzo-login-secret") || "");
  if (!pollSecret || !safeEqual(await sha256(pollSecret), login.poll_secret_hash)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  if (login.status !== "verified" || !login.access_token) {
    return json({ status: "pending" }, 202);
  }
  await env.ORDERS.delete(key);
  return json({
    status: "verified",
    access_token: login.access_token,
    user: publicUser(login),
    channel_member: Boolean(login.channel_member),
    channel_url: channelUrl(env, channelId(env.TELEGRAM_REQUIRED_CHANNEL)),
  });
}

async function telegramWebhook(request, env) {
  if (!telegramConfigured(env)) return json({ error: "TELEGRAM_AUTH_NOT_CONFIGURED" }, 503);
  const supplied = String(request.headers.get("x-telegram-bot-api-secret-token") || "");
  if (!safeEqual(supplied, token(env.TELEGRAM_WEBHOOK_SECRET, 8))) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  let update;
  try {
    update = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const message = update?.message;
  const match = String(message?.text || "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{48})$/);
  const telegramId = Number(message?.from?.id);
  if (!match || !Number.isSafeInteger(telegramId) || telegramId <= 0 || message?.chat?.type !== "private") {
    return json({ received: true });
  }
  const key = `telegram:login:${match[1]}`;
  const login = await env.ORDERS.get(key, "json");
  if (!login || login.status !== "pending") return json({ received: true });
  const accessToken = randomHex(32);
  const now = Date.now();
  const session = {
    telegram_id: String(telegramId),
    username: cleanTelegram(message.from.username, 32),
    first_name: cleanTelegram(message.from.first_name, 64),
    last_name: cleanTelegram(message.from.last_name, 64),
    created_at: now,
    expires_at: now + SESSION_TTL_SECONDS * 1000,
    channel_member: false,
    membership_checked_at: 0,
  };
  const checked = await fetchMembership(env, telegramId);
  if (checked.ok) {
    session.channel_member = checked.member;
    session.membership_checked_at = now;
  }
  await env.ORDERS.put(
    `telegram:session:${await sha256(accessToken)}`,
    JSON.stringify(session),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
  await env.ORDERS.put(
    key,
    JSON.stringify({ ...login, ...session, status: "verified", access_token: accessToken }),
    { expirationTtl: LOGIN_TTL_SECONDS },
  );
  await sendWelcome(env, telegramId, session.channel_member);
  return json({ received: true });
}

async function checkMembership(env, session, { force = false } = {}) {
  const fresh = Date.now() - Number(session.membership_checked_at || 0) < MEMBERSHIP_CACHE_MS;
  if (!force && fresh) return { ok: true, member: Boolean(session.channel_member), session };
  const result = await fetchMembership(env, Number(session.telegram_id));
  if (!result.ok) return { ok: false, error: result.error, status: 502 };
  const updated = {
    ...session,
    channel_member: result.member,
    membership_checked_at: Date.now(),
  };
  delete updated._key;
  await env.ORDERS.put(session._key, JSON.stringify(updated), { expirationTtl: SESSION_TTL_SECONDS });
  updated._key = session._key;
  return { ok: true, member: result.member, session: updated };
}

async function fetchMembership(env, telegramId) {
  const response = await telegramApi(env, "getChatMember", {
    chat_id: channelId(env.TELEGRAM_REQUIRED_CHANNEL),
    user_id: telegramId,
  });
  if (!response.ok) return { ok: false, error: "TELEGRAM_MEMBERSHIP_CHECK_FAILED" };
  return { ok: true, member: acceptedMemberStatus(response.result) };
}

async function sendWelcome(env, telegramId, member) {
  const channel = channelUrl(env, channelId(env.TELEGRAM_REQUIRED_CHANNEL));
  const text = member
    ? "ورود شما به Venzo VPN تأیید شد. به برنامه برگردید."
    : "ورود شما تأیید شد. برای استفاده از VPN رایگان ابتدا عضو کانال Venzo شوید و سپس در برنامه «بررسی عضویت» را بزنید.";
  try {
    await telegramApi(env, "sendMessage", {
      chat_id: telegramId,
      text,
      reply_markup: channel ? { inline_keyboard: [[{ text: "عضویت در کانال Venzo", url: channel }]] } : undefined,
    });
  } catch {
    // Login remains valid if an informational bot reply fails.
  }
}

async function telegramApi(env, method, payload) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token(env.TELEGRAM_BOT_TOKEN, 20)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    return response.ok && body?.ok ? { ok: true, result: body.result } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function publicUser(session) {
  return {
    telegram_id: String(session.telegram_id),
    username: session.username || null,
    first_name: session.first_name || null,
    last_name: session.last_name || null,
  };
}

function channelUrl(env, channel) {
  const configured = String(env.TELEGRAM_CHANNEL_URL || "").trim();
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{4,}$/.test(configured)) return configured;
  return /^@[A-Za-z0-9_]{4,}$/.test(channel) ? `https://t.me/${channel.slice(1)}` : null;
}

function botUsername(value) {
  const result = String(value || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(result) ? result : "";
}

function channelId(value) {
  const result = String(value || "").trim();
  return /^@[A-Za-z0-9_]{4,}$/.test(result) || /^-100\d{6,}$/.test(result) ? result : "";
}

function ownerId(value) {
  const result = String(value || "").trim();
  return /^\d{5,20}$/.test(result) ? result : "";
}

function token(value, minimum) {
  const result = String(value || "").trim();
  return result.length >= minimum ? result : "";
}

function cleanTelegram(value, max) {
  return String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);
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

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
