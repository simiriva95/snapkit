<p align="center">
  <img src="build/icon.png" width="112" alt="Snapkit icon" />
</p>

<h1 align="center">Snapkit</h1>

<p align="center"><em>A developer-first screenshot, recording and annotation tool that finds the secrets in your screenshot and blurs them — entirely on your machine.</em></p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-2ea44f" />
  <img alt="Offline" src="https://img.shields.io/badge/cloud-none%2C%20ever-2ea44f" />
</p>

<p align="center">
  <a href="../../releases">Download</a> ·
  <a href="#getting-started">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

<p align="center"><img src="docs/screenshots/hero.png" width="820" alt="hero shot — the editor open on a terminal screenshot with dashed auto-redaction regions proposed over an API key, 1280px wide"></p>

Every screenshot tool can draw an arrow. Snapkit is built around a different problem: screenshots
leak secrets. Terminal output with an `AWS_SECRET_KEY`, a bug report with a JWT in the network tab,
a config file with someone's email — pasted straight into a public channel. Snapkit runs OCR
locally, matches the sensitive bits against a tested pattern set, and pixelates them before you
share. No cloud, no account, no telemetry: the OCR models, the segmentation model and the fonts all
ship with the app, so airplane mode changes nothing.

## Features

- **Local auto-redaction** — Tesseract OCR on-device plus a pattern set covering JWTs, AWS/Google/
  GitHub/Slack/Stripe/`sk-` keys, emails and IPv4, with a second line-level pass for secrets that
  span words (`Bearer …`, `-----BEGIN PRIVATE KEY-----`, `password:`/`client_secret=`). You review
  the proposed regions, deselect any false positive, then blur in one click.
- **Capture that matches what you saw** — the screen is grabbed *before* the overlay opens, so you
  select on a frozen frame; area (simultaneous overlays on every display), full screen, single
  window with a live-thumbnail picker, and scrolling capture that stitches frames as you scroll.
- **Eleven annotation tools, keyboard-first** — arrow, line, freehand pen, rectangle, text,
  highlighter, auto-numbered step markers, pixelate blur, plus lasso (copy a free-form selection
  with transparency) and smart cut (copy just the subject via on-device ONNX segmentation).
- **Screen recording** — region capture to WebM (up to 5 min) or GIF (up to 30 s, downscaled to
  800 px wide), written wherever you choose.
- **Clipboard history** — a Win+V-style panel with search, arrow-key navigation, pinning and
  optional auto-paste; image entries are OCR'd, so searching their *text* finds the screenshot.
- **Styled export** — copy to clipboard, or styled copy onto a padded gradient backdrop
  (Emerald, Graphite, Steel, Paper), or save as PNG/JPG.
- **Nothing leaves the device** — no telemetry, no crash reporting, no account. The only outbound
  request a packaged build can make is the GitHub Releases update check, and it fails silently
  offline.
- **Tested pure cores** — undo/redo history, redaction patterns, scroll stitching, bundle swap and
  license crypto are plain functions with Vitest suites; CI runs them on macOS, Windows and Linux
  before every release build.

<p align="center"><img src="docs/screenshots/redaction-review.png" width="820" alt="the redaction review step — dashed regions labelled &quot;JWT&quot;, &quot;AWS access key&quot;, &quot;Email address&quot; over a terminal, with the &quot;Blur N&quot; button visible"></p>

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Electron 43 + electron-vite 5 (strict process separation, `contextBridge`, no `nodeIntegration`) |
| UI | React 19 · Tailwind CSS 4 · Zustand 5 · Radix Slot + lucide-react |
| Canvas | Konva 10 / react-konva |
| OCR | tesseract.js 7 — worker, WASM core and language packs self-hosted |
| Segmentation | @imgly/background-removal 1.7 — quantized ONNX model, self-hosted |
| Recording | `getDisplayMedia` + canvas crop → MediaRecorder (WebM) / gifenc (GIF) |
| Persistence | electron-store 11 |
| Packaging | electron-builder 26 (dmg/zip · NSIS · AppImage/deb) + electron-updater |
| Tooling | TypeScript 5.9 · Vitest 4 · ESLint 9 (flat config) · Prettier |

## Getting started

### Install a release

**macOS (Apple Silicon) — do not download the `.dmg`.** Snapkit is not notarized yet, and macOS
quarantines everything a browser downloads, so Gatekeeper rejects the app with *"Snapkit is
damaged"* (since macOS 15, right-click → Open no longer bypasses it). Terminal downloads are not
quarantined, so use one of these instead:

```bash
# 1. install script — fetches the latest release into /Applications
curl -fsSL https://raw.githubusercontent.com/simiriva95/snapkit/main/scripts/install.sh | bash

# 2. Homebrew — this repo doubles as the tap
brew tap simiriva95/snapkit https://github.com/simiriva95/snapkit
brew install --cask --no-quarantine snapkit
```

Already stuck with a "damaged" copy from the `.dmg`? Run `xattr -cr /Applications/Snapkit.app`.

| OS | Artifact | Note |
| --- | --- | --- |
| macOS (arm64) | `Snapkit-x.y.z-arm64-mac.zip` / `.dmg` | ad-hoc signed, not notarized — install via script or brew |
| Windows (x64) | `Snapkit Setup x.y.z.exe` | unsigned: SmartScreen warns — **More info → Run anyway** |
| Linux | `Snapkit-x.y.z.AppImage` / `.deb` | `chmod +x` the AppImage and run |

