import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ANNOUNCEMENT, approvalDemo, buildDelivery, post, waitFor } from '../testing/approval.support.mjs';

// ---- Candidates from real deliveries ------------------------------------------------

test('an announcement the server holds back becomes a pending Candidate for the Leader whose Chain produced it', async (t) => {
  const demo = await approvalDemo(t);
  // The Agent ID in the payload is a tool name here: attribution follows the Chain.
  assert.equal(await demo.h.say('lucia', ANNOUNCEMENT, { agentId: 'codex' }), 200);
  const [candidate] = await demo.waitForCandidates(1);
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.text, ANNOUNCEMENT, 'word for word');
  assert.equal(candidate.leader, 'lucia');
  assert.equal(candidate.test, false);
  assert.equal(candidate.simulated, false);
  const team = demo.h.readState().spaces['team-shared'].key;
  assert.equal(demo.h.fake.memoriesIn(team, { type: 'insight' }).length, 0, 'nothing was written to Team Shared');
  const record = demo.h.fake.deliveries.find((delivery) => delivery.record.event_type === 'space_chain.fact_routed').record;
  await waitFor(() => record.status === 'delivered', { what: 'the server to count the delivery as delivered' });
});

test('a second Leader\'s announcement is attributed to that Leader', async (t) => {
  const demo = await approvalDemo(t);
  await demo.h.say('marco', ANNOUNCEMENT);
  const [candidate] = await demo.waitForCandidates(1);
  assert.equal(candidate.leader, 'marco');
});

test('a delivery for a fact that was stored automatically is acknowledged and ignored', async (t) => {
  const demo = await approvalDemo(t);
  await demo.h.say('lucia', 'We will hire two engineers for the payments team next quarter.');
  const record = demo.h.fake.deliveries.find((delivery) => delivery.record.event_type === 'space_chain.fact_routed').record;
  await waitFor(() => record.status === 'delivered', { what: 'the delivery to be acknowledged' });
  assert.equal(demo.candidates().candidates.length, 0);
  assert.equal(demo.candidates().handledEvents.length, 1, 'the event is remembered');
});

test('a test event is acknowledged and creates nothing', async (t) => {
  const demo = await approvalDemo(t);
  const result = await demo.h.admin(['webhook', 'set', '--url', 'https://receiver.example.com/', '--test']);
  assert.equal(result.code, 0, result.output);
  const records = demo.h.fake.deliveries.filter((delivery) => delivery.record.event_type === 'webhook.test').map((delivery) => delivery.record);
  assert.equal(records.length, 2);
  await waitFor(() => records.every((record) => record.status === 'delivered'), { what: 'the test events to be delivered' });
  assert.equal(demo.candidates().candidates.length, 0);
  await waitFor(() => /test event/.test(demo.process.output()), { what: 'the test event to be logged' });
});

test('a delivery whose Agent ID starts with verify- is marked as a test Candidate', async (t) => {
  const demo = await approvalDemo(t);
  await demo.h.say('lucia', ANNOUNCEMENT, { agentId: 'verify-ab12cd34-W1' });
  const [candidate] = await demo.waitForCandidates(1);
  assert.equal(candidate.test, true);
  assert.equal(candidate.simulated, false);
});

test('a delivery that carries several source facts becomes one Candidate per fact', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia', {
    data: { chain_id: demo.h.readState().chains.lucia.id, webhook_only: true, agent_id: 'lucia', source_facts: [{ text: 'First rule.' }, { text: '   ' }, { text: 'Second rule.' }, { tags: ['x'] }] },
  });
  assert.equal((await post(demo.url, delivery)).status, 200);
  const candidates = demo.candidates().candidates;
  assert.deepEqual(candidates.map((candidate) => candidate.text), ['First rule.', 'Second rule.']);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ['c1', 'c2']);
});

test('the receiver accepts a delivery on any path', async (t) => {
  const demo = await approvalDemo(t);
  const result = await post(demo.url, buildDelivery(demo.h, 'lucia'), { path: '/some/tunnel/path' });
  assert.equal(result.status, 200);
  assert.equal(demo.candidates().candidates.length, 1);
});

// ---- Checks -------------------------------------------------------------------------

