# Venzo VPN for Windows 1.0.0 — Product Specification

## Goal

Deliver a Windows 10/11 desktop client branded entirely as Venzo VPN, using the proven sing-box desktop runtime while keeping all visible product identity, support links, and application updates under the Venzo GitHub repository.

## Version 1 scope

- Windows 10/11 x64 executable and installer.
- Venzo red visual theme and supplied shield logo.
- Persian as the first-run language, with English fallback.
- TUN/VPN mode and system-proxy mode through sing-box.
- Subscription import/update, node list, latency testing, automatic ping after connect, and manual server selection.
- System tray controls, launch at startup, and start minimized.
- Update checks only against `mansour-az/V2ray-mansour-az` Venzo releases.
- Support: `@Venzzo_vpn`; channel: `https://t.me/venzo_vpn`.
- No runtime notification, visible URL, window title, application identifier, executable name, or User-Agent branded LxBox/singbox-launcher.

## Compatibility and legal constraints

- Pin desktop upstream to `Leadaxe/singbox-launcher` tag `v1.4.2` for reproducible builds.
- Preserve GPL-3.0 license and upstream attribution in source distributions and legal notices.
- Keep the Go module path unchanged internally to reduce regression risk; it is not user-visible.
- The sing-box core and WinTun remain replaceable runtime components.

## Deferred to version 1.1+

- PasarGuard account/store pages, wallet balance, renewal and payment flows shared with Android.
- Full RTL layout primitives (version 1 uses Persian strings in Fyne's current layout system).
- Signed installer and Microsoft Store packaging (require a code-signing identity/account).

## Acceptance criteria

1. The main window and Windows metadata show `Venzo VPN`.
2. App update actions open only the Venzo GitHub release page.
3. Help shows only Venzo support/channel/repository destinations.
4. The default subscription User-Agent starts with `VenzoVPN/`.
5. The primary UI color is Venzo red.
6. The app can import a subscription, update it, start TUN, ping nodes, and switch the selected node.
7. CI creates `Venzo-VPN.exe`, a portable ZIP, and `Venzo-VPN-Setup-<version>.exe`.

