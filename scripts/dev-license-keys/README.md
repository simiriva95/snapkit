Dev license keys. Only the PUBLIC key is committed (it matches the fallback in
src/main/license.ts). To test activation locally, generate your own pair:

    node scripts/license-keygen.mjs keypair
    # save the private key as scripts/dev-license-keys/private.pem (gitignored)
    node scripts/license-keygen.mjs sign --key scripts/dev-license-keys/private.pem --email you@x.io --order DEV-1

Production builds MUST embed a freshly generated public key via the
SNAPKIT_LICENSE_PUBKEY env var — never ship a build whose private counterpart
exists on a laptop.
