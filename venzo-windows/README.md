# Venzo VPN for Windows

Windows 10/11 x64 desktop client for Venzo VPN.

## User features

- One-click TUN/VPN connection.
- Subscription import and update.
- Automatic latency test after connection.
- Server list with ping and manual selection.
- Cyber Pulse graphite/red/cyan desktop layout with Persian navigation.
- Persistent Venzo account registration and subscription recovery.
- Native subscription store with AbanGateway as the only public payment method.
- Automatic payment status checks and subscription activation.
- Native update, discount, and news notifications every six hours.
- System tray, start with Windows and start minimized.
- Persian-first interface with English fallback.
- Venzo-only runtime identity and update channel.

## Reproducible build

The GitHub workflow clones the pinned upstream desktop source at `v1.4.2`, verifies the expected commit, applies `venzo-windows.patch`, installs the native Venzo shell, account, notifications, and store modules, replaces all application icons, builds the Windows executable, bundles the pinned VPN core and WinTun, and produces a portable ZIP, an Inno Setup installer, and a signed MSIX package. Release publishing is manual after the build artifact is verified.

Payment provider secrets remain in the Venzo Cloudflare Worker and are never embedded in the Windows executable.

Upstream source and license information are recorded in `upstream.txt` and `THIRD_PARTY_NOTICES.md`.

## Support

- Support: `@Venzzo_vpn`
- Channel: https://t.me/venzo_vpn
