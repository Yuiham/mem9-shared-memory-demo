import assert from 'node:assert/strict';
import test from 'node:test';
import { sign, signatureMatches, timestampIsFresh } from './signing.mjs';

// The receiver, `simulate` and the fake server all sign through the same scheme, so
// tests built on them agree with each other by construction. This vector does not: the
// expected value was computed with `openssl dgst -sha256 -hmac` over the same text,
//   printf '%s' '1700000000.evt_known_1.<body>' | openssl dgst -sha256 -hmac 'whsec_known_answer_secret'
// following the server's SignPayload (HMAC-SHA256 keyed with the whole secret string,
// over "<timestamp>.<event id>." and the raw body, hex, prefixed "v1=").
const VECTOR = {
  secret: 'whsec_known_answer_secret',
  timestamp: 1700000000,
  eventId: 'evt_known_1',
  rawBody: '{"type":"space_chain.fact_routed","data":{"text":"hello"}}',
  signature: 'v1=57438c3a59bf92c7d49eeacd027645605c52ed82fb572267bd2ec3160b31bfa7',
};

test('the signature of a fixed delivery equals the value computed independently', () => {
  assert.equal(sign(VECTOR), VECTOR.signature);
  assert.equal(sign({ ...VECTOR, timestamp: String(VECTOR.timestamp), rawBody: Buffer.from(VECTOR.rawBody) }), VECTOR.signature, 'a text timestamp and a binary body sign the same');
});

test('a changed secret, timestamp, event id, body or signature does not match', () => {
  assert.equal(signatureMatches(VECTOR), true);
  for (const change of [
    { secret: 'whsec_other' },
    { timestamp: VECTOR.timestamp + 1 },
    { eventId: 'evt_known_2' },
    { rawBody: `${VECTOR.rawBody} ` },
    { signature: VECTOR.signature.replace('v1=', 'v2=') },
    { signature: VECTOR.signature.slice(0, -1) },
    { signature: undefined },
  ]) {
    assert.equal(signatureMatches({ ...VECTOR, ...change }), false, JSON.stringify(Object.keys(change)));
  }
});

test('a timestamp is fresh within five minutes of the clock on either side, and never when it is not a whole number', () => {
  const now = 1_700_000_000_000;
  assert.equal(timestampIsFresh('1700000000', now), true);
  assert.equal(timestampIsFresh(String(1_700_000_000 - 300), now), true);
  assert.equal(timestampIsFresh(String(1_700_000_000 + 300), now), true);
  assert.equal(timestampIsFresh(String(1_700_000_000 - 301), now), false);
  assert.equal(timestampIsFresh(String(1_700_000_000 + 301), now), false);
  for (const bad of ['', 'soon', '1700000000.5', undefined]) assert.equal(timestampIsFresh(bad, now), false, String(bad));
});
