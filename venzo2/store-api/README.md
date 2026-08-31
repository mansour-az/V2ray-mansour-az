# Venzo Store API Worker

This Worker exposes public plans, authenticated orders, AbanGateway invoices,
managed VPN configuration delivery, privacy-minimized app-open statistics,
and idempotent PasarGuard provisioning after payment.

## Routes

- `GET /health`
- `GET /v1/plans`
- `GET /v1/announcements`
- `GET /v1/free/subscription`
- `GET /admin` (standalone owner console)
- `POST /v1/internal/admin/login`
- `GET /v1/internal/admin/summary`
- `GET /v1/internal/admin/visitors`
- `GET|POST /v1/internal/admin/configs`
- `PUT|DELETE /v1/internal/admin/configs/{id}`
- `POST /v1/telemetry/app-open`
- `PUT /v1/internal/announcements` (server-to-server only)
- `POST /v1/orders`
- `GET /v1/orders/{id}`
- `POST /v1/orders/{id}/card-receipt`
- `POST /v1/internal/card-orders/{id}/approve`
- `POST /v1/internal/provision` (server-to-server only)

The only enabled external payment method is `aban`. The response contains
a one-time `client_secret`; clients must send it as `Authorization: Bearer ...`
when reading the order or submitting a card receipt. Crypto orders use a unique
six-decimal amount and are fulfilled only after a confirmed on-chain match.

Provision request:

```json
{
  "order_id": "paid-order-123",
  "plan_id": "1m-20gb",
  "customer": "@customer"
}
```

The caller must send `Authorization: Bearer <PROVISION_SECRET>`. A deterministic
PasarGuard username makes retrying the same order idempotent.

## Cloudflare configuration

Bind a Workers KV namespace as `ORDERS`. Set `PASARGUARD_GROUP_IDS` to a
comma-separated list such as `1,2`, and set `USDT_TRC20_CONTRACT` to the
verified mainnet contract used by the receiving wallet. Configure the
following encrypted Worker secrets:

```text
PASARGUARD_BASE_URL=https://panel.example.com
PASARGUARD_API_KEY=pg_key_... (preferred)
PASARGUARD_ADMIN_USERNAME=... (fallback when no API key exists)
PASARGUARD_ADMIN_PASSWORD=... (fallback when no API key exists)
PROVISION_SECRET=<at least 32 random characters>
TRON_WALLET_ADDRESS=...
TRONGRID_API_KEY=...
USDT_IRR=...
TRX_IRR=...
CARD_NUMBER=...
CARD_HOLDER=...
SWAPPAY_API_KEY=...
SWAPPAY_USERNAME=...
OXAPAY_MERCHANT_API_KEY=...
ABAN_API_TOKEN=live_... (or test_... for sandbox testing)
ABAN_WEBHOOK_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_BOT_USERNAME=VenzoLoginBot
TELEGRAM_REQUIRED_CHANNEL=@Venzzo_vpn
TELEGRAM_OWNER_ID=<numeric Telegram user id>
```

Optional hosted-payment settings are `SWAPPAY_API_BASE` (defaults to
`https://swapwallet.app/api`), `SWAPPAY_AUTO_CONVERSION_TOKEN`, and
`PAYMENT_RETURN_URL`. `USD_IRR` is an optional emergency rate override; by
default the Worker caches the live USDT/IRR market rate. Announcements can be
updated through the protected internal endpoint and are polled by Android in
the background. The Android app receives only public announcement content and hosted checkout URLs;
provider API keys stay in encrypted Worker secrets.

Never commit `.dev.vars`, API keys, panel credentials, Telegram credentials,
or Google service-account files. Prefer a scoped `pg_key_...` API key
instead of the PasarGuard administrator password.

The management console uses `PROVISION_SECRET` only to create a short-lived,
HttpOnly and SameSite=Strict administrator session. Regular clients can receive
the aggregated subscription but never receive upstream source URLs. App-open
statistics use a random per-installation identifier; raw IP addresses, IMEI,
phone numbers, browsing history and VPN destinations are not stored.

After deployment, set the GitHub repository variable `VENZO_API_BASE` to the
Worker HTTPS origin for GitHub APK builds. The Play build keeps the external
checkout hidden until Google Play Billing is complete.

## GitHub Actions deployment

The manual `Deploy Venzo Store API` workflow deploys the Worker and
automatically provisions the `ORDERS` KV binding. Add these repository secrets
before running it:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
PASARGUARD_BASE_URL
PASARGUARD_API_KEY
PROVISION_SECRET
ABAN_API_TOKEN
ABAN_WEBHOOK_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_BOT_USERNAME
TELEGRAM_REQUIRED_CHANNEL
TELEGRAM_OWNER_ID
```

Add `PASARGUARD_GROUP_IDS` and `USDT_TRC20_CONTRACT` as repository variables.
Do not paste payment details or API credentials into issues, workflow inputs,
commits, or build logs.
