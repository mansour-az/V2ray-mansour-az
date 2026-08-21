# Venzo Store API Worker

This Worker exposes public plan data and a private, idempotent PasarGuard
provisioning endpoint. It does not accept or verify payments yet. `/v1/orders`
intentionally returns `CHECKOUT_NOT_CONFIGURED` until a payment provider or
Google Play purchase-token verifier is implemented.

## Routes

- `GET /health`
- `GET /v1/plans`
- `POST /v1/orders` (disabled safely)
- `POST /v1/internal/provision` (server-to-server only)

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

Set the non-secret `PASARGUARD_GROUP_IDS` variable to a comma-separated list,
for example `1,2`. Then configure these as encrypted Worker secrets:

```text
PASARGUARD_BASE_URL=https://panel.example.com
PASARGUARD_API_KEY=pg_key_...
PROVISION_SECRET=<at least 32 random characters>
```

Never commit `.dev.vars`, API keys, panel credentials, payment credentials or
Google service-account files. The preferred PasarGuard credential is a scoped
`pg_key_...` API key sent as `X-API-Key`, not an admin password.

After deployment, set the GitHub repository variable `VENZO_API_BASE` to the
Worker HTTPS origin for GitHub APK builds. The Play build keeps the external
checkout hidden until Google Play Billing is complete.
