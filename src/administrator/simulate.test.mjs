import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { ANNOUNCEMENT, approvalDemo } from '../testing/approval.support.mjs';

const simulate = (demo, args = ['--leader', 'lucia', '--text', ANNOUNCEMENT]) => demo.h.admin(['simulate', ...args]);

test('simulate creates a pending Candidate marked as simulated, attributed to the named Leader', async (t) => {
  const demo = await approvalDemo(t);
  const result = await simulate(demo, ['--leader', 'marco', '--text', ANNOUNCEMENT]);
  assert.equal(result.code, 0, result.output);
  const [candidate] = demo.candidates().candidates;
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.text, ANNOUNCEMENT);
  assert.equal(candidate.leader, 'marco');
  assert.equal(candidate.simulated, true);
  assert.equal(candidate.test, false);
  assert.match(result.stdout, /Candidate c1/);
  assert.match(result.stdout, /simulated/);
  assert.match((await demo.h.admin(['candidates'])).stdout, /c1\s+pending\s+marco\s+simulated/);
});

test('the receiver checks a simulated delivery exactly as it checks a real one', async (t) => {
  const demo = await approvalDemo(t);
  const state = demo.h.readState();
  state.webhooks.lucia.secret = 'whsec_a-secret-the-receiver-does-not-use';
  // The receiver reads the same state, so tamper with it only for the signing side: run
  // the receiver against the real secret and simulate against a different one.
  const other = path.join(demo.h.root, 'second-workdir');
  fs.mkdirSync(path.join(other, 'state'), { recursive: true });
  fs.writeFileSync(path.join(other, 'state', 'state.json'), JSON.stringify(state));
  fs.copyFileSync(demo.runtimeFile, path.join(other, 'state', 'receiver.json'));
  const result = await demo.h.admin(['simulate', '--workdir', other, '--leader', 'lucia', '--text', ANNOUNCEMENT]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused the simulated delivery \(401\)/);
  assert.match(result.stderr, /signature/);
  assert.equal(demo.candidates().candidates.length, 0);
});

test('an approved simulated Candidate reaches Team Shared like any other', async (t) => {
  const demo = await approvalDemo(t);
  assert.equal((await simulate(demo)).code, 0);
  assert.equal((await demo.h.admin(['candidates', 'approve', 'c1'])).code, 0);
  assert.ok((await demo.h.admin(['memories', '--space', 'team-shared'])).stdout.includes(ANNOUNCEMENT));
});

test('simulate sends the same text again as a new delivery, never as a duplicate', async (t) => {
  const demo = await approvalDemo(t);
  await simulate(demo);
  await simulate(demo);
  assert.equal(demo.candidates().candidates.length, 2);
});

test('simulate needs --leader and --text', async (t) => {
  const demo = await approvalDemo(t);
  const noLeader = await simulate(demo, ['--text', ANNOUNCEMENT]);
  assert.equal(noLeader.code, 2);
  assert.match(noLeader.stderr, /--leader/);
  const noText = await simulate(demo, ['--leader', 'lucia']);
  assert.equal(noText.code, 2);
  assert.match(noText.stderr, /--text/);
  assert.equal(demo.candidates().candidates.length, 0);
});

test('simulate refuses a name that is not a Leader with a Chain, and lists the Leaders', async (t) => {
  const demo = await approvalDemo(t);
  for (const name of ['ana', 'nobody']) {
    const result = await simulate(demo, ['--leader', name, '--text', ANNOUNCEMENT]);
    assert.equal(result.code, 1, name);
    assert.match(result.stderr, /lucia, marco/);
  }
});

test('simulate refuses without a registered endpoint and says how to register a placeholder', async (t) => {
  const demo = await approvalDemo(t, { webhook: null });
  const result = await simulate(demo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /webhook set --url https:\/\/receiver\.invalid\//, 'the next step shows the address to type');
  assert.match(result.stderr, /placeholder/);
});

test('simulate refuses when no receiver is running', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  const result = await simulate(demo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /receiver is not running/);
  assert.match(result.stderr, /receiver serve/);
});

test('simulate does not trust a runtime file whose process is gone', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  fs.mkdirSync(path.dirname(demo.runtimeFile), { recursive: true });
  fs.writeFileSync(demo.runtimeFile, JSON.stringify({ url: 'http://127.0.0.1:9', pid: 2 ** 22 + 12345 }));
  const result = await simulate(demo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /receiver is not running/);
});

test('simulate explains a receiver that is registered but does not answer', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  fs.mkdirSync(path.dirname(demo.runtimeFile), { recursive: true });
  // This very process is alive, but nothing listens on the port.
  fs.writeFileSync(demo.runtimeFile, JSON.stringify({ url: 'http://127.0.0.1:9', pid: process.pid }));
  const result = await simulate(demo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not answer/);
  assert.match(result.stderr, /receiver serve/);
});

test('simulate reports the reason when the receiver refuses', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  const refuser = http.createServer((request, response) => {
    request.resume();
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'busy right now' }));
  });
  await new Promise((resolve) => refuser.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { refuser.closeAllConnections(); refuser.close(resolve); }));
  fs.mkdirSync(path.dirname(demo.runtimeFile), { recursive: true });
  fs.writeFileSync(demo.runtimeFile, JSON.stringify({ url: `http://127.0.0.1:${refuser.address().port}`, pid: process.pid }));
  const result = await simulate(demo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\(503\): busy right now/);
});

test('simulate never prints the signing secret', async (t) => {
  const demo = await approvalDemo(t);
  const result = await simulate(demo);
  for (const webhook of Object.values(demo.h.readState().webhooks)) assert.ok(!result.output.includes(webhook.secret));
});

test('simulate --help covers what it changes and the next step', async (t) => {
  const demo = await approvalDemo(t, { receiver: false });
  const result = await demo.h.admin(['simulate', '--help']);
  assert.equal(result.code, 0);
  for (const part of ['--leader', '--text', 'simulated', 'placeholder', 'Next step:']) assert.ok(result.stdout.includes(part), part);
});
