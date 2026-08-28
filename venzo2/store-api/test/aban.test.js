import test from "node:test";
import assert from "node:assert/strict";

import { verifyAbanWebhook } from "../src/aban.js";

test("Aban webhook validates the exact raw request body", async () => {
  const body = '{"event":"invoice.paid","invoice_id":"inv_test"}';
  const secret = "venzo-test-webhook-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const signature = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  assert.equal(await verifyAbanWebhook(body, signature, secret), true);
  assert.equal(await verifyAbanWebhook(`${body} `, signature, secret), false);
  assert.equal(await verifyAbanWebhook(body, "invalid", secret), false);
});
