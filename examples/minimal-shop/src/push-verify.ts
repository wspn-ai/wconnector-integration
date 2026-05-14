import { createHmac, timingSafeEqual } from 'crypto'

export const PUSH_TIMESTAMP_HEADER = 'x-gateway-timestamp'
export const PUSH_SIGNATURE_HEADER = 'x-gateway-signature'

const MAX_SKEW_MS = 5 * 60 * 1000

export class PushVerificationError extends Error {}

export function verifyPush(
  secret: string,
  timestamp: string | undefined,
  body: string,
  signature: string | undefined,
  now: number = Date.now(),
): void {
  if (!timestamp || !signature) throw new PushVerificationError('missing signature headers')
  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) {
    throw new PushVerificationError('timestamp out of window')
  }
  const expected = createHmac('sha256', secret).update(timestamp + body).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PushVerificationError('signature mismatch')
  }
}