> On first capture macOS asks for **Screen Recording** permission (System Settings → Privacy &
> Security) and then requires a relaunch. That is an OS rule, not a Snapkit one.

### Build from source

Requires Node.js ≥ 20.19 (CI builds on Node 22) and npm.

```bash
git clone https://github.com/simiriva95/snapkit.git
cd snapkit
npm install
# some environments skip electron's postinstall binary download:
node node_modules/electron/install.js

npm run dev             # electron-vite dev, hot reload
npm run build           # compile main + preload + renderer into out/
npm run package         # installer for your OS → dist/
npm run package:winmac  # .dmg + Windows .exe in one pass (from macOS)
npm run package:all     # mac + Windows + Linux
```

`predev`/`prebuild` run `scripts/setup-ocr.mjs` and `scripts/setup-bgr.mjs`, which copy the
tesseract.js worker/WASM out of `node_modules` and download the quantized segmentation model
(~40 MB, once) into `src/renderer/public/`. Both are idempotent and gitignored; after the first
run the build is fully offline.

### Development

```bash
npm test          # vitest — redaction, undo/redo, annotations, stitching, license crypto, bundle swap
npm run typecheck # strict TS, node + web projects
npm run lint      # eslint flat config
npm run format    # prettier
npm run gen:appicon  # regenerate build/icon.png programmatically
npm run gen:icon     # regenerate the tray template icons
```

Tagging `v*` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml): it
pre-creates a draft GitHub Release, then builds on macOS/Windows/Ubuntu runners (tests and
typecheck first), publishes the installers as the electron-updater feed, appends the macOS install
guide to the release notes and bumps `Casks/snapkit.rb` to the new version and SHA.

## Configuration

There is nothing to configure to run Snapkit — it talks to zero external services and needs no API
keys. Runtime settings live in Preferences and are persisted by `electron-store`
([`src/shared/prefs.ts`](src/shared/prefs.ts)): capture/fullscreen/window/scrolling/record/history
shortcuts, theme (`dark` by default), export folder and format, styled-copy template, OCR languages
(`eng`, `ita`, `deu`, `fra`, `spa` bundled), recording format, auto-redact after capture, auto-copy,
clipboard history and auto-paste, and launch at login.

Build-time environment variables (release builds only):

| Variable | Required | What it does |
| --- | --- | --- |
| `SNAPKIT_LICENSE_PUBKEY` | No | Ed25519 public key (PEM) baked into the build to verify offline license keys. Unset → the committed dev key in `scripts/dev-license-keys/` is used. |
| `CSC_IDENTITY_AUTO_DISCOVERY` | No | Set to `false` by the `package*` scripts and by CI to build unsigned. |
| `CSC_LINK` / `CSC_KEY_PASSWORD`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`, `AZURE_*` | No | Code-signing and notarization credentials, consumed by electron-builder when present. See [docs/selling.md](docs/selling.md). |

> **No API keys exist in this repo.** Key-shaped strings in
> [`src/shared/redaction.test.ts`](src/shared/redaction.test.ts) (`AKIA…`, `AIza…`, `xoxb-…`,
> `sk_live_…`, JWTs) are fabricated fixtures for the pattern matcher. Secret-scanner hits on them
> are false positives.

## How it works

```
src/
  main/       windows, tray, global shortcuts, capture orchestration, export,
              clipboard history, prefs, license, auto-update, app:// protocol
  preload/    contextBridge — one typed API surface, no nodeIntegration
  renderer/   React: home, per-display selection overlays, Konva editor,
              window picker, control bar, history panel, hidden recorder
  shared/     typed IPC contract, redaction patterns, prefs & license models
```

Four decisions carry most of the design:

- **Capture-first selection.** The screen is grabbed before any overlay appears, so the user drags
  on a frozen frame — the selection is WYSIWYG even if the underlying app repaints.
- **`app://` custom protocol.** Packaged builds serve the renderer over a privileged scheme, so
  `fetch()`, web workers and absolute paths behave exactly as in dev; `file://` breaks all three.
- **Two-pass redaction.** A word-level pass catches single-token secrets from the OCR word boxes; a
  line-level pass re-joins each line, matches multi-word patterns, and maps the char range back to
  the union of the covered word boxes. Overlapping proposals are deduplicated, larger region wins.
- **Scroll stitching.** Per-row luminance hashes plus a best-overlap search append only the new rows
  of each frame; fully overlapping frames are dropped. Declared limits: sticky headers can ghost,
  and scrolling more than one frame height leaves a seam.

Licensing is offline by design: keys are Ed25519 signatures over `{email, orderId}`, verified
against a public key baked in at build time — no activation server. It is dormant in the current
build; see [docs/selling.md](docs/selling.md).

## Roadmap

Phase 2 is complete except scrolling-capture polish; the open work is signing/notarization, the
storefront and license pipeline, then opt-in cloud share links, sync and a plugin API. Full phased
plan — including what was deliberately rejected (accounts for local features, automatic uploads) —
in [ROADMAP.md](ROADMAP.md).

## License

No `LICENSE` file is present in this repository yet, so the terms are not formally declared;
`package.json` states `SEE LICENSE IN README.md`. The author's stated intent is source-available —
the code is public to read, build and use personally, while commercial redistribution stays
reserved while the monetization model settles. Until a `LICENSE` file lands, assume no permission
beyond that and ask before redistributing.
