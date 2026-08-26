const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function appAuthorized(request, env) {
  const token = bearer(request);
  return Boolean(token && (token === env.VENZO_APP_TOKEN || token === env.VENZO_ADMIN_TOKEN));
}

function adminAuthorized(request, env) {
  const token = bearer(request);
  return Boolean(token && token === env.VENZO_ADMIN_TOKEN);
}

function normalizeBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function pgFetch(env, path, init = {}) {
  if (!env.PASARGUARD_BASE_URL) throw new Error("PASARGUARD_BASE_URL is not configured");
  if (!env.PASARGUARD_TOKEN) throw new Error("PASARGUARD_TOKEN is not configured");

  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${env.PASARGUARD_TOKEN}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  return fetch(`${normalizeBase(env.PASARGUARD_BASE_URL)}${path}`, {
    ...init,
    headers,
  });
}

async function forwardPasarGuard(response) {
  const text = await response.text();
  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(text, { status: response.status, headers });
}

function safeNodeQuery(url) {
  const q = new URLSearchParams();
  for (const key of ["page", "size", "status", "search", "sort", "descending"]) {
    if (url.searchParams.has(key)) q.set(key, url.searchParams.get(key));
  }
  const encoded = q.toString();
  return encoded ? `?${encoded}` : "";
}

async function subscriptionLinks(request, env) {
  if (!appAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

  const subscriptionToken = (request.headers.get("x-subscription-token") || "").trim();
  if (!subscriptionToken || !/^[A-Za-z0-9._~-]{8,256}$/.test(subscriptionToken)) {
    return json({ error: "invalid_subscription_token" }, 400);
  }

  const subPath = `/${String(env.PASARGUARD_SUB_PATH || "sub").replace(/^\/+|\/+$/g, "")}`;
  const upstream = `${normalizeBase(env.PASARGUARD_BASE_URL)}${subPath}/${encodeURIComponent(subscriptionToken)}/links`;
  const response = await fetch(upstream, {
    headers: {
      accept: "text/plain, application/json;q=0.9, */*;q=0.8",
      "user-agent": "VenzoVPN/3.0",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return json({ error: "subscription_fetch_failed", upstream_status: response.status }, 502);
  }

  const raw = await response.text();
  const links = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(vmess|vless|trojan|ss):\/\//i.test(line));

  return json({
    ok: true,
    count: links.length,
    links,
    fetched_at: new Date().toISOString(),
  }, 200, { "cache-control": "no-store" });
}

async function health(request, env) {
  const started = Date.now();
  try {
    const response = await pgFetch(env, "/api/nodes?size=1");
    return json({
      ok: response.ok,
      service: "venzo-api-v3",
      pasar_guard: response.ok ? "reachable" : "error",
      pasar_guard_status: response.status,
      latency_ms: Date.now() - started,
    }, response.ok ? 200 : 503, { "cache-control": "no-store" });
  } catch (error) {
    return json({
      ok: false,
      service: "venzo-api-v3",
      pasar_guard: "unreachable",
      error: error instanceof Error ? error.message : "unknown_error",
    }, 503, { "cache-control": "no-store" });
  }
}

async function adminNodes(request, env, url, segments) {
  if (!adminAuthorized(request, env)) return json({ error: "admin_unauthorized" }, 401);

  if (segments.length === 4 && request.method === "GET") {
    return forwardPasarGuard(await pgFetch(env, `/api/nodes${safeNodeQuery(url)}`));
  }

  if (segments.length === 4 && request.method === "POST") {
    return forwardPasarGuard(await pgFetch(env, "/api/node", {
      method: "POST",
      body: await request.text(),
    }));
  }

  const id = segments[4];
  if (!id || !/^\d+$/.test(id)) return json({ error: "invalid_node_id" }, 400);

  if (segments.length === 5 && request.method === "GET") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}`));
  }
  if (segments.length === 5 && request.method === "PUT") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}`, {
      method: "PUT",
      body: await request.text(),
    }));
  }
  if (segments.length === 5 && request.method === "DELETE") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}`, { method: "DELETE" }));
  }
  if (segments.length === 6 && segments[5] === "stats" && request.method === "GET") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}/realtime_stats`));
  }
  if (segments.length === 6 && segments[5] === "reconnect" && request.method === "POST") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}/reconnect`, { method: "POST" }));
  }
  if (segments.length === 6 && segments[5] === "sync" && request.method === "PUT") {
    return forwardPasarGuard(await pgFetch(env, `/api/node/${id}/sync`, { method: "PUT" }));
  }

  return json({ error: "node_route_not_found" }, 404);
}

async function adminUsers(request, env, segments) {
  if (!adminAuthorized(request, env)) return json({ error: "admin_unauthorized" }, 401);

  if (segments.length === 4 && request.method === "POST") {
    return forwardPasarGuard(await pgFetch(env, "/api/user", {
      method: "POST",
      body: await request.text(),
    }));
  }

  const id = segments[4];
  if (!id || !/^\d+$/.test(id)) return json({ error: "invalid_user_id" }, 400);

  if (segments.length === 5 && request.method === "GET") {
    return forwardPasarGuard(await pgFetch(env, `/api/user/by-id/${id}`));
  }
  if (segments.length === 5 && request.method === "PUT") {
    return forwardPasarGuard(await pgFetch(env, `/api/user/by-id/${id}`, {
      method: "PUT",
      body: await request.text(),
    }));
  }
  if (segments.length === 5 && request.method === "DELETE") {
    return forwardPasarGuard(await pgFetch(env, `/api/user/by-id/${id}`, { method: "DELETE" }));
  }

  return json({ error: "user_route_not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      if (url.pathname === "/api/v3/health" && request.method === "GET") return health(request, env);
      if (url.pathname === "/api/v3/subscription/links" && request.method === "GET") {
        return subscriptionLinks(request, env);
      }
      if (segments.slice(0, 4).join("/") === "api/v3/admin/nodes") {
        return adminNodes(request, env, url, segments);
      }
      if (segments.slice(0, 4).join("/") === "api/v3/admin/users") {
        return adminUsers(request, env, segments);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({
        error: "internal_error",
        message: error instanceof Error ? error.message : "unknown_error",
      }, 500);
    }
  },
};
