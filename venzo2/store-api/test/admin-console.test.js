import test from "node:test";
import assert from "node:assert/strict";

import {
  adminConsoleRouter,
  readManagedConfigLines,
} from "../src/admin-console.js";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

test("managed catalog returns only enabled configuration groups", async () => {
  const kv = new MemoryKv();
  await kv.put("configs:managed:v1", JSON.stringify({
    groups: [
      { enabled: true, configs: ["vless://first", "trojan://second"] },
      { enabled: false, configs: ["vmess://disabled"] },
    ],
  }));
  assert.deepEqual(await readManagedConfigLines({ ORDERS: kv }), [
    "vless://first",
    "trojan://second",
  ]);
});

test("app-open telemetry stores an anonymous installation record", async () => {
  const kv = new MemoryKv();
  const response = await adminConsoleRouter(new Request(
    "https://example.com/v1/telemetry/app-open",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id: "0123456789abcdef0123456789abcdef",
        platform: "android",
        app_version: "2.9.0",
        build_number: "20900000",
        locale: "fa-IR",
      }),
    },
  ), { ORDERS: kv });
  assert.equal(response.status, 202);
  const visitor = await kv.get(
    "analytics:visitor:0123456789abcdef0123456789abcdef",
    "json",
  );
  assert.equal(visitor.display_id, "VZ-01234567");
  assert.equal(visitor.open_count, 1);
  assert.equal(visitor.app_version, "2.9.0");
  assert.equal("ip" in visitor, false);
});

test("admin data routes fail closed without a valid session", async () => {
  const response = await adminConsoleRouter(
    new Request("https://example.com/v1/internal/admin/summary"),
    { ORDERS: new MemoryKv(), PROVISION_SECRET: "correct-horse-secret" },
  );
  assert.equal(response.status, 401);
});