test('a wrong signature is refused with 401 and creates nothing', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia', { secret: 'whsec_not-the-secret-at-all' });
  const result = await post(demo.url, delivery);
  assert.equal(result.status, 401);
  assert.match(result.json.error, /signature/);
  assert.equal(demo.candidates().candidates.length, 0);
  await waitFor(() => /refused \(401\)/.test(demo.process.output()), { what: 'the refusal to be logged' });
});

test('a signature made with another Leader\'s secret is refused', async (t) => {
  const demo = await approvalDemo(t);
  const marcoSecret = demo.h.readState().webhooks.marco.secret;
  assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia', { secret: marcoSecret }))).status, 401);
});

test('a body changed after signing is refused', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia');
  delivery.rawBody = delivery.rawBody.replace('two reviewers', 'zero reviewers');
  assert.equal((await post(demo.url, delivery)).status, 401);
  assert.equal(demo.candidates().candidates.length, 0);
});

test('a timestamp more than five minutes away is refused even with a correct signature', async (t) => {
  const demo = await approvalDemo(t);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia', { timestamp: now - 301 }))).status, 401);
  assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia', { timestamp: now + 301 }))).status, 401);
  assert.equal(demo.candidates().candidates.length, 0);
  assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia', { timestamp: now - 290 }))).status, 200, 'inside the window is accepted');
});

test('a delivery for a Chain the demo does not know is refused', async (t) => {
  const demo = await approvalDemo(t);
  const unknown = buildDelivery(demo.h, 'lucia', { chainId: 'a-chain-nobody-registered' });
  assert.equal((await post(demo.url, unknown)).status, 401);
  const developer = buildDelivery(demo.h, 'lucia', { chainId: demo.h.readState().chains.ana.id });
  assert.equal((await post(demo.url, developer)).status, 401, 'a Developer Chain has no webhook');
});

test('malformed requests are refused without creating anything', async (t) => {
  const demo = await approvalDemo(t);
  const good = buildDelivery(demo.h, 'lucia');
  const { 'X-Mem9-Signature': dropped, ...withoutSignature } = good.headers;
  assert.equal((await post(demo.url, { ...good, headers: withoutSignature })).status, 400);
  const notJson = await fetch(demo.url, { method: 'POST', headers: good.headers, body: 'not json' });
  assert.equal(notJson.status, 400);
  const swapped = buildDelivery(demo.h, 'lucia');
  swapped.headers['X-Mem9-Event-Id'] = 'evt_other';
  assert.equal((await post(demo.url, swapped)).status, 401, 'the event id is part of what is signed');
  const mismatched = buildDelivery(demo.h, 'lucia', { bodyEventId: 'evt_in_the_body' });
  assert.equal((await post(demo.url, mismatched)).status, 400, 'a correctly signed header that disagrees with the body');
  const get = await fetch(demo.url);
  assert.equal(get.status, 405);
  assert.equal(demo.candidates().candidates.length, 0);
});

test('a body that is too large is refused', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia', { text: 'x'.repeat(1024 * 1024 + 10) });
  const outcome = await post(demo.url, delivery).catch((error) => ({ error }));
  assert.ok(outcome.error || outcome.status === 413, 'refused or the connection was closed');
  assert.equal(demo.candidates().candidates.length, 0);
});

test('a duplicate delivery is acknowledged and creates nothing more', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia');
  assert.equal((await post(demo.url, delivery)).status, 200);
  const again = await post(demo.url, buildDelivery(demo.h, 'lucia', { eventId: delivery.eventId }));
  assert.equal(again.status, 200);
  assert.equal(again.json.outcome, 'duplicate');
  assert.equal(demo.candidates().candidates.length, 1);
});

test('a duplicate after a receiver restart still creates nothing', async (t) => {
  const demo = await approvalDemo(t);
  const delivery = buildDelivery(demo.h, 'lucia');
  assert.equal((await post(demo.url, delivery)).status, 200);
  await demo.stopReceiver();
  await demo.startReceiver();
  const again = await post(demo.url, buildDelivery(demo.h, 'lucia', { eventId: delivery.eventId }));
  assert.equal(again.json.outcome, 'duplicate');
  assert.equal(demo.candidates().candidates.length, 1);
});

