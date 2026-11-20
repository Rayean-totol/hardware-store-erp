# Android app (Capacitor) — planned for Phase 7

Not scaffolded yet. The plan:

* Wrap the static export from `apps/web/out` (`webDir`) with Capacitor 7+.
* Local store: `@capacitor-community/sqlite` behind the `@erp/data` repository interfaces (Phase 2 design).
* Hardware: barcode scanning (camera via ML Kit, or HID scanners as keyboard input), Bluetooth/USB
  ESC/POS receipt printers.
* ZATCA: per-device EGS key pair generated and stored in the Android Keystore. The private
  key never leaves the device (see `docs/zatca.md`).
* Distribution: Play Store internal track, then managed devices.
