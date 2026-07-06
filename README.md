# Snapkit

**Developer-first, cross-platform screenshot & annotation tool** — capture, annotate, and
export screenshots, with **local auto-redaction** of secrets (emails, tokens, API keys, IPs)
so a screenshot is _safe to share_ with one click.

> Reference competitor: CleanShot X (macOS-only, paid). Our angle: **cross-platform +
> privacy-first + developer-first**, one-time affordable license.

Your screenshots **never leave your device**: OCR and redaction run entirely locally.

---

## Status — MVP feature-complete

- ✅ **M0 · Scaffold** — electron-vite + React 19 + TS strict + Tailwind v4 + shadcn, tray-resident
- ✅ **M1 · Capture** — global shortcut → frozen-frame area selection → editor. macOS/Wayland permission handling
- ✅ **M2 · Editor** — Konva canvas: arrow, rect, text, Paint-style highlighter, step markers, pixelate blur; serializable undo/redo (tested)
- ✅ **M3 · Auto-redaction** — local Tesseract OCR + 9 secret patterns (tested) + 1-click review
- ✅ **M4 · Export** — save PNG/JPG, clipboard copy, styled copy (padded gradient backdrop)
- ✅ **M5 · Preferences** — persisted prefs, configurable shortcut, dark/light/system theme, onboarding, keyboard a11y
- ✅ **M6 · Packaging + license stub** — electron-builder (3 OS), offline `LicenseValidator` (trial + stub key)
- ✅ **M7 · Capture modes** — full-screen (⌘⇧1) and window capture with picker (⌘⇧3), flash feedback, all three shortcuts configurable
- ✅ **Phase 2 (partial)** — subject extraction/stickers (local ONNX), multi-word secret detection, multilingual OCR (eng/ita/deu/fra/spa), simultaneous multi-display capture, styled-copy templates. Pending: scrolling capture.

> **Currently a free build**: the 14-day trial gate is disabled (license
> activation still works, it's just optional). Re-enable in
> `src/main/capture.ts → startCapture`.

Post-MVP plans: [ROADMAP.md](./ROADMAP.md)

## Requirements

- Node.js ≥ 20.19 (developed on Node 24) + npm
- If `npm run dev` fails with `Error: Electron uninstall`, the electron binary
  download was skipped during install — run `node node_modules/electron/install.js` once.

## Develop

```bash
npm install
npm run dev        # HMR; window + tray icon appear
```

| Script                    | What                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`       | tsc on main/preload/shared + renderer                              |
| `npm test`                | vitest — history, serialization, redaction patterns                |
| `npm run lint` / `format` | ESLint flat / Prettier                                             |
| `npm run build`           | production bundle into `out/`                                      |
| `npm run package`         | build + installer for the current OS into `dist/`                  |
| `npm run package:all`     | build + installers for macOS/Windows/Linux (see cross-build notes) |

## Architecture

Strict Electron process separation. `nodeIntegration` off, `contextIsolation` + `sandbox` on,
restrictive CSP in production, no remote code — everything runs client-side.

```
src/
  main/       window/tray/shortcuts, capture orchestration, export, prefs,
              license, app:// protocol (serves the renderer when packaged)
  preload/    contextBridge — typed api on window.api / window.overlayApi
  renderer/   React app: home, selection overlay, Konva editor, preferences
  shared/     typed IPC contract, redaction patterns, prefs/license models
resources/    tray icon (generated: scripts/make-tray-icon.mjs)
scripts/      setup-ocr.mjs (copies tesseract worker/core, prunes to LSTM variants)
```

Key decisions:

- **Typed IPC** — channels + payloads in `src/shared/ipc.ts`, no magic strings.
- **Capture-first flow** — the screen is grabbed _before_ the selection overlay opens,
  so selection is WYSIWYG on a frozen frame (and the overlay is never in the shot).
- **Serializable annotations** — plain JSON objects; undo/redo is a pure snapshot
  history module (`editor/history.ts`), unit-tested.
- **Local OCR** — tesseract.js worker/WASM/language data served from the app itself
  (no CDN). Packaged builds use a custom `app://` scheme so fetch/workers behave
  exactly like in dev (file:// would break them).
- **electron-store is bundled** (ESM-only package, main bundle is CJS).

## Packaging

```bash
npm run package         # installers for the OS you're on → dist/
npm run package:winmac  # .dmg (mac, host arch) + .exe (win x64) in one go
```

Outputs: dmg+zip (macOS, unsigned — `identity: null`), NSIS setup (Windows), AppImage+deb (Linux).

Cross-building: Linux targets build fine from macOS; Windows NSIS from macOS/Linux usually
works via electron-builder's bundled tooling but is best done in CI on a Windows runner.
Recommended: a GitHub Actions matrix (`macos-latest` / `windows-latest` / `ubuntu-latest`)
each running `npm run package`.

### Code signing & notarization (before selling)

- **macOS**: Apple Developer ID cert → remove `identity: null`, add
  `notarize: true` + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` env. Unsigned builds
  require right-click → Open and look untrustworthy — sign before launch.
- **Windows**: an OV/EV code-signing cert (Azure Trusted Signing is the cheap 2025+ route);
  set `win.signtoolOptions`/`azureSignOptions`. Unsigned = SmartScreen warnings.
- **Linux**: no signing needed for AppImage/deb.

## License model & monetization

One-time license, **offline Ed25519 validation** — no account, no cloud, no server
roundtrip (consistent with the privacy positioning).

- Keys are `SNAPK1.<payload>.<signature>` — Ed25519 signature of `{email, orderId}`
  verified against the public key baked into the app (`src/main/licenseCrypto.ts`,
  unit-tested). 14-day trial from first run; on expiry new captures are blocked,
  editor/export keep working.
- Dev builds use the committed dev keypair (`scripts/dev-license-keys/` — forgeable
  by design); release builds bake a real key via the `SNAPKIT_LICENSE_PUBKEY` secret.
- Tooling: `scripts/license-keygen.mjs` (keypair + manual signing),
  `tools/license-webhook/` (Lemon Squeezy → signed key by email).
- **Auto-update**: wired via `electron-updater` + GitHub Releases (see
  `src/main/updater.ts` and the `publish` block in electron-builder.yml).

**Everything owner-side (accounts, certs, secrets, first release) is a checklist in
[docs/selling.md](./docs/selling.md).**

## Known limits (declared)

- OCR is English-only (multilingual → roadmap); secrets spanning multiple OCR words
  are not detected (word-level matching).
- Capture works on the display under the cursor; simultaneous multi-display
  selection is on the roadmap (phase 2).
- Window capture resolution is capped by desktopCapturer thumbnails (4096px).
- Wayland support depends on the compositor's xdg-desktop-portal screen-share support.
- Tray icon is a generated placeholder; per-OS designed icons pending.
- macOS Screen Recording permission requires an app relaunch after granting (OS limit).

## Roadmap & out of scope (MVP)

No cloud upload, no video/GIF recording, no sync, no accounts — see [ROADMAP.md](./ROADMAP.md).

## License

Proprietary. All rights reserved (commercial one-time license planned — see above).
