import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ANNOUNCEMENT, approvalDemo as approvalWithReceiver } from '../testing/approval.support.mjs';
import { withHarness } from '../testing/harness.support.mjs';

const PUBLIC_URL = 'https://receiver.example.com/hooks';
const PLACEHOLDER = 'https://receiver.invalid/';

async function approvalDemo(t) {
  const h = await withHarness(t);
  const init = await h.admin(['init', '--yes', '--example', 'approval']);
  assert.equal(init.code, 0, init.output);
  return h;
}

const endpointsOn = (h, person) => [...h.fake.chainByName(`sharedmem-demo-${person}`).webhooks.values()];
const creations = (h) => h.fake.requestsTo('POST', '/v1alpha2/space-chains').filter((request) => /\/webhooks$/.test(request.path));
const updates = (h) => h.fake.requestsTo('PATCH', '/v1alpha2/space-chains');

test('webhook set registers one endpoint per Leader Chain, for routed-fact events only', async (t) => {
  const h = await approvalDemo(t);
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  assert.equal(result.code, 0, result.output);
  for (const leader of ['lucia', 'marco']) {
    const [endpoint] = endpointsOn(h, leader);
    assert.equal(endpointsOn(h, leader).length, 1);
    assert.equal(endpoint.url, PUBLIC_URL);
    assert.deepEqual(endpoint.events, ['space_chain.fact_routed']);
    assert.equal(endpoint.name, `sharedmem-demo-${leader}`);
  }
  for (const developer of ['ana', 'bruno', 'carla', 'diego']) assert.equal(endpointsOn(h, developer).length, 0, `${developer} has no webhook`);
  assert.equal(creations(h).length, 2);
});

test('the signing secrets are stored in the state, and never printed', async (t) => {
  const h = await approvalDemo(t);
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  const state = h.readState();
  assert.deepEqual(Object.keys(state.webhooks).sort(), ['lucia', 'marco']);
  for (const leader of ['lucia', 'marco']) {
    assert.match(state.webhooks[leader].secret, /^whsec_/);
    assert.equal(state.webhooks[leader].url, PUBLIC_URL);
    assert.equal(state.webhooks[leader].id, endpointsOn(h, leader)[0].id);
    assert.ok(!result.output.includes(state.webhooks[leader].secret));
  }
  assert.equal(fs.statSync(path.join(h.workdir, 'state', 'state.json')).mode & 0o777, 0o600);
});

test('running again with another address updates the endpoints and keeps the secrets', async (t) => {
  const h = await approvalDemo(t);
  await h.admin(['webhook', 'set', '--url', PLACEHOLDER]);
  const before = h.readState().webhooks;
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  assert.equal(result.code, 0, result.output);
  assert.equal(creations(h).length, 2, 'no new endpoints');
  assert.equal(updates(h).length, 2);
  const after = h.readState().webhooks;
  for (const leader of ['lucia', 'marco']) {
    assert.equal(after[leader].secret, before[leader].secret);
    assert.equal(after[leader].url, PUBLIC_URL);
    assert.equal(endpointsOn(h, leader)[0].url, PUBLIC_URL);
  }
});

test('an endpoint the server no longer has is created again with a new secret', async (t) => {
  const h = await approvalDemo(t);
  await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  const before = h.readState().webhooks.lucia;
  h.fake.chainByName('sharedmem-demo-lucia').webhooks.clear();
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  assert.equal(result.code, 0, result.output);
  const after = h.readState().webhooks.lucia;
  assert.notEqual(after.id, before.id);
  assert.notEqual(after.secret, before.secret);
  assert.equal(endpointsOn(h, 'lucia').length, 1);
});

test('a placeholder address registers, and the output says it can never deliver', async (t) => {
  const h = await approvalDemo(t);
  const result = await h.admin(['webhook', 'set', '--url', PLACEHOLDER]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /placeholder/i);
  assert.match(result.stdout, /never deliver/i);
  assert.equal(Object.keys(h.readState().webhooks).length, 2);
});

test('--test asks the server to send a test event for every endpoint', async (t) => {
  const h = await approvalDemo(t);
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL, '--test']);
  assert.equal(result.code, 0, result.output);
  assert.equal(h.fake.requestsTo('POST', '/v1alpha2/space-chains').filter((request) => /\/test$/.test(request.path)).length, 2);
  assert.equal(h.fake.deliveries.filter((delivery) => delivery.record.event_type === 'webhook.test').length, 2);
});

