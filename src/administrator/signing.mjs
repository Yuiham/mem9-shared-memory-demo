// The signature scheme of the mem9 server's webhook deliveries, shared by the receiver
// (which checks it) and `simulate` (which produces it).
//
//   X-Mem9-Signature: v1=<lowercase hex HMAC-SHA256>
//   keyed with the whole signing secret string (the "whsec_" prefix included, as UTF-8
//   bytes, not base64-decoded), over "<timestamp>.<event id>." followed by the raw body.
import crypto from 'node:crypto';

// How far a delivery's timestamp may be from this machine's clock. The server enforces
// no limit of its own; this one is the demo's choice.
export const TOLERANCE_SECONDS = 300;

// The header only `simulate` sends, so the receiver can mark the Candidate as simulated.
export const SIMULATED_HEADER = 'x-sharedmem-simulated';

export function sign({ secret, timestamp, eventId, rawBody }) {
  const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${eventId}.`).update(rawBody).digest('hex');
  return `v1=${mac}`;
}

export function signatureMatches({ secret, timestamp, eventId, rawBody, signature }) {
  const expected = Buffer.from(sign({ secret, timestamp, eventId, rawBody }));
  const given = Buffer.from(String(signature ?? ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function timestampIsFresh(timestamp, nowMs = Date.now()) {
  const seconds = Number(timestamp);
  return Number.isInteger(seconds) && Math.abs(nowMs / 1000 - seconds) <= TOLERANCE_SECONDS;
}
