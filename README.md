# Snapkit

**Developer-first, cross-platform screenshot & annotation tool** — capture, annotate, and
export screenshots, with **local auto-redaction** of secrets (emails, tokens, API keys, IPs)
so a screenshot is _safe to share_ with one click.

> Reference competitor: CleanShot X (macOS-only, paid). Our angle: **cross-platform +
> privacy-first + developer-first**, one-time affordable license.

Your screenshots **never leave your device**: OCR and redaction run entirely locally.

---

## Status

🚧 Early development, built milestone by milestone.

- ✅ **M0 · Scaffold** — electron-vite + React 19 + TS (strict) + Tailwind v4 + shadcn, tray-resident app.
- ⬜ M1 · Capture (global shortcut → area select → editor)
- ⬜ M2 · Annotation editor (Konva)
- ⬜ M3 · Auto-redaction (Tesseract.js OCR + regex)
- ⬜ M4 · Export (PNG/JPG, clipboard, padded background)
- ⬜ M5 · Preferences + UX polish
- ⬜ M6 · Packaging + license (stub)

See [ROADMAP.md](./ROADMAP.md) for post-MVP plans.

## Requirements

- Node.js ≥ 20.19 (developed on Node 24)
- npm

## Develop

```bash
npm install
npm run dev        # launches Electron with HMR; window opens + tray icon appears
```

Other scripts:

```bash
npm run typecheck  # tsc on main/preload/shared + renderer
npm run lint       # ESLint (flat config)
npm run format     # Prettier
npm run build      # electron-vite production bundle into out/
npm run gen:icon   # regenerate the tray icon
```

## Architecture

Strict Electron process separation, no `nodeIntegration`, `contextIsolation` on, `sandbox` on.

```
src/
  main/       Electron main: window, tray, IPC handlers, (M1+) capture & shortcuts
  preload/    contextBridge — exposes ONLY a typed API on window.api
  renderer/   React app (editor, canvas, preferences)
  shared/     Typed IPC contract + (M3) redaction regex patterns
resources/    Static assets copied into the bundle (tray icon)
scripts/      Build-time helpers (icon generation)
```

- **Typed IPC**: channels and the bridged API live in `src/shared/ipc.ts` — no magic strings.
- **Security**: restrictive CSP in production; everything runs client-side, no remote code.
- **Tray-resident**: closing the window hides it; the app keeps running in the system tray.

## Stack

| Concern    | Choice                                   |
| ---------- | ---------------------------------------- |
| Shell      | Electron + electron-vite                 |
| UI         | React 19 + TypeScript (strict)           |
| Styling    | Tailwind CSS v4 + shadcn/ui              |
| State      | Zustand _(added at M2)_                  |
| Canvas     | Konva / react-konva _(added at M2)_      |
| OCR        | Tesseract.js _(added at M3)_             |
| Prefs      | electron-store _(added at M5)_           |
| Packaging  | electron-builder _(added at M6)_         |

> Deviations from the original spec: **React 19** (not 18 — current stable, supported by
> react-konva 19) and **Tailwind v4** (config-less, via `@tailwindcss/vite`). TS 5.9 / Vite 7 /
> ESLint 9 pinned deliberately over the just-released majors for ecosystem compatibility.

## Distribution & monetization _(planned, M6)_

- `electron-builder` for signable installers: NSIS (Windows), dmg (macOS), AppImage/deb (Linux).
- **Offline license**: locally-validated key + trial period, behind a `LicenseValidator` interface
  (trial impl + stub key validation) so a Gumroad/Lemon Squeezy backend plugs in later — no
  payment backend in the MVP.
- Auto-update via `electron-updater` + GitHub Releases.

_Not yet implemented — see [ROADMAP.md](./ROADMAP.md)._

## License

Proprietary. All rights reserved (license model TBD — see monetization above).