test('--test with the placeholder address is refused before anything is sent', async (t) => {
  const h = await approvalDemo(t);
  const before = h.fake.requests.length;
  const result = await h.admin(['webhook', 'set', '--url', PLACEHOLDER, '--test']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /placeholder/i);
  assert.equal(h.fake.requests.length, before, 'nothing was sent');
  assert.deepEqual(h.readState().webhooks, {});
});

test('an address the server rejects is explained and nothing is recorded', async (t) => {
  const h = await approvalDemo(t);
  const plain = await h.admin(['webhook', 'set', '--url', 'http://receiver.example.com/']);
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /rejected the webhook address/);
  assert.match(plain.stderr, /HTTPS/);
  assert.match(plain.stderr, /tunnel/);
  const priv = await h.admin(['webhook', 'set', '--url', 'https://10.1.2.3/']);
  assert.equal(priv.code, 1);
  assert.match(priv.stderr, /private/i);
  const credentials = await h.admin(['webhook', 'set', '--url', 'https://user:pw@receiver.example.com/']);
  assert.equal(credentials.code, 1);
  assert.ok(!credentials.output.includes('pw@'), 'the address is not echoed');
  assert.deepEqual(h.readState().webhooks, {});
});

test('a missing or malformed --url is a usage error', async (t) => {
  const h = await approvalDemo(t);
  const missing = await h.admin(['webhook', 'set']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--url/);
  const malformed = await h.admin(['webhook', 'set', '--url', 'not a url']);
  assert.equal(malformed.code, 2);
  assert.match(malformed.stderr, /--url/);
});

test('an unknown subcommand is a usage error that lists the subcommands', async (t) => {
  const h = await approvalDemo(t);
  const result = await h.admin(['webhook', 'frobnicate']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /set/);
  const bare = await h.admin(['webhook']);
  assert.equal(bare.code, 2);
});

test('a Chain created again after the server lost it has no endpoint on record', async (t) => {
  const h = await approvalDemo(t);
  await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  h.fake.chainByName('sharedmem-demo-lucia').deleted = true;
  assert.equal((await h.admin(['init', '--yes'])).code, 0);
  assert.deepEqual(Object.keys(h.readState().webhooks), ['marco']);
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  assert.equal(result.code, 0, result.output);
  assert.equal(endpointsOn(h, 'lucia').length, 1, 'the new Chain got its own endpoint');
});

test('webhook set without a state says to run init first', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['webhook', 'set', '--url', PUBLIC_URL]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /init/);
});

test('webhook --help covers what it changes and the next step', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin(['webhook', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /set --url/);
  assert.match(result.stdout, /HTTPS/);
  assert.match(result.stdout, /receiver\.invalid/);
});

// ---- deliveries ---------------------------------------------------------------------

test('webhook deliveries lists the server\'s records newest first, with status, attempts and the last error', async (t) => {
  const demo = await approvalWithReceiver(t, { receiver: false });
  const { h } = demo;
  assert.equal(await h.say('lucia', ANNOUNCEMENT), 200);
  assert.equal(await h.say('lucia', 'Release freeze for checkout and payments begins Friday.'), 200);
  h.fake.failNextDelivery();
  await h.fake.flushDeliveries('http://127.0.0.1:9');
  const result = await h.admin(['webhook', 'deliveries', '--leader', 'lucia']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /^lucia: 2 delivery records, newest first/m);
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('  '));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /space_chain\.fact_routed\s+pending\s+attempts=1\s+http=-\s+delivery failed/, 'the newest record could not reach the address');
  assert.match(lines[1], /space_chain\.fact_routed\s+pending\s+attempts=1\s+http=-\s+forced failure/, 'the older record was made to fail');
  assert.ok(!result.stdout.includes(ANNOUNCEMENT), 'no event content');
  assert.match(result.stdout, /which node/);
});

test('webhook deliveries covers every Leader by default and one with --leader', async (t) => {
  const demo = await approvalWithReceiver(t, { receiver: false });
  const everyone = await demo.h.admin(['webhook', 'deliveries']);
  assert.equal(everyone.code, 0, everyone.output);
  assert.match(everyone.stdout, /^lucia: no delivery records/m);
  assert.match(everyone.stdout, /^marco: no delivery records/m);
  const one = await demo.h.admin(['webhook', 'deliveries', '--leader', 'marco']);
  assert.doesNotMatch(one.stdout, /^lucia:/m);
  const unknown = await demo.h.admin(['webhook', 'deliveries', '--leader', 'ana']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /lucia, marco/);
});
