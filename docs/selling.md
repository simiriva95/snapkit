# Selling Snapkit — operational checklist

Everything code-side is ready; these are the account/credential steps only the
owner can do. In order:

## 1. GitHub repository

1. Create the repo (e.g. `simiriva95/snapkit`), push `main`.
2. If the name differs, update `publish.owner`/`publish.repo` in
   [electron-builder.yml](../electron-builder.yml) and `homepage` in package.json.

## 2. Production license keypair (5 minutes, do this before any public build)

```bash
node scripts/license-keygen.mjs keypair
```

- **private key** → password manager. Never in the repo, never in CI.
  It signs customer keys (webhook secret `SNAPKIT_LICENSE_PRIVKEY`).
- **public key** → GitHub Actions secret `SNAPKIT_LICENSE_PUBKEY`.
  Baked into release builds; the committed dev key is then ignored.

Sign a key manually (support cases, refand-regen, comp copies):

```bash
node scripts/license-keygen.mjs sign --key private.pem --email cust@x.io --order LS-1234
```

## 3. macOS signing + notarization (~$99/year)

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/).
2. Create a **Developer ID Application** certificate in Xcode / developer portal.
3. Export it as `.p12` with a password, then:
   - `MAC_CSC_LINK` secret = base64 of the .p12 (`base64 -i cert.p12`)
   - `MAC_CSC_KEY_PASSWORD` = the export password
4. Notarization: create an [app-specific password](https://appleid.apple.com) →
   secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

electron-builder signs + notarizes automatically when these are present.

## 4. Windows signing

Cheapest sane route (2025+): **Azure Trusted Signing** (~$10/month).

1. Azure account → Trusted Signing resource → identity validation.
2. Service principal creds → secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`.
3. Add to electron-builder.yml when ready:

```yaml
win:
  azureSignOptions:
    endpoint: https://eus.codesigning.azure.net
    codeSigningAccountName: <account>
    certificateProfileName: <profile>
```

Without it, builds work but SmartScreen warns users.

## 5. Storefront (Lemon Squeezy — handles EU VAT for you)

1. Create the store + a product "Snapkit — lifetime license".
2. Add a webhook (Settings → Webhooks) pointing at your deployed copy of
   [tools/license-webhook/index.mjs](../tools/license-webhook/index.mjs)
   with event `order_created` and a signing secret.
3. Deploy the webhook anywhere that runs Node (Vercel function is fine —
   this is the ONLY server-side component in the whole product). Env:
   - `LS_WEBHOOK_SECRET` — from step 2
   - `SNAPKIT_LICENSE_PRIVKEY` — the production private key (PEM)
   - `RESEND_API_KEY` (optional) — to email the key; otherwise wire your ESP
4. Flow: purchase → LS webhook → key signed offline-style → emailed to the
   buyer → they paste it in Preferences → validated locally, no server call.

## 6. First release

```bash
npm version 0.1.0        # bumps package.json + creates tag v0.1.0
git push --follow-tags
```

CI (.github/workflows/release.yml) builds mac/win/linux, signs whatever has
secrets configured, publishes the GitHub Release. electron-updater picks
updates from there automatically (signed builds required on mac/win).

## Trial policy (decided)

14 days from first run. On expiry: **new captures are blocked** (dialog with
a link to Preferences), editor/export of existing captures keep working.
Change in `src/main/capture.ts → startCapture` if policy evolves.
