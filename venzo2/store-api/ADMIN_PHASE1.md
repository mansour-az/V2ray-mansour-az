# Venzo admin phase one — deployment gate

Experimental branch, not an already deployed service. The panel stays at
`/admin` on the existing Worker, separate from the Android UI. Privileged data
routes enforce server-side owner authentication; hiding a URL is not security.

## Owner setup before production

Set both repository Actions secrets. Never commit or send their values:

- `ADMIN_LOGIN_SECRET`: unique random password, at least 32 characters,
  different from `PROVISION_SECRET`. Keep it in a password manager.
- `ADMIN_TOTP_SECRET`: cryptographically random Base32 secret, 32–128 uppercase
  characters A–Z and 2–7, no spaces/padding. Add the SAME secret manually to
  your authenticator: SHA1, 6 digits, 30-second interval. Store an offline
  recovery copy. Never use the RFC test vector secret in production.

No QR enrollment secret appears in the web panel. Lost authenticator recovery
requires rotating the deployment secret using the owner's GitHub/Cloudflare
access. There is no password-only bypass. Changing either secret invalidates
owner sessions. The deploy workflow validates these settings and creates
`ADMIN_STATE` with SQLite DO migration `v2-admin-state`; the existing payment
`AccountLedger` binding and migration are preserved.

Login uses HTTPS, same-origin writes, secure HttpOnly Strict cookie (4 hours),
TOTP replay guard, rate limiting and epoch-based revoke-all. Old admin cookies
and provision bearer keys cannot access the panel. Merge/deploy only after
secrets are configured, CI passes and production deployment is authorized.

## Configurations

First access migrates `configs:managed:v1` into the owner Durable Object.
Legacy KV is untouched as a pre-upgrade backup. Groups support enable/disable,
expiry and normal/MASQUE/WARP/WireGuard classification. WARP requires actual
WireGuard credentials; this panel does not create Cloudflare accounts.

Limits: 40 groups, 500 configs, 100KB normalized group JSON, 20 revisions.
Oversized legacy data fails explicitly, without truncation. Preview detects
URL-format errors and duplicate URIs (ignoring fragments); it is NOT a full
protocol validator or end-to-end connectivity test. Publication checks a
preview fingerprint and base revision. Restore produces a new revision.

Automatic source catalogue is visible read-only and stays separate from
manual groups; the existing combined public catalogue cap is unchanged.
`/v1/connection-policy` contains only version, revision, enabled flag and a
four-transport order. Normal is always first. Android validates/cache-falls
back after a two-second request timeout. Disabling fallback affects automatic
candidate selection, not manual selection or an existing tunnel. Reserved
probe slots prevent normal subscriptions from starving available alternatives.

## Quality and privacy

New Android reporting is OFF by default; opt in through Privacy. No request
or new install identifier is created before consent. Withdrawal removes the
local identifier and stops future sends; an in-flight request may complete.
There is no persistent queue or retry loop. Reporting cannot block VPN use.

Each report covers one automatic/manual VERIFICATION PASS after core startup,
not every Connect tap or low-level probe. Native core startup failures are
excluded. Success means the existing HTTP/IP verifier passed. Duration is
verification-pass time, capped at ten minutes. Transport means the final
attempted/successful transport, not all transports tested during the pass.

Allowlist: random install/event IDs, app version, outcome, transport enum,
duration and bounded error enum. No raw IP, node tag, config, destination,
phone, Telegram identity, packets or exception text in analytics storage.
Network infrastructure necessarily sees request IPs; this is not a blanket
claim about Cloudflare's infrastructure logs. Abuse limiting uses a daily
salted IP digest. Transactions prevent lost increments; event IDs deduplicate.
Reports are unauthenticated estimates, not device-attested or billing data.

Dashboard: last 30 UTC days. Daily aggregates expire at 32 days plus alarm
processing delay; event IDs and per-install/day dedup expire at 31 days plus
processing delay. Audit retains latest 200 owner operations. Historical KV
visitors keep their existing TTLs and remain available separately, never
merged into new quality stats. Install IDs identify installations, not people.

## Announcements

Existing rows populate the editor until first publication. Up to 20 messages,
with title/body, HTTPS action, enable flag and schedule. Local date inputs
convert to epoch milliseconds; filtering is server-side. Existing Android
periodic polling stays compatible: delivery is not instant push. Editing a
previously consumed ID may not notify again; create a new message for that.
Old provision-key writes return `409 USE_ADMIN_ANNOUNCEMENT_CENTER` to prevent
competing stores.

## Verification and rollout

1. Run `npm run check` and `npm test`; the unit storage harness is serialized
   in memory, not a live Cloudflare deployment.
2. Android CI applies `venzo-admin-phase1.patch` last; runs Flutter analysis,
   existing Venzo tests and `venzo_phase1_test.dart`; builds signed arm64/v7.
3. Configure secrets and authenticator, then authorize production deployment.
4. After deployment test login, old-session rejection, config preview/publish/
   restore, schedules and revoke-all on the real Worker.
5. Test Android opt-in/off, a real verification report and fallback policy on
   an actual device/carrier before publishing the APK as the public update.

Compile/unit success does not establish VPN connectivity on a user's carrier.
