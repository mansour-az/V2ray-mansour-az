# V2Ray Manager for Android

A modern, high-performance Android application built with **Kotlin** and **Jetpack Compose** for managing V2Ray, Xray, VMess, VLESS, and Trojan proxy configurations, latency diagnostics, client exports, and cloud PaaS server generation.

## Features

- **Live Connection Telemetry & Dashboard**:
  - Encrypted tunnel state management with connection pulse indicators.
  - Live upload/download rate telemetry and session bandwidth tracking.
  - Quick active node switching and instant real-time latency ping diagnostics.

- **V2Ray & Xray Node Management**:
  - Supports **VMess**, **VLESS**, and **Trojan** protocols with WebSocket / TCP / gRPC transport and TLS modes.
  - Parse and import standard share links (`vmess://`, `vless://`, `trojan://`) or multi-line subscription text.
  - Visual latency indicator with millisecond accuracy (TCP handshake testing).
  - Node builder dialog with automated UUID v4 generator.
  - Local database persistence powered by **Room**.

- **Config Generator & Cloud Deployment**:
  - Generates ready-to-use client `config.json` for V2RayN, V2RayNG, and Xray core.
  - Generates cloud PaaS server deployment scripts (Doprax, Docker, Nginx reverse proxy, and entrypoint setups).
  - UUID v4 generator with instant batch generation and clipboard copy.
  - Node URI link sharing.

- **Network Diagnostics & Tools**:
  - Global gateway and DNS latency benchmarking tool (Cloudflare, Google DNS, Quad9, OpenDNS).
  - DNS resolution response speed tester.
  - Integrated TradingView UT Supertrend Overlay script utility.

## Tech Stack

- **UI Framework**: Jetpack Compose & Material Design 3
- **Language**: Kotlin 2.0+
- **Persistence**: Android Room with KSP
- **Asynchronous Flow**: Kotlin Coroutines & StateFlow
- **Architecture**: MVVM (Model-View-ViewModel) + Repository Pattern
