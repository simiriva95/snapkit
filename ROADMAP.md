# Snapkit — Roadmap

Where "greatness" is parked so the MVP can **ship**. Nothing here blocks the MVP.

MVP milestones M0–M7 are done — see [README.md](./README.md).

Effort scale: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks · **XL** > 2 weeks.

---

## Phase 1 — Sellable (pre-revenue blockers, do in this order)

Goal: a stranger can pay, download, install and update without friction.

| #   | Item                                           | Effort | Notes                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Designed icons (app + tray, per-OS light/dark) | S      | Replaces the generated placeholder (`scripts/make-tray-icon.mjs`). Needed before signing (icon is baked into installers).                                                                                                               |
| 1.2 | macOS signing + notarization                   | M      | Apple Developer ID ($99/y). Remove `identity: null`, add `notarize` + `APPLE_ID` env. Without it: right-click-to-open friction kills conversions.                                                                                       |
| 1.3 | Windows code signing                           | M      | Azure Trusted Signing (cheapest 2025+ route). Without it: SmartScreen scare page.                                                                                                                                                       |
| 1.4 | CI release matrix                              | S      | GitHub Actions: macos/windows/ubuntu runners each `npm run package`, artifacts to a draft GitHub Release.                                                                                                                               |
| 1.5 | Real license validation                        | M      | Replace the stub in `src/main/license.ts`: Ed25519 signature of `{email, orderId}` as the key, public key embedded, `activate()` verifies offline. Decide trial-expiry enforcement (recommend: soft-block capture, keep editor/export). |
| 1.6 | Gumroad or Lemon Squeezy storefront            | S      | LS webhook → key generator (tiny serverless fn — the only backend in the whole product).                                                                                                                                                |
| 1.7 | Auto-update                                    | S      | `electron-updater` + `publish: github` + `checkForUpdatesAndNotify()`. Requires 1.2/1.3 (signed builds).                                                                                                                                |

**Exit criterion**: purchase → email with key → install → activate → auto-update on next release. Zero manual steps.

## Phase 2 — Differentiators (v1.x, ship one per release)

Goal: widen the moat on the three axes (cross-platform, privacy, developer-first).
Ordered by wow-per-effort.

**Status**: 2.1 ✅ (self-hosted assets via setup-bgr.mjs instead of lazy-download —
offline-pure, +76MB) · 2.2 ✅ · 2.3 ✅ (bundled packs, not lazy) · 2.4 ✅ · 2.6 ✅ ·
2.5 scrolling capture **pending** (the one L-sized item left).

| #   | Item                                             | Effort | Implementation note                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | **Subject extraction / stickers** (iPhone-style) | M      | `@imgly/background-removal` — ONNX segmentation, fully local (fits privacy stance). UI: "Copy subject" beside Copy/Styled. Model 40–80MB → lazy-download on first use with progress toast, cache in userData.                                                                             |
| 2.2 | **Multi-word secrets in OCR**                    | S      | Today matching is word-level (`proposeRedactions`). Add line-level pass: join `line.words` with spaces, match patterns that may span words (`Authorization: Bearer x`, `-----BEGIN PRIVATE KEY-----`), map back to the covering word bboxes union. Pure function — extend existing tests. |
| 2.3 | **Multi-language OCR**                           | M      | Tesseract lang packs (ita/deu/fra/spa/jpn…). Prefs: language multi-select → lazy-download `.traineddata.gz` into userData, `langPath` fallback chain. Redaction patterns are language-agnostic (emails/tokens don't translate).                                                           |
| 2.4 | **Multi-display simultaneous capture**           | M      | Today: display under cursor. Change: one frozen overlay per display (same `createOverlay`, loop over `screen.getAllDisplays()`), selection events tagged with display id, first mousedown wins and closes the others.                                                                     |
| 2.5 | **Scrolling / long-page capture**                | L      | Hard cross-platform. Strategy: capture → scroll (synthetic wheel or user-driven) → capture → stitch via overlap correlation (pixel row matching). Ship macOS-first, degrade gracefully. Big CleanShot parity item.                                                                        |
| 2.6 | Branded export templates                         | S      | Extends M4 "styled copy": named presets (padding/gradient/logo watermark) in prefs, template picker in the export bar. Trivial after 2.1's UI groundwork.                                                                                                                                 |

## Phase 3 — Expansion (v2, revisit pricing)

Cloud features conflict with "never leaves your device" — resolve by **opt-in per action**
(explicit "Upload" button, never automatic) + honest copy. Each unlocks subscription pricing.

| #   | Item                                  | Effort | Note                                                                                                                                                           |
| --- | ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Video / GIF recording                 | XL     | **In progress** — see `docs/superpowers/specs/2026-09-03-video-suite-design.md` (V0 ffmpeg plumbing ✅, V1 recorder ✅, V2 replay buffer, V3 editor).          |
| 3.2 | Cloud upload + shareable links        | L      | The only server-side product surface. S3+CDN, link = `snap.kit/x7Ab3`. Optional client-side encryption (key in fragment) to keep the privacy story. Paid tier. |
| 3.3 | Sync (prefs/templates across devices) | M      | Rides on 3.2's account infra. Not before it.                                                                                                                   |
| 3.4 | Team version                          | XL     | Shared workspaces, admin, SSO. Only with real demand signals from 3.2 users.                                                                                   |

## Phase 4 — Platform

| #   | Item                 | Effort | Note                                                                                                                                                                                                                                     |
| --- | -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Plugins / extensions | XL     | Stable plugin API (annotate tools, exporters, uploaders). Design constraint from day one: keep `editor/annotations.ts` model serializable and tool definitions data-driven — already true. Don't build until there's a community asking. |

## Deferred technical debt / decisions

- **CSP in dev**: relaxed for Vite HMR; strict CSP applies in packaged builds only.
- **Own-window filtering in the picker**: matches on window title "Snapkit" — brittle if
  the title ever changes; revisit with a native window-id check.
- **Trial enforcement**: stub never blocks. Decision due at Phase 1.5.
- **Stop recording needs a second entry point** (tray "Stop Recording" or the record shortcuts
  toggling stop) — today only the control bar stops; V2 prerequisite.
- **Control bar is visible in screen/window recordings** — Electron cannot exclude a window
  from ScreenCaptureKit/WGC capture; options: move the bar to another display when present,
  or a tray-only timer.

## Explicitly rejected (for now)

- Accounts/login for local features — undermines the core promise.
- Automatic cloud upload — same reason. Upload stays a deliberate user action.
