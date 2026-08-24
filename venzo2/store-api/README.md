# Venzo Store API Worker

This Worker exposes public plans, authenticated orders, automatic TRX and
USDT-TRC20 verification through TronGrid, hosted SwapPay and OxaPay invoices,
manual card-to-card review, and idempotent PasarGuard provisioning after
payment.

## Routes

- `GET /health`
- `GET /v1/plans`
- `POST /v1/orders`
- `GET /v1/orders/{id}`
- `POST /v1/orders/{id}/card-receipt`
- `POST /v1/internal/card-orders/{id}/approve`
- `POST /v1/internal/provision` (server-to-server only)

Create-order methods include `trx`, `card`, `swappay`, and `oxapay`. The response contains
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
USD_IRR=... # IRR value of one USD, used to create USD invoices
```

Optional hosted-payment settings are `SWAPPAY_API_BASE` (defaults to
`https://swapwallet.app/api`), `SWAPPAY_AUTO_CONVERSION_TOKEN`, and
`PAYMENT_RETURN_URL`. The Android app receives only the hosted checkout URL;
provider API keys stay in encrypted Worker secrets.

Never commit `.dev.vars`, API keys, panel credentials, wallet details, card
details, or Google service-account files. Prefer a scoped `pg_key_...` API key
instead of the PasarGuard administrator password.

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
TRON_WALLET_ADDRESS
TRONGRID_API_KEY
USDT_IRR
TRX_IRR
CARD_NUMBER
CARD_HOLDER
SWAPPAY_API_KEY
SWAPPAY_USERNAME
OXAPAY_MERCHANT_API_KEY
USD_IRR
```

Add `PASARGUARD_GROUP_IDS` and `USDT_TRC20_CONTRACT` as repository variables.
Do not paste payment details or API credentials into issues, workflow inputs,
commits, or build logs.
