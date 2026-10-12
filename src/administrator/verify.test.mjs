import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ANNOUNCEMENT, approvalDemo } from '../testing/approval.support.mjs';
import { SHIPPED_ROUTING, withHarness } from '../testing/harness.support.mjs';

const MEMORIES = '/v1alpha2/mem9s/memories';

async function demo(t, { args = [], routing = SHIPPED_ROUTING } = {}) {
  const h = await withHarness(t);
  const init = await h.admin(['init', '--yes', ...args]);
  assert.equal(init.code, 0, init.output);
  h.fake.setRouting(routing);
  return h;
}

const resultLine = (output, id) => output.split('\n').find((line) => new RegExp(`^\\s+${id}\\s`).test(line)) ?? '';
const writes = (h) => h.fake.requestsTo('POST', MEMORIES).filter((request) => request.body?.messages);

test('with correct routing every Case passes in the Basic Example and the command succeeds', async (t) => {
  const h = await demo(t);
  const result = await h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /Basic Example/);
  for (const id of ['T1', 'T2', 'T3', 'T4', 'L1', 'L2', 'L3', 'L4', 'W1', 'W2', 'N1', 'N2']) assert.match(resultLine(result.stdout, id), /PASS/, id);
  assert.match(result.stdout, /12 Cases: 12 passed, 0 failed, 0 skipped/);
  assert.match(resultLine(result.stdout, 'T1'), /Personal, Team Shared.*Personal, Team Shared/);
  assert.match(resultLine(result.stdout, 'W1'), /Personal\s+Personal\s+PASS/, 'Basic keeps announcements personal');
});

test('wrong routing is a failure that shows expected against actual, and the exit code is 1', async (t) => {
  const withoutIdempotent = SHIPPED_ROUTING.rules.map((rule) => (/idempotent/.test(String(rule.match)) ? { ...rule, match: /database migrations|outage|feature flag/i } : rule));
  const h = await demo(t, { routing: { rules: withoutIdempotent } });
  const result = await h.admin(['verify']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'T2'), /Personal, Team Shared\s+Personal\s+FAIL/);
  assert.match(resultLine(result.stdout, 'T1'), /PASS/);
  assert.match(result.stdout, /11 passed, 1 failed, 0 skipped/);
  assert.match(result.stdout, /Routing prompt/);
});

test('a copy sent to a Space it should not reach is a failure too', async (t) => {
  const h = await demo(t, { routing: { rules: [...SHIPPED_ROUTING.rules, { match: /dark theme/i, targets: ['team-shared'] }] } });
  const result = await h.admin(['verify']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'N1'), /Personal\s+Personal, Team Shared\s+FAIL/);
});

test('a routing step that fails on the server shows up as a failure even though the write succeeded', async (t) => {
  const h = await demo(t);
  h.fake.failRoutingTo('team-shared');
  const result = await h.admin(['verify']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'T1'), /Personal, Team Shared\s+Personal\s+FAIL/);
  assert.match(resultLine(result.stdout, 'N1'), /PASS/);
});

test('each Case is written through the first Chain of its speaker\'s role under its own verify Agent ID and session, synchronously', async (t) => {
  const h = await demo(t);
  assert.equal((await h.admin(['verify'])).code, 0);
  const state = h.readState();
  const sent = writes(h);
  assert.equal(sent.length, 12);
  const agentIds = sent.map((request) => request.body.agent_id);
  assert.equal(new Set(agentIds).size, 12, 'one Agent ID per Case');
  for (const request of sent) {
    assert.match(request.body.agent_id, /^verify-[0-9a-f]{8}-[A-Za-z0-9]+$/);
    assert.equal(request.body.session_id, request.body.agent_id);
    assert.equal(request.body.sync, true);
    assert.equal(request.header, 'sharedmem');
    const speaker = /-(L|W)\d$/.test(request.body.agent_id) ? 'lucia' : 'ana';
    assert.equal(request.key, state.chains[speaker].key, `${request.body.agent_id} goes through ${speaker}`);
  }
  assert.ok(agentIds.every((id) => !state.participants.some((person) => person.name === id)));
  const second = await h.admin(['verify']);
  assert.equal(second.code, 0, second.output);
  const all = writes(h).map((request) => request.body.agent_id);
  assert.equal(new Set(all).size, 24, 'a second run uses fresh Agent IDs');
});

test('verify removes the Memories it wrote, of every type, and leaves the Seeds', async (t) => {
  const h = await demo(t);
  assert.equal((await h.admin(['verify'])).code, 0);
  const state = h.readState();
  for (const space of Object.values(state.spaces)) {
    const left = h.fake.memoriesIn(space.key).filter((memory) => memory.agent_id.startsWith('verify-'));
    assert.deepEqual(left, [], 'nothing from verify is left');
  }
  assert.equal(h.fake.memoriesIn(state.spaces['team-shared'].key, { type: 'pinned' }).length, 3);
  const spoken = h.fake.memoriesIn(state.spaces.ana.key, { includeDeleted: true }).filter((memory) => memory.agent_id.startsWith('verify-'));
  assert.ok(spoken.some((memory) => memory.memory_type === 'session'), 'session rows were written and then removed');
});

