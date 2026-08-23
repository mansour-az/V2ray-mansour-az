# Venzo VPN Windows — Local Debug API

Venzo VPN for Windows includes an optional local-only diagnostic API for troubleshooting and automation.

- The service listens on localhost only.
- Authentication uses an `Authorization: Bearer <token>` header.
- The current endpoint list is available from `GET /help`.
- The connection card in the app contains the local URL and token.
- Never publish or send the token to untrusted people.

Support: https://t.me/Venzzo_vpn  
Channel: https://t.me/venzo_vpn
