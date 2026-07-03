# Snapkit — Roadmap

Where "greatness" is parked so the MVP can **ship**. Nothing here is in the MVP.

## MVP milestones (in progress)

M0 Scaffold · M1 Capture · M2 Annotation editor · M3 Auto-redaction · M4 Export ·
M5 Preferences + UX polish · M6 Packaging + license stub.

See [README.md](./README.md) for current status.

## Post-MVP (parked)

- **Subject extraction / stickers** (iPhone-style): lift the subject from a
  capture and copy it alone with transparent background. Implementation note:
  `@imgly/background-removal` — ONNX segmentation running fully locally
  (fits the privacy-first stance, no cloud). UI: "Copy subject" next to
  Copy/Styled. Model is ~40-80MB → lazy-download on first use or optional
  component at install.
- Video / GIF recording
- Cloud upload + shareable links
- Sync across devices
- Scrolling / long-page capture
- Multi-language OCR
- Plugins / extensions
- Branded export templates
- Team version
- Per-OS designed tray & app icons (M0 ships a generated placeholder)

## Deferred technical debt / decisions

- **Tray icon**: M0 ships a generated monochrome placeholder (`scripts/make-tray-icon.mjs`).
  Replace with designed, per-OS icons (light/dark taskbar variants for Windows/Linux).
- **CSP in dev**: relaxed to allow Vite HMR; strict CSP is applied only in packaged builds.