test('--cases replaces the shipped Cases and runs only those, for a spot check', async (t) => {
  const h = await demo(t, { routing: { rules: [{ match: /vacunas|migraciones/i, targets: ['team-shared'] }] } });
  const file = path.join(h.root, 'fresh.json');
  fs.writeFileSync(file, JSON.stringify({ cases: [
    { id: 'ES1', role: 'developer', sentence: 'Siempre ejecutamos las migraciones antes de desplegar.', reaches: { basic: ['personal', 'team-shared'], approval: ['personal', 'team-shared'] } },
    { id: 'PT1', role: 'leader', sentence: 'Eu prefiro responder por escrito.', reaches: { basic: ['personal'], approval: ['personal'] } },
  ] }));
  const result = await h.admin(['verify', '--cases', file]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /2 Cases: 2 passed/);
  assert.equal(writes(h).length, 2);
});

test('an alternative Case file is validated completely before anything is sent', async (t) => {
  const h = await demo(t);
  const requests = h.fake.requests.length;
  const base = { sentence: 'A durable personal fact.', reaches: { basic: ['personal'], approval: ['personal'] } };
  const file = path.join(h.root, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ cases: [
    { id: 'A1', role: 'developer', ...base },
    { id: 'A1', role: 'developer', ...base },
    { id: 'bad id!', role: 'developer', ...base },
    { id: 'B1', role: 'manager', ...base },
    { id: 'C1', role: 'leader', sentence: '', reaches: { basic: ['personal'], approval: ['personal'] } },
    { id: 'D1', role: 'leader', sentence: 'x', reaches: { basic: ['personal', 'finance-shared'], approval: ['personal'] } },
    { id: 'E1', role: 'leader', sentence: 'x', reaches: { basic: ['personal', 'candidate'], approval: ['personal'] } },
    { id: 'F1', role: 'leader', sentence: 'x', reaches: { basic: ['personal'] } },
  ] }));
  const result = await h.admin(['verify', '--cases', file]);
  assert.equal(result.code, 1);
  for (const expected of [/"A1" is used more than once/, /"bad id!" may only use letters, digits and hyphens/, /"B1" needs the role "leader" or "developer"/, /"C1" has no sentence/, /"D1".*finance-shared/, /"E1".*candidate.*Approval/, /"F1".*approval/]) {
    assert.match(result.stderr, expected);
  }
  assert.equal(h.fake.requests.length, requests, 'nothing was sent');
  const missing = await h.admin(['verify', '--cases', path.join(h.root, 'absent.json')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Case file does not exist/);
});

test('in the Approval Example, Cases that need a webhook are skipped with a notice while no webhook is registered', async (t) => {
  const h = await demo(t, { args: ['--example', 'approval'] });
  const result = await h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(resultLine(result.stdout, 'W1'), /SKIP/);
  assert.match(resultLine(result.stdout, 'W2'), /SKIP/);
  assert.match(result.stdout, /10 passed, 0 failed, 2 skipped/);
  assert.match(result.stdout, /no webhook is registered/i);
  assert.equal(writes(h).length, 10, 'skipped Cases are not sent');
});

test('verify needs init first, and says so', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['verify']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /next: Run `sharedmem-admin init`/);
});

test('verify never prints a key or the server address, and its help says what it writes and removes', async (t) => {
  const h = await demo(t);
  const state = h.readState();
  const result = await h.admin(['verify']);
  for (const secret of [...Object.values(state.spaces).map((space) => space.key), ...Object.values(state.chains).map((chain) => chain.key), h.fake.url]) {
    assert.ok(!result.output.includes(secret));
  }
  const help = await h.admin(['verify', '--help']);
  assert.match(help.stdout, /What it changes:/);
  assert.match(help.stdout, /removes/i);
  assert.match(help.stdout, /--cases/);
});

// ---- Approval Example ---------------------------------------------------------------

const WITHOUT_ANNOUNCEMENTS = { rules: SHIPPED_ROUTING.rules.filter((rule) => !/two reviewers/.test(String(rule.match))) };
const REAL_LOOKING = 'https://receiver.example.com/hooks';

