# Venzo VPN 2.10.0

- Smart Connect now uses a deterministic connection ladder.
- Normal Venzo servers are verified first.
- MASQUE over HTTP/3 is tried as the first escape transport.
- Cloudflare WARP and generic WireGuard are tried after MASQUE.
- Emergency transports from nested active-selector groups are included automatically.
- The connection panel shows the current fallback stage and verification progress.
- A route is still accepted only after real HTTP traffic and the system VPN route are verified.

This release candidate does not publish automatically. It must pass Flutter analysis, unit tests, APK/AAB builds, and Android signing verification before release.
