import test from "node:test";
import assert from "node:assert/strict";

import { acceptedMemberStatus, telegramConfigured } from "../src/telegram-auth.js";

test("Telegram membership accepts only active channel members", () => {
  assert.equal(acceptedMemberStatus({ status: "creator" }), true);
  assert.equal(acceptedMemberStatus({ status: "administrator" }), true);
  assert.equal(acceptedMemberStatus({ status: "member" }), true);
  assert.equal(acceptedMemberStatus({ status: "restricted", is_member: true }), true);
  assert.equal(acceptedMemberStatus({ status: "restricted", is_member: false }), false);
  assert.equal(acceptedMemberStatus({ status: "left" }), false);
  assert.equal(acceptedMemberStatus({ status: "kicked" }), false);
});

test("Telegram gate is fail-closed until every server binding exists", () => {
  const complete = {
    ORDERS: {},
    TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz123456",
    TELEGRAM_WEBHOOK_SECRET: "webhook_secret_123",
    TELEGRAM_BOT_USERNAME: "VenzoLoginBot",
    TELEGRAM_REQUIRED_CHANNEL: "@Venzzo_vpn",
    TELEGRAM_OWNER_ID: "123456789",
  };
  assert.equal(telegramConfigured(complete), true);
  assert.equal(telegramConfigured({ ...complete, TELEGRAM_OWNER_ID: "" }), false);
  assert.equal(telegramConfigured({ ...complete, TELEGRAM_BOT_TOKEN: "" }), false);
});