test('Approval, no receiver: the held-back Cases pass on a recorded delivery and nothing in Team Shared', async (t) => {
  const { h } = await approvalDemo(t, { receiver: false });
  const result = await h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /Approval Example/);
  for (const id of ['W1', 'W2']) {
    assert.match(resultLine(result.stdout, id), /Personal\s+Personal\s+PASS/, id);
    assert.match(result.stdout, new RegExp(`${id}: delivery recorded; start the receiver`));
  }
  assert.match(result.stdout, /12 Cases: 12 passed, 0 failed, 0 skipped/);
  const deliveries = h.fake.deliveries.filter((delivery) => delivery.record.event_type === 'space_chain.fact_routed' && delivery.envelope.data.webhook_only);
  assert.equal(deliveries.length, 2, 'one held-back delivery per W Case');
  const team = h.readState().spaces['team-shared'].key;
  assert.deepEqual(h.fake.memoriesIn(team).filter((memory) => memory.agent_id.startsWith('verify-')), []);
});

test('Approval, receiver running: the matching Candidate must arrive, and it is a test Candidate', async (t) => {
  const demo = await approvalDemo(t, { webhook: REAL_LOOKING });
  const result = await demo.h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /W1: delivery recorded and the Candidate arrived/);
  const candidates = demo.candidates().candidates;
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.test && candidate.agentId.startsWith('verify-') && candidate.status === 'pending'));
  assert.deepEqual(candidates.map((candidate) => candidate.text).sort(), ['Release freeze for checkout and payments begins Friday at 18:00 UTC and ends Monday morning.', 'Starting Monday, all production deploys require two reviewers.'].sort());
  const listing = await demo.h.admin(['candidates']);
  assert.match(listing.stdout, /No Candidates yet/, 'test Candidates are hidden from the default listing');
  assert.match((await demo.h.admin(['candidates', '--include-test'])).stdout, /c1\s+pending\s+lucia\s+test/);
});

test('Approval, receiver running but the Candidate never arrives: a failure that says what to check', async (t) => {
  const demo = await approvalDemo(t, { webhook: REAL_LOOKING });
  demo.h.fake.setReceiver(null);
  const result = await demo.h.admin(['verify', '--wait', '1']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'W1'), /Personal\s+Personal\s+FAIL/);
  assert.match(result.stdout, /W1: the server recorded a delivery, but no Candidate reached the receiver within 1 seconds/);
  assert.match(resultLine(result.stdout, 'T1'), /PASS/);
});

test('Approval, receiver running with a placeholder address: the Candidate check is skipped with a notice', async (t) => {
  const demo = await approvalDemo(t);
  demo.h.fake.setReceiver(null); // the real server can never reach a placeholder address
  const result = await demo.h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /W1: delivery recorded; the Candidate check was skipped because the webhook address is a placeholder/);
  assert.equal(demo.candidates().candidates.length, 0);
});

test('Approval, no delivery recorded: the held-back Cases fail', async (t) => {
  const { h } = await approvalDemo(t, { receiver: false });
  h.fake.setRouting(WITHOUT_ANNOUNCEMENTS);
  const result = await h.admin(['verify', '--wait', '1']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'W1'), /FAIL/);
  assert.match(result.stdout, /W1: the server recorded no routed-fact delivery for this Chain within 1 seconds/);
  assert.match(result.stdout, /10 passed, 2 failed, 0 skipped/);
});

test('Approval: a delivery from before the write does not count', async (t) => {
  const { h } = await approvalDemo(t, { receiver: false });
  assert.equal(await h.say('lucia', ANNOUNCEMENT), 200, 'an earlier announcement leaves a delivery record behind');
  h.fake.setRouting(WITHOUT_ANNOUNCEMENTS);
  const result = await h.admin(['verify', '--wait', '0']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'W1'), /FAIL/);
});

test('Approval: a copy that reaches Team Shared because the node is not webhook-only is a failure', async (t) => {
  const { h } = await approvalDemo(t, { receiver: false });
  h.fake.chainByName('sharedmem-demo-lucia').nodes[2].routing_policy_webhook_only = false;
  const result = await h.admin(['verify', '--wait', '0']);
  assert.equal(result.code, 1);
  assert.match(resultLine(result.stdout, 'W1'), /Personal\s+Personal, Team Shared\s+FAIL/);
});

test('Approval: the Cases are skipped when the Leader they use has no webhook, even if another Leader has one', async (t) => {
  const { h } = await approvalDemo(t, { receiver: false });
  const file = path.join(h.workdir, 'state', 'state.json');
  const state = h.readState();
  delete state.webhooks.lucia;
  fs.writeFileSync(file, JSON.stringify(state));
  const result = await h.admin(['verify']);
  assert.equal(result.code, 0, result.output);
  assert.match(resultLine(result.stdout, 'W1'), /SKIP/);
  assert.match(result.stdout, /no webhook is registered for the Leader/);
});

test('--wait must be a number of seconds', async (t) => {
  const h = await demo(t);
  for (const bad of ['soon', '-1', '']) {
    const result = await h.admin(['verify', '--wait', bad]);
    assert.equal(result.code, 2, JSON.stringify(bad));
    assert.match(result.stderr, /--wait/);
  }
  const help = await h.admin(['verify', '--help']);
  assert.match(help.stdout, /--wait <seconds>/);
  assert.match(help.stdout, /Candidate/);
});
