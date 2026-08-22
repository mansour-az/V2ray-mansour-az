const CATALOG_KEY = "free:catalog:v2";
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 10_000;
const MAX_SOURCE_BYTES = 2_500_000;
const MAX_CONFIGS_PER_SOURCE = 350;
const MAX_CONFIGS = 1_000;
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

const CURATED_SOURCES = [
  {
    id: "radikal-top100",
    name: "Radikal Top 100",
    repository: "0xRadikal/Free-v2ray-Configs",
    url: "https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/top100.txt",
    discovered: false,
  },
  {
    id: "freedom-v2ray-vless",
    name: "Freedom V2Ray",
    repository: "MahanKenway/Freedom-V2Ray",
    url: "https://raw.githubusercontent.com/MahanKenway/Freedom-V2Ray/main/configs/vless_sub.txt",
    discovered: false,
  },
];

export async function freeSubscriptionResponse(env, ctx) {
  let catalog = await readCatalog(env);
  if (!catalog) catalog = await refreshFreeCatalog(env, { discover: false });
  if (!catalog || !Array.isArray(catalog.configs) || catalog.configs.length === 0) {
    return json({ error: "FREE_CATALOG_UNAVAILABLE" }, 503, noStoreHeaders());
  }
  if (Date.now() - Number(catalog.updated_at || 0) > REFRESH_INTERVAL_MS) {
    ctx.waitUntil(refreshFreeCatalog(env, { discover: true }));
  }
  const encoded = bytesToBase64(
    new TextEncoder().encode(`${catalog.configs.join("\n")}\n`),
  );
  return new Response(encoded, {
    status: 200,
    headers: {
      ...publicHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Profile-Update-Interval": "4",
      "X-Venzo-Config-Count": String(catalog.configs.length),
      "X-Venzo-Catalog-Updated-At": String(catalog.updated_at),
    },
  });
}

export async function freeSourcesResponse(env, ctx) {
  let catalog = await readCatalog(env);
  if (!catalog) catalog = await refreshFreeCatalog(env, { discover: false });
  if (catalog && Date.now() - Number(catalog.updated_at || 0) > REFRESH_INTERVAL_MS) {
    ctx.waitUntil(refreshFreeCatalog(env, { discover: true }));
  }
  return json(
    {
      updated_at: Number(catalog?.updated_at || 0),
      config_count: Array.isArray(catalog?.configs) ? catalog.configs.length : 0,
      sources: Array.isArray(catalog?.sources) ? catalog.sources : [],
      refresh_interval_hours: 4,
    },
    200,
    publicHeaders(),
  );
}

export async function refreshFreeCatalog(env, { discover = true } = {}) {
  if (!env.ORDERS) return null;
  const previous = await readCatalog(env);
  let sources = [...CURATED_SOURCES];
  if (discover) {
    try {
      const discovered = await discoverGithubSources(env);
      sources = uniqueSources([...sources, ...discovered]);
    } catch (error) {
      console.warn(JSON.stringify({ event: "free_catalog_discovery_failed", error: message(error) }));
      if (Array.isArray(previous?.candidate_sources)) {
        sources = uniqueSources([...sources, ...previous.candidate_sources]);
      }
    }
  } else if (Array.isArray(previous?.candidate_sources)) {
    sources = uniqueSources([...sources, ...previous.candidate_sources]);
  }

  const results = await Promise.allSettled(sources.slice(0, 10).map(fetchSource));
  const seen = new Set();
  const configs = [];
  const sourceStats = [];
  const healthyCandidates = [];
  for (let index = 0; index < results.length; index += 1) {
    const source = sources[index];
    const result = results[index];
    if (result.status !== "fulfilled" || !result.value.ok) {
      sourceStats.push({
        id: source.id,
        name: source.name,
        repository: source.repository,
        discovered: Boolean(source.discovered),
        healthy: false,
        config_count: 0,
      });
      continue;
    }
    let accepted = 0;
    for (const config of result.value.configs) {
      const key = dedupeKey(config);
      if (seen.has(key) || configs.length >= MAX_CONFIGS) continue;
      seen.add(key);
      configs.push(config);
      accepted += 1;
    }
    sourceStats.push({
      id: source.id,
      name: source.name,
      repository: source.repository,
      discovered: Boolean(source.discovered),
      healthy: accepted > 0,
      config_count: accepted,
    });
    if (source.discovered && accepted >= 5) healthyCandidates.push(source);
  }

  if (configs.length === 0 && Array.isArray(previous?.configs) && previous.configs.length > 0) {
    console.warn(JSON.stringify({ event: "free_catalog_refresh_kept_stale", count: previous.configs.length }));
    return previous;
  }
  const catalog = {
    version: 2,
    updated_at: Date.now(),
    configs,
    sources: sourceStats,
    candidate_sources: healthyCandidates.slice(0, 8),
  };
  await env.ORDERS.put(CATALOG_KEY, JSON.stringify(catalog));
  console.log(JSON.stringify({
    event: "free_catalog_refreshed",
    configs: configs.length,
    healthy_sources: sourceStats.filter((source) => source.healthy).length,
    discovered_sources: healthyCandidates.length,
  }));
  return catalog;
}

