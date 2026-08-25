# Venzo VPN for Windows 2.6.0 — Product Specification

## Goal

Deliver a Windows 10/11 desktop client branded entirely as Venzo VPN, using the proven sing-box desktop runtime while keeping all visible product identity, support links, and application updates under the Venzo GitHub repository.

## Version 2.6.0 scope

- Windows 10/11 x64 executable and installer.
- Calm navy/cyan visual theme derived from the supplied Persian security guide.
- Persian as the first-run language, with English fallback.
- TUN/VPN mode and system-proxy mode through sing-box.
- Subscription import/update, node list, latency testing, automatic ping after connect, and manual server selection.
- Single-focus desktop shell with top navigation and one primary connection action.
- One-click smart connection that tries several low-latency servers and only reports success after an end-to-end public-IP check.
- Dedicated privacy page covering DNS protection, WebRTC testing and browser fingerprint guidance without claiming control over browser settings.
- Native store with Swap Wallet (SwapPay) and OxaPay hosted invoices.
- Automatic payment polling and secure subscription activation after fulfillment.
- System tray controls, launch at startup, and start minimized.
- Update checks only against `mansour-az/V2ray-mansour-az` Venzo releases.
- Support: `@Venzzo_vpn`; channel: `https://t.me/venzo_vpn`.
- No runtime notification, visible URL, window title, application identifier, executable name, or User-Agent branded LxBox/singbox-launcher.

## Compatibility and legal constraints

- Pin desktop upstream to `Leadaxe/singbox-launcher` tag `v1.4.2` for reproducible builds.
- Preserve GPL-3.0 license and upstream attribution in source distributions and legal notices.
- Keep the Go module path unchanged internally to reduce regression risk; it is not user-visible.
- The sing-box core and WinTun remain replaceable runtime components.

## Deferred

- Wallet balance, account history and renewal management shared with Android.
- Full RTL layout primitives (Persian content uses Fyne's current trailing alignment support).
- Signed installer and Microsoft Store packaging (require a code-signing identity/account).

## Acceptance criteria

1. The main window and Windows metadata show `Venzo VPN`.
2. App update actions open only the Venzo GitHub release page.
3. Help shows only Venzo support/channel/repository destinations.
4. The default subscription User-Agent starts with `VenzoVPN/`.
5. The primary UI color is cyan on a dark navy surface with large Persian labels and low visual density.
6. The app can import a subscription, update it, start TUN, ping nodes, switch the selected node, and reject nodes that have latency but no working internet route.
7. CI creates `Venzo-VPN.exe`, a portable ZIP, and `Venzo-VPN-Setup-<version>.exe`.
8. SwapPay and OxaPay invoices are created server-side without provider secrets in the binary.
9. A fulfilled order adds its subscription to the local Venzo state and refreshes the core configuration.
10. The UI never labels a connection as successful solely because the sing-box process is running or a node returns a Ping value.
