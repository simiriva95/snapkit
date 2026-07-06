// License tooling for Snapkit (Ed25519, offline validation).
//
//   node scripts/license-keygen.mjs keypair
//     → prints a new PEM keypair. Run ONCE at release time; keep private.pem
//       OFFLINE (password manager / HSM). Set SNAPKIT_LICENSE_PUBKEY to the
//       public PEM when building the app.
//
//   node scripts/license-keygen.mjs sign --key <private.pem> --email <email> --order <orderId>
//     → prints a license key: SNAPK1.<payload>.<signature>
//
// The committed keys in scripts/dev-license-keys/ are for DEVELOPMENT ONLY:
// anyone with repo access can forge keys signed by them. Production builds
// MUST embed a freshly generated public key via SNAPKIT_LICENSE_PUBKEY.
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [, , cmd, ...rest] = process.argv

function arg(name) {
  const i = rest.indexOf(`--${name}`)
  if (i === -1 || i === rest.length - 1) {
    console.error(`missing --${name}`)
    process.exit(1)
  }
  return rest[i + 1]
}

if (cmd === 'keypair') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  console.log(publicKey.export({ type: 'spki', format: 'pem' }))
  console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }))
} else if (cmd === 'sign') {
  const privatePem = readFileSync(arg('key'), 'utf8')
  const payload = Buffer.from(
    JSON.stringify({
      email: arg('email'),
      orderId: arg('order'),
      iat: Math.floor(Date.now() / 1000)
    })
  ).toString('base64url')
  const signature = sign(null, Buffer.from(payload, 'utf8'), privatePem).toString('base64url')
  console.log(`SNAPK1.${payload}.${signature}`)
} else {
  console.error(
    'usage: license-keygen.mjs keypair | sign --key <private.pem> --email <e> --order <id>'
  )
  process.exit(1)
}