test('a retry from the server is judged by its own fresh timestamp', async (t) => {
  const demo = await approvalDemo(t);
  const first = buildDelivery(demo.h, 'lucia', { timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal((await post(demo.url, first)).status, 401, 'the old attempt is refused');
  const retry = buildDelivery(demo.h, 'lucia', { eventId: first.eventId });
  assert.equal((await post(demo.url, retry)).status, 200, 'the retry with the same event id is accepted');
  assert.equal(demo.candidates().candidates.length, 1);
});

// ---- Running the receiver -----------------------------------------------------------

test('the receiver listens on the loopback interface and describes itself in a runtime file', async (t) => {
  const demo = await approvalDemo(t);
  const runtime = JSON.parse(fs.readFileSync(demo.runtimeFile, 'utf8'));
  assert.equal(runtime.url, demo.url);
  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(Number.isInteger(runtime.pid));
  assert.equal(fs.statSync(demo.runtimeFile).mode & 0o777, 0o600);
  assert.match(demo.process.stdout(), /this computer only/);
});

test('stopping the receiver removes the runtime file', async (t) => {
  const demo = await approvalDemo(t);
  await demo.stopReceiver();
  assert.equal(fs.existsSync(demo.runtimeFile), false);
});

test('a second receiver for the same working directory is refused while the first runs', async (t) => {
  const demo = await approvalDemo(t);
  const result = await demo.h.admin(['receiver', 'serve', '--port', '0']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already running/);
});

test('a runtime file left by a crashed receiver does not block a new one', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  fs.mkdirSync(path.dirname(demo.runtimeFile), { recursive: true });
  fs.writeFileSync(demo.runtimeFile, JSON.stringify({ url: 'http://127.0.0.1:9', pid: 2 ** 22 + 12345 }));
  await demo.startReceiver();
  assert.equal(JSON.parse(fs.readFileSync(demo.runtimeFile, 'utf8')).url, demo.url);
});

test('a port that is already in use is explained', async (t) => {
  const demo = await approvalDemo(t);
  const port = new URL(demo.url).port;
  const other = path.join(demo.h.root, 'other-workdir');
  fs.mkdirSync(other);
  const result = await demo.h.admin(['receiver', 'serve', '--port', port, '--workdir', other]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already in use/);
  assert.match(result.stderr, /--port/);
});

test('a bad --port is a usage error', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  for (const bad of ['abc', '-1', '70000', '8787.5']) {
    const result = await demo.h.admin(['receiver', 'serve', '--port', bad]);
    assert.equal(result.code, 2, bad);
    assert.match(result.stderr, /--port/);
  }
});

test('a webhook registered while the receiver runs is picked up for the next delivery', async (t) => {
  const demo = await approvalDemo(t, { webhook: null });
  const early = await post(demo.url, { rawBody: '{}', headers: { 'X-Mem9-Event-Id': 'evt_1', 'X-Mem9-Timestamp': '1', 'X-Mem9-Signature': 'v1=00' } });
  assert.equal(early.status, 401, 'refused while nothing is registered');
  assert.equal((await demo.h.admin(['webhook', 'set', '--url', 'https://receiver.invalid/'])).code, 0);
  assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia'))).status, 200);
});

test('starting without any webhook warns that deliveries will be refused', async (t) => {
  const demo = await approvalDemo(t, { webhook: null });
  assert.match(demo.process.output(), /No webhook is registered/);
});

test('the output never shows a signing secret, a chain key or the server address', async (t) => {
  const demo = await approvalDemo(t);
  await post(demo.url, buildDelivery(demo.h, 'lucia', { secret: 'whsec_wrong-secret-value' }));
  await post(demo.url, buildDelivery(demo.h, 'lucia'));
  await waitFor(() => /pending/.test(demo.process.output()) && /refused/.test(demo.process.output()), { what: 'both deliveries to be logged' });
  const state = demo.h.readState();
  const output = demo.process.output();
  for (const secret of [state.serverUrl, ...Object.values(state.chains).map((chain) => chain.key), ...Object.values(state.webhooks).map((webhook) => webhook.secret)]) {
    assert.ok(!output.includes(secret));
  }
});

test('receiver --help covers what it changes and the next step', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  const result = await demo.h.admin(['receiver', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /serve/);
  assert.match(result.stdout, /127\.0\.0\.1/);
  assert.match(result.stdout, /five minutes/);
  const bare = await demo.h.admin(['receiver']);
  assert.equal(bare.code, 2);
});