async function discoverGithubSources(env) {
  const since = new Date(Date.now() - 180 * 86400 * 1000).toISOString().slice(0, 10);
  const headers = githubHeaders(env);
  const query = encodeURIComponent(`v2ray free configs pushed:>${since}`);
  const response = await fetch(
    `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=10`,
    { headers, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`GITHUB_SEARCH_${response.status}`);
  const body = await response.json();
  const repositories = Array.isArray(body?.items) ? body.items : [];
  const selected = repositories
    .filter((repo) => !repo.archived && !repo.disabled && Number(repo.stargazers_count || 0) >= 10)
    .slice(0, 5);
  const discovered = [];
  for (const repo of selected) {
    const fullName = String(repo.full_name || "");
    const branch = String(repo.default_branch || "main");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) continue;
    const treeResponse = await fetch(
      `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) },
    );
    if (!treeResponse.ok) continue;
    const treeBody = await treeResponse.json();
    const paths = (Array.isArray(treeBody?.tree) ? treeBody.tree : [])
      .filter((entry) => entry.type === "blob" && isCandidatePath(entry.path, entry.size))
      .sort((a, b) => candidatePathScore(b.path) - candidatePathScore(a.path));
    if (paths.length === 0) continue;
    const path = String(paths[0].path);
    const rawPath = path.split("/").map(encodeURIComponent).join("/");
    discovered.push({
      id: `github-${String(repo.id)}`,
      name: String(repo.name || fullName).slice(0, 80),
      repository: fullName,
      url: `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(branch)}/${rawPath}`,
      discovered: true,
    });
  }
  return discovered;
}

async function fetchSource(source) {
  if (!allowedSourceUrl(source.url)) return { ok: false, configs: [] };
  try {
    const response = await fetch(source.url, {
      headers: { Accept: "text/plain,*/*;q=0.5", "User-Agent": "Venzo-Free-Catalog/2.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!response.ok || !allowedSourceUrl(response.url)) return { ok: false, configs: [] };
    const text = await boundedText(response, MAX_SOURCE_BYTES);
    const configs = extractConfigs(text).slice(0, MAX_CONFIGS_PER_SOURCE);
    return { ok: configs.length > 0, configs };
  } catch (error) {
    console.warn(JSON.stringify({ event: "free_source_failed", source: source.id, error: message(error) }));
    return { ok: false, configs: [] };
  }
}

async function boundedText(response, maxBytes) {
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > maxBytes) throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("SOURCE_TOO_LARGE");
      throw new Error("SOURCE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function extractConfigs(raw) {
  const direct = validConfigLines(raw);
  if (direct.length > 0) return direct;
  const compact = String(raw || "").replace(/\s+/g, "");
  if (compact.length < 16 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return [];
  try {
    const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return validConfigLines(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
}

function validConfigLines(value) {
  const output = [];
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 16 || line.length > 4096 || /[\u0000-\u001f\u007f]/.test(line)) continue;
    try {
      const parsed = new URL(line);
      if (!SUPPORTED_SCHEMES.has(parsed.protocol)) continue;
      output.push(line);
    } catch {
      // Ignore malformed or non-config lines.
    }
  }
  return output;
}

function isCandidatePath(path, size) {
  const value = String(path || "").toLowerCase();
  if (!Number.isFinite(Number(size)) || Number(size) < 64 || Number(size) > MAX_SOURCE_BYTES) return false;
  if (!/\.(txt|conf|list|base64)$/i.test(value)) return false;
  return /(sub|subscription|config|vless|vmess|trojan|proxy|nodes)/i.test(value);
}

function candidatePathScore(path) {
  const value = String(path || "").toLowerCase();
  let score = 0;
  if (value.includes("sub")) score += 5;
  if (value.includes("all")) score += 3;
  if (value.includes("mix")) score += 2;
  if (value.includes("base64")) score += 2;
  if (value.includes("config")) score += 1;
  return score;
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source?.id || !source?.url || seen.has(source.url) || !allowedSourceUrl(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function allowedSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ["raw.githubusercontent.com", "cdn.jsdelivr.net"].includes(url.hostname);
  } catch {
    return false;
  }
}

function githubHeaders(env) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Venzo-Free-Catalog/2.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = String(env.GITHUB_DISCOVERY_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function dedupeKey(config) {
  try {
    const url = new URL(config);
    url.hash = "";
    return url.toString();
  } catch {
    return config;
  }
}

async function readCatalog(env) {
  try {
    return await env.ORDERS.get(CATALOG_KEY, "json");
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function message(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 160);
}

function publicHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
  };
}

function noStoreHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
