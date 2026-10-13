import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ANNOUNCEMENT, approvalDemo, buildDelivery, post } from '../testing/approval.support.mjs';
import { withHarness } from '../testing/harness.support.mjs';
import { CandidateStore } from './candidate-store.mjs';

const SECOND = 'Release freeze for checkout and payments begins Friday at 18:00 UTC.';

async function withCandidates(t, texts = [ANNOUNCEMENT]) {
  const demo = await approvalDemo(t);
  for (const text of texts) assert.equal((await post(demo.url, buildDelivery(demo.h, 'lucia', { text }))).status, 200);
  return demo;
}

const teamMemories = (demo) => demo.h.fake.memoriesIn(demo.h.readState().spaces['team-shared'].key, { type: 'pinned' }).filter((memory) => memory.agent_id !== 'seed');

// ---- list ---------------------------------------------------------------------------

test('candidates lists each Candidate with its id, status, Leader and text', async (t) => {
  const demo = await withCandidates(t, [ANNOUNCEMENT, SECOND]);
  const result = await demo.h.admin(['candidates']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /^\s*c1\s+pending\s+lucia\s+real/m);
  assert.match(result.stdout, /^\s*c2\s+pending\s+lucia\s+real/m);
  assert.ok(result.stdout.includes(ANNOUNCEMENT));
  assert.ok(result.stdout.includes(SECOND));
  assert.match(result.stdout, /2 pending/);
  assert.equal((await demo.h.admin(['candidates', 'list'])).stdout, result.stdout, 'list is the default');
});

test('with no Candidates the list says how one appears', async (t) => {
  const h = await withHarness(t);
  assert.equal((await h.admin(['init', '--yes'])).code, 0);
  const result = await h.admin(['candidates']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No Candidates yet/);
  assert.match(result.stdout, /simulate/);
});

test('test Candidates are hidden unless --include-test is given', async (t) => {
  const demo = await withCandidates(t);
  await post(demo.url, buildDelivery(demo.h, 'lucia', { text: SECOND, agentId: 'verify-ab12cd34-W2' }));
  const hidden = await demo.h.admin(['candidates']);
  assert.ok(!hidden.stdout.includes(SECOND));
  assert.match(hidden.stdout, /1 test Candidate is hidden/);
  const all = await demo.h.admin(['candidates', '--include-test']);
  assert.ok(all.stdout.includes(SECOND));
  assert.match(all.stdout, /c2\s+pending\s+lucia\s+test/);
});

// ---- approve ------------------------------------------------------------------------

test('approve writes the text word for word into Team Shared, attributed to the Leader, and records it', async (t) => {
  const demo = await withCandidates(t);
  const result = await demo.h.admin(['candidates', 'approve', 'c1']);
  assert.equal(result.code, 0, result.output);
  const [memory] = teamMemories(demo);
  assert.equal(memory.content, ANNOUNCEMENT);
  assert.equal(memory.agent_id, 'lucia');
  assert.equal(memory.memory_type, 'pinned');
  const [candidate] = demo.candidates().candidates;
  assert.equal(candidate.status, 'approved');
  assert.equal(candidate.memoryId, memory.id);
  assert.ok(candidate.decidedAt);
  const written = demo.h.fake.requestsTo('POST', '/v1alpha2/mem9s/memories').at(-1);
  assert.equal(written.key, demo.h.readState().spaces['team-shared'].key, 'written with the key of Team Shared');
  assert.match((await demo.h.admin(['candidates'])).stdout, /c1\s+approved/);
});

test('an approved announcement is what a Developer\'s Chain finds', async (t) => {
  const demo = await withCandidates(t);
  await demo.h.admin(['candidates', 'approve', 'c1']);
  const seen = await demo.h.admin(['memories', '--as', 'ana']);
  assert.ok(seen.stdout.includes(ANNOUNCEMENT));
});

test('only a pending Candidate can be approved or rejected', async (t) => {
  const demo = await withCandidates(t, [ANNOUNCEMENT, SECOND]);
  assert.equal((await demo.h.admin(['candidates', 'approve', 'c1'])).code, 0);
  const twice = await demo.h.admin(['candidates', 'approve', 'c1']);
  assert.equal(twice.code, 1);
  assert.match(twice.stderr, /already approved/);
  assert.equal(teamMemories(demo).length, 1, 'nothing was written twice');
  assert.equal((await demo.h.admin(['candidates', 'reject', 'c1'])).code, 1);
  assert.equal((await demo.h.admin(['candidates', 'reject', 'c2'])).code, 0);
  const afterReject = await demo.h.admin(['candidates', 'approve', 'c2']);
  assert.equal(afterReject.code, 1);
  assert.match(afterReject.stderr, /already rejected/);
  assert.equal(teamMemories(demo).length, 1, 'a rejected Candidate was never written');
});

