import test from "node:test";
import assert from "node:assert/strict";

import { publicPaymentMethods } from "../src/aban.js";

test("public checkout exposes only Aban when configured", () => {
  assert.deepEqual(publicPaymentMethods({ ABAN_API_TOKEN: "configured-token" }), ["aban"]);
});

test("no payment method is exposed when Aban is not configured", () => {
  assert.deepEqual(publicPaymentMethods({}), []);
});
