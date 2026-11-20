# Windows desktop app (Tauri) — planned for Phase 7

Not scaffolded yet. The plan:

* Tauri 2 shell loading `apps/web/out` as `frontendDist`.
* Local store: `tauri-plugin-sql` (SQLite) behind the `@erp/data` repository interfaces.
* Hardware: USB/serial ESC/POS printers, cash drawer kick through the printer, HID barcode scanners.
* ZATCA: EGS private key protected with Windows DPAPI.
* Auto-update via the Tauri updater with signed releases.