test('when the write fails the Candidate stays pending', async (t) => {
  const demo = await withCandidates(t);
  const statePath = path.join(demo.h.workdir, 'state', 'state.json');
  const state = demo.h.readState();
  state.spaces['team-shared'].key = 'a-key-the-server-does-not-know';
  fs.writeFileSync(statePath, JSON.stringify(state));
  const result = await demo.h.admin(['candidates', 'approve', 'c1']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /next:/);
  assert.equal(demo.candidates().candidates[0].status, 'pending');
  assert.equal(teamMemories(demo).length, 0);
});

test('an unknown id is explained, and a missing id is a usage error', async (t) => {
  const demo = await withCandidates(t);
  const unknown = await demo.h.admin(['candidates', 'approve', 'c99']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no Candidate c99/);
  const missing = await demo.h.admin(['candidates', 'approve']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /needs a Candidate id/);
  const extra = await demo.h.admin(['candidates', 'reject', 'c1', 'c2']);
  assert.equal(extra.code, 2);
  const flag = await demo.h.admin(['candidates', 'approve', 'c1', '--include-test']);
  assert.equal(flag.code, 2);
  assert.equal(teamMemories(demo).length, 0);
});

test('an unknown subcommand is a usage error', async (t) => {
  const demo = await withCandidates(t);
  const result = await demo.h.admin(['candidates', 'delete', 'c1']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /approve/);
});

// ---- reject -------------------------------------------------------------------------

test('reject marks the Candidate rejected and writes nothing to the server', async (t) => {
  const demo = await withCandidates(t);
  const before = demo.h.fake.requestsTo('POST', '/v1alpha2/mem9s/memories').length;
  const result = await demo.h.admin(['candidates', 'reject', 'c1']);
  assert.equal(result.code, 0, result.output);
  assert.equal(demo.candidates().candidates[0].status, 'rejected');
  assert.equal(demo.h.fake.requestsTo('POST', '/v1alpha2/mem9s/memories').length, before);
  assert.equal(teamMemories(demo).length, 0);
  assert.match(result.stdout, /^Next step: /m, 'every command ends with a next step');
});

// ---- the Candidates file ------------------------------------------------------------

test('the Candidates file and its backup are readable only by their owner', async (t) => {
  const demo = await withCandidates(t, [ANNOUNCEMENT, SECOND]);
  assert.equal(fs.statSync(demo.candidatesFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${demo.candidatesFile}.bak`).mode & 0o777, 0o600);
  const leftovers = fs.readdirSync(path.dirname(demo.candidatesFile)).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no temporary files remain after atomic writes');
});

test('a Candidates file that is not valid JSON is explained and left alone', async (t) => {
  const demo = await withCandidates(t);
  fs.writeFileSync(demo.candidatesFile, '{ broken');
  const result = await demo.h.admin(['candidates']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not valid JSON/);
  assert.match(result.stderr, /\.bak/);
  assert.equal(fs.readFileSync(demo.candidatesFile, 'utf8'), '{ broken');
});

test('candidates --help covers what each verb changes and the next step', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin(['candidates', '--help']);
  assert.equal(result.code, 0);
  for (const part of ['approve <id>', 'reject <id>', 'word for word', '--include-test', 'Only a pending']) assert.ok(result.stdout.includes(part), part);
});

// ---- the store, as the receiver and the approver use it ------------------------------

test('two stores on one file never undo each other\'s changes', async (t) => {
  const h = await withHarness(t, { fake: false });
  const receiver = new CandidateStore({ workdir: h.workdir });
  const approver = new CandidateStore({ workdir: h.workdir });
  receiver.recordDelivery({ eventId: 'evt_1', candidates: [{ text: 'first' }] });
  // The approver decides the first Candidate while the receiver adds a second one; each
  // change starts from a fresh read, so neither order loses anything.
  receiver.recordDelivery({ eventId: 'evt_2', candidates: [{ text: 'second' }] });
  assert.equal(approver.decide('c1', { status: 'rejected' }).status, 'rejected');
  receiver.recordDelivery({ eventId: 'evt_3', candidates: [{ text: 'third' }] });
  const document = approver.read();
  assert.deepEqual(document.candidates.map((candidate) => [candidate.id, candidate.status]), [['c1', 'rejected'], ['c2', 'pending'], ['c3', 'pending']]);
  assert.deepEqual(document.handledEvents, ['evt_1', 'evt_2', 'evt_3']);
  assert.equal(approver.decide('c1', { status: 'approved' }), null, 'a decided Candidate cannot be decided again');
  assert.equal(approver.decide('c99', { status: 'approved' }), null);
});
