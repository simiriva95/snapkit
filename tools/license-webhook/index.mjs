// Lemon Squeezy webhook → signed Snapkit license key.
// The ONLY server-side component of the product. Deploy as a Node serverless
// function (Vercel/Netlify/anything). See docs/selling.md §5.
//
// Env:
//   LS_WEBHOOK_SECRET       — Lemon Squeezy webhook signing secret
//   SNAPKIT_LICENSE_PRIVKEY — production Ed25519 private key (PEM, pkcs8)
//   RESEND_API_KEY          — optional; emails the key to the buyer
import { createHmac, sign, timingSafeEqual } from 'node:crypto'

function makeLicenseKey(email, orderId) {
  const payload = Buffer.from(
    JSON.stringify({ email, orderId, iat: Math.floor(Date.now() / 1000) })
  ).toString('base64url')
  const signature = sign(
    null,
    Buffer.from(payload, 'utf8'),
    process.env.SNAPKIT_LICENSE_PRIVKEY
  ).toString('base64url')
  return `SNAPK1.${payload}.${signature}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify the Lemon Squeezy HMAC signature.
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  const digest = createHmac('sha256', process.env.LS_WEBHOOK_SECRET).update(raw).digest('hex')
  const received = req.headers['x-signature'] ?? ''
  if (
    digest.length !== received.length ||
    !timingSafeEqual(Buffer.from(digest), Buffer.from(received))
  ) {
    return res.status(401).json({ error: 'invalid signature' })
  }

  const event = JSON.parse(raw)
  if (event.meta?.event_name !== 'order_created') return res.status(200).json({ ignored: true })

  const email = event.data?.attributes?.user_email
  const orderId = String(event.data?.attributes?.order_number ?? event.data?.id ?? '')
  if (!email || !orderId) return res.status(400).json({ error: 'missing email/order' })

  const key = makeLicenseKey(email, orderId)

  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Snapkit <license@snapkit.dev>',
        to: email,
        subject: 'Your Snapkit license key',
        text:
          `Thanks for buying Snapkit!\n\nYour license key:\n\n${key}\n\n` +
          'Open Snapkit → Preferences → License, paste the key and hit Activate. ' +
          'Validation happens on your device — no account needed.'
      })
    })
  } else {
    console.log(`[license-webhook] key for ${email} (order ${orderId}): ${key}`)
  }

  return res.status(200).json({ ok: true })
}
