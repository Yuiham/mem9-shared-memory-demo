import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FakeMem9 } from '../testing/fake-mem9.support.mjs';
import { SMALL_CAST, withHarness } from '../testing/harness.support.mjs';

const PROVISION = '/v1alpha1/mem9s';
const CREATE_CHAIN = '/v1alpha2/space-chains';
const nodesOf = (fake, name) => fake.chainByName(`sharedmem-demo-${name}`).nodes;
const policyOf = (node) => ({ enabled: node.routing_policy_enabled, webhookOnly: node.routing_policy_webhook_only, prompt: node.routing_policy_prompt });
const readPrompt = (name) => fs.readFileSync(new URL(`../../config/routing-prompts/${name}.txt`, import.meta.url), 'utf8').trim();

async function initialized(t, args = [], options) {
  const h = await withHarness(t, options);
  const result = await h.admin(['init', '--yes', ...args]);
  assert.equal(result.code, 0, result.output);
  return { h, result };
}

test('init builds the default cast: eight Spaces, six Chains, the shared nodes and the Basic policies', async (t) => {
  const { h } = await initialized(t);
  const fake = h.fake;
  assert.equal(fake.spaceIds().length, 8);
  assert.equal(h.count('POST', CREATE_CHAIN), 6);
  for (const name of ['ana', 'bruno', 'carla', 'diego']) {
    const nodes = nodesOf(fake, name);
    assert.deepEqual(nodes.map((node) => node.external_space_id), ['', 'team-shared']);
    assert.deepEqual(nodes.map((node) => node.display_name), ['Personal', 'Team Shared']);
    assert.deepEqual(policyOf(nodes[1]), { enabled: true, webhookOnly: false, prompt: readPrompt('team-shared-auto') });
  }
  for (const name of ['lucia', 'marco']) {
    const nodes = nodesOf(fake, name);
    assert.deepEqual(nodes.map((node) => node.external_space_id), ['', 'leadership-shared', 'team-shared']);
    assert.deepEqual(nodes.map((node) => node.display_name), ['Personal', 'Leadership Shared', 'Team Shared']);
    assert.deepEqual(policyOf(nodes[1]), { enabled: true, webhookOnly: false, prompt: readPrompt('leadership-shared-auto') });
    assert.deepEqual(policyOf(nodes[2]), { enabled: false, webhookOnly: false, prompt: '' }, 'Basic: Team Shared is read-only for Leaders');
    assert.equal(nodes[0].routing_policy_enabled, false);
  }
  assert.equal(new Set(fake.chainByName('sharedmem-demo-ana').nodes.map((node) => node.tenant_id)).size, 2);
  const state = h.readState();
  assert.equal(nodesOf(fake, 'ana')[1].tenant_id, state.spaces['team-shared'].key, 'every Chain points at the same Team Shared Space');
  assert.equal(nodesOf(fake, 'lucia')[1].tenant_id, state.spaces['leadership-shared'].key);
});

test('init writes the five Seed memories as pinned memories under the seed Agent ID, and only once', async (t) => {
  const { h } = await initialized(t);
  const state = h.readState();
  const team = h.fake.memoriesIn(state.spaces['team-shared'].key, { type: 'pinned' });
  const leadership = h.fake.memoriesIn(state.spaces['leadership-shared'].key, { type: 'pinned' });
  assert.equal(team.length, 3);
  assert.equal(leadership.length, 2);
  for (const memory of [...team, ...leadership]) {
    assert.equal(memory.agent_id, 'seed');
    assert.deepEqual(memory.tags, ['seed']);
  }
  assert.ok(team.some((memory) => memory.content === 'Our default branch is main, and every pull request needs one approving review before it is merged.'));
  assert.ok(h.fake.requestsTo('POST', '/v1alpha2/mem9s/memories').every((request) => request.key && !request.key.startsWith('chain_')), 'seeds are written through each Space key');
  assert.equal((await h.admin(['init', '--yes'])).code, 0);
  assert.equal(h.fake.memoriesIn(state.spaces['team-shared'].key, { type: 'pinned' }).length, 3);
  assert.equal(h.fake.memoriesIn(state.spaces['leadership-shared'].key, { type: 'pinned' }).length, 2);
});

test('the state file is owner-only with an owner-only backup, and no output shows a key or the server address', async (t) => {
  const { h, result } = await initialized(t);
  const file = path.join(h.workdir, 'state', 'state.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${file}.bak`).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const state = h.readState();
  const secrets = [...Object.values(state.spaces).map((space) => space.key), ...Object.values(state.chains).map((chain) => chain.key), h.fake.url, new URL(h.fake.url).host];
  assert.ok(secrets.length >= 14);
  for (const secret of secrets) assert.ok(!result.output.includes(secret), 'output leaked a secret');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')), [], 'no temporary files are left behind');
});

test('init shows its plan, changes nothing without a terminal and --yes, and says which flag to pass', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['init']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Plan/);
  assert.match(result.stdout, /8 Spaces/);
  assert.match(result.stderr, /--yes/);
  assert.equal(h.fake.requests.length, 0, 'no server call before confirmation');
  assert.equal(fs.existsSync(path.join(h.workdir, 'state')), false);
});

test('re-running init changes nothing and keeps every key', async (t) => {
  const { h } = await initialized(t);
  const before = h.readState();
  const calls = h.fake.requests.length;
  const nodePuts = h.count('PUT', /\/nodes$/);
  const policyPuts = h.count('PUT', /routing-policy$/);
  const second = await h.admin(['init', '--yes']);
  assert.equal(second.code, 0, second.output);
  assert.equal(h.count('POST', PROVISION), 8);
  assert.equal(h.count('POST', CREATE_CHAIN), 6);
  assert.equal(h.count('PUT', /\/nodes$/), nodePuts, 'no node was replaced again');
  assert.equal(h.count('PUT', /routing-policy$/), policyPuts, 'no policy was rewritten again');
  assert.deepEqual(h.readState(), before);
  assert.ok(h.fake.requests.length > calls, 'the run did check the server');
  assert.match(second.stdout, /: nodes unchanged, 0 routing policies updated/);
  assert.ok(!second.stdout.includes('policys'), 'the plural is spelled correctly');
});

test('switching Examples changes only the Leaders\' Team Shared node and keeps every chain key', async (t) => {
  const { h } = await initialized(t);
  const before = h.readState();
  const nodePuts = h.count('PUT', /\/nodes$/);
  const switched = await h.admin(['init', '--example', 'approval', '--yes']);
  assert.equal(switched.code, 0, switched.output);
  assert.equal(h.count('PUT', /\/nodes$/), nodePuts, 'nodes are not replaced');
  for (const name of ['lucia', 'marco']) {
    assert.deepEqual(policyOf(nodesOf(h.fake, name)[2]), { enabled: true, webhookOnly: true, prompt: readPrompt('team-shared-approval') });
    assert.equal(policyOf(nodesOf(h.fake, name)[1]).prompt, readPrompt('leadership-shared-auto'));
  }
  for (const name of ['ana', 'bruno', 'carla', 'diego']) assert.equal(policyOf(nodesOf(h.fake, name)[1]).prompt, readPrompt('team-shared-auto'));
  const after = h.readState();
  assert.equal(after.example, 'approval');
  for (const name of Object.keys(before.chains)) assert.equal(after.chains[name].key, before.chains[name].key);

  const kept = await h.admin(['init', '--yes']);
  assert.equal(kept.code, 0, kept.output);
  assert.equal(h.readState().example, 'approval', 'a re-run without --example keeps the recorded Example');
  assert.equal(policyOf(nodesOf(h.fake, 'lucia')[2]).webhookOnly, true);

  const back = await h.admin(['init', '--example', 'basic', '--yes']);
  assert.equal(back.code, 0, back.output);
  assert.deepEqual(policyOf(nodesOf(h.fake, 'lucia')[2]), { enabled: false, webhookOnly: false, prompt: '' });
});

test('applying Approval without a registered webhook warns that announcements would be lost', async (t) => {
  const h = await withHarness(t);
  const approval = await h.admin(['init', '--example', 'approval', '--yes']);
  assert.equal(approval.code, 0, approval.output);
  assert.match(approval.stderr, /warning: .*Approval.*no webhook/i);
  const basic = await withHarness(t);
  const quiet = await basic.admin(['init', '--yes']);
  assert.doesNotMatch(quiet.stderr, /webhook/i);
});

test('an unknown Example is a usage error before anything is sent', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['init', '--example', 'fancy', '--yes']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /basic or approval/);
  assert.equal(h.fake.requests.length, 0);
});

test('a Routing prompt over the server limit is rejected before any server call', async (t) => {
  const h = await withHarness(t);
  const copy = h.copyProgram();
  fs.writeFileSync(path.join(copy.dir, 'config', 'routing-prompts', 'team-shared-auto.txt'), 'x'.repeat(1201));
  const result = await h.admin(['init', '--yes'], { launcher: copy.launcher });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /team-shared-auto/);
  assert.match(result.stderr, /1,?200/);
  assert.equal(h.fake.requests.length, 0);
});

test('a cast with a problem is rejected with every problem listed and nothing sent', async (t) => {
  const h = await withHarness(t);
  const cast = h.writeCast([
    { name: 'Lucia', role: 'leader' },
    { name: 'seed', role: 'developer' },
    { name: 'ana', role: 'developer' },
    { name: 'ana', role: 'developer' },
    { name: 'verify-x', role: 'developer' },
    { name: 'a'.repeat(101), role: 'developer' },
    { name: 'bob', role: 'manager' },
  ]);
  const result = await h.admin(['init', '--cast', cast, '--yes']);
  assert.equal(result.code, 1);
  for (const expected of [/lowercase letters, digits and hyphens/, /"seed" is reserved/, /"verify-x" is reserved/, /"ana" appears more than once/, /longer than 100/, /role "leader" or "developer"/]) {
    assert.match(result.stderr, expected);
  }
  assert.equal(h.fake.requests.length, 0);
  const noLeader = h.writeCast([{ name: 'ana', role: 'developer' }], 'no-leader.json');
  const second = await h.admin(['init', '--cast', noLeader, '--yes']);
  assert.match(second.stderr, /at least one Leader/);
  const missing = await h.admin(['init', '--cast', path.join(h.root, 'absent.json'), '--yes']);
  assert.match(missing.stderr, /cast file does not exist/);
});

test('a failure after the first creating calls leaves what was created recorded, and a re-run resumes', async (t) => {
  const h = await withHarness(t);
  const cast = h.writeCast(SMALL_CAST);
  h.fake.injectFailure({ after: 2 });
  const failed = await h.admin(['init', '--cast', cast, '--yes']);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /next: .*again/);
  assert.equal(Object.keys(h.readState().spaces).length, 2, 'the Spaces created before the failure are recorded');
  h.fake.clearFailure();
  const resumed = await h.admin(['init', '--cast', cast, '--yes']);
  assert.equal(resumed.code, 0, resumed.output);
  assert.equal(h.fake.spaceIds().length, 4, 'no Space was duplicated');
  assert.equal(h.count('POST', CREATE_CHAIN), 2);
});

test('a failure while creating a Chain is resumed without a second Chain', async (t) => {
  const h = await withHarness(t);
  const cast = h.writeCast(SMALL_CAST);
  h.fake.injectFailure({ after: 5 });
  const failed = await h.admin(['init', '--cast', cast, '--yes']);
  assert.equal(failed.code, 1);
  assert.equal(Object.keys(h.readState().chains).length, 1);
  h.fake.clearFailure();
  assert.equal((await h.admin(['init', '--cast', cast, '--yes'])).code, 0);
  assert.equal(h.fake.chains.size, 2);
  assert.equal(nodesOf(h.fake, 'ana').length, 2);
  assert.equal(nodesOf(h.fake, 'lucia').length, 3);
});

test('every command refuses to use a state that belongs to a different server address', async (t) => {
  const { h } = await initialized(t);
  const other = await new FakeMem9().start();
  t.after(() => other.stop());
  const result = await h.admin(['init', '--yes'], { env: h.env({ SHAREDMEM_API_URL: other.url }) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /different server address/);
  assert.match(result.stderr, /next:/);
  assert.equal(other.requests.length, 0);
});

test('a Chain the server no longer knows is created again on the same Spaces', async (t) => {
  const { h } = await initialized(t);
  const before = h.readState();
  h.fake.chainByName('sharedmem-demo-ana').deleted = true;
  const result = await h.admin(['init', '--yes']);
  assert.equal(result.code, 0, result.output);
  const after = h.readState();
  assert.notEqual(after.chains.ana.key, before.chains.ana.key);
  assert.equal(after.chains.ana.id === before.chains.ana.id, false);
  assert.equal(after.spaces.ana.key, before.spaces.ana.key);
  assert.equal(h.fake.spaceIds().length, 8);
  assert.equal(nodesOf(h.fake, 'ana').length, 2, 'the new Chain got its nodes');
  assert.match(result.stdout, /created again|new Chain/i);
});

test('a cast that drops a participant is refused until teardown has been run', async (t) => {
  const { h } = await initialized(t);
  const smaller = h.writeCast(SMALL_CAST);
  const result = await h.admin(['init', '--cast', smaller, '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /marco/);
  assert.match(result.stderr, /teardown/);
});

test('a missing environment file and variable is a friendly error', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin(['init', '--yes'], { env: h.env({ SHAREDMEM_API_URL: undefined }) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /SHAREDMEM_API_URL is not set/);
  assert.match(result.stderr, /next: Copy \.env\.example to \.env/);
});

test('the environment file in the working directory supplies the address, and the process environment wins over it', async (t) => {
  const h = await withHarness(t);
  fs.writeFileSync(path.join(h.workdir, '.env'), `SHAREDMEM_API_URL=${h.fake.url}\n`);
  const fromFile = await h.admin(['init', '--yes'], { env: h.env({ SHAREDMEM_API_URL: undefined }) });
  assert.equal(fromFile.code, 0, fromFile.output);
  assert.ok(h.fake.requests.length > 0);
  const overridden = await h.admin(['init', '--yes'], { env: h.env({ SHAREDMEM_API_URL: 'http://127.0.0.1:1' }) });
  assert.equal(overridden.code, 1);
  assert.match(overridden.stderr, /different server address/, 'the variable beat the file, so the state no longer matched');
});

test('an unreachable server gets a message with a next step', async (t) => {
  const h = await withHarness(t);
  const env = h.env();
  await h.fake.stop();
  const result = await h.admin(['init', '--yes'], { env });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot reach the mem9 server/);
  assert.match(result.stderr, /next:/);
});

test('--workdir and SHAREDMEM_WORKDIR decide where the state lives', async (t) => {
  const h = await withHarness(t);
  const elsewhere = path.join(h.root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const result = await h.admin(['init', '--yes', '--workdir', elsewhere]);
  assert.equal(result.code, 0, result.output);
  assert.ok(fs.existsSync(path.join(elsewhere, 'state', 'state.json')));
  assert.equal(fs.existsSync(path.join(h.workdir, 'state')), false);
});

test('init --help says what it changes, and an unknown option is a usage error', async (t) => {
  const h = await withHarness(t, { fake: false });
  const help = await h.admin(['init', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: sharedmem-admin init/);
  assert.match(help.stdout, /What it changes:/);
  assert.match(help.stdout, /Examples:/);
  assert.match(help.stdout, /Next step:/);
  const unknown = await h.admin(['init', '--bogus']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown option: --bogus/);
});

// ---- found by reviewing the finished work ----------------------------------------

test('a changed Routing prompt is applied to the Chains that use it, and nothing else is rewritten', async (t) => {
  const h = await withHarness(t);
  const copy = h.copyProgram();
  const first = await h.admin(['init', '--yes'], { launcher: copy.launcher });
  assert.equal(first.code, 0, first.output);
  const nodePuts = h.count('PUT', /\/nodes$/);
  const policyPuts = h.count('PUT', /routing-policy$/);
  fs.writeFileSync(path.join(copy.dir, 'config', 'routing-prompts', 'team-shared-auto.txt'), 'A new prompt for Team Shared.\n');
  const second = await h.admin(['init', '--yes'], { launcher: copy.launcher });
  assert.equal(second.code, 0, second.output);
  assert.equal(h.count('PUT', /\/nodes$/), nodePuts, 'no node was replaced');
  assert.equal(h.count('PUT', /routing-policy$/), policyPuts + 4, 'the four Developers use the Team Shared prompt');
  for (const name of ['ana', 'bruno', 'carla', 'diego']) assert.equal(nodesOf(h.fake, name)[1].routing_policy_prompt, 'A new prompt for Team Shared.', name);
  assert.equal(nodesOf(h.fake, 'lucia')[1].routing_policy_prompt, readPrompt('leadership-shared-auto'), 'the Leaders\' prompt is untouched');
  assert.match(second.stdout, /ana: nodes unchanged, 1 routing policy updated/);
});

test('nodes that drifted on the server are set again together with their policies, and the state follows the new node ids', async (t) => {
  const { h } = await initialized(t);
  const before = h.readState();
  nodesOf(h.fake, 'ana')[1].display_name = 'Renamed';
  const nodePuts = h.count('PUT', /\/nodes$/);
  const second = await h.admin(['init', '--yes']);
  assert.equal(second.code, 0, second.output);
  assert.equal(h.count('PUT', /\/nodes$/), nodePuts + 1, 'only the drifted Chain');
  assert.equal(nodesOf(h.fake, 'ana')[1].display_name, 'Team Shared');
  assert.deepEqual(policyOf(nodesOf(h.fake, 'ana')[1]), { enabled: true, webhookOnly: false, prompt: readPrompt('team-shared-auto') });
  const after = h.readState();
  assert.equal(after.chains.ana.nodes[1].id, nodesOf(h.fake, 'ana')[1].id);
  assert.notEqual(after.chains.ana.nodes[1].id, before.chains.ana.nodes[1].id);
  assert.equal(after.chains.ana.key, before.chains.ana.key);
});

test('a Routing prompt of exactly the server limit is accepted', async (t) => {
  const h = await withHarness(t);
  const copy = h.copyProgram();
  fs.writeFileSync(path.join(copy.dir, 'config', 'routing-prompts', 'team-shared-auto.txt'), 'x'.repeat(1200));
  const result = await h.admin(['init', '--yes'], { launcher: copy.launcher });
  assert.equal(result.code, 0, result.output);
  assert.equal(nodesOf(h.fake, 'ana')[1].routing_policy_prompt.length, 1200);
});

test('a participant name of exactly 100 characters is accepted', async (t) => {
  const h = await withHarness(t);
  const longest = 'a'.repeat(100);
  const cast = h.writeCast([{ name: 'lucia', role: 'leader' }, { name: longest, role: 'developer' }]);
  const result = await h.admin(['init', '--cast', cast, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.ok(h.readState().chains[longest]);
});

test('a state file that is not valid JSON is refused by every command and left untouched', async (t) => {
  const { h } = await initialized(t);
  const file = path.join(h.workdir, 'state', 'state.json');
  fs.writeFileSync(file, '{ broken');
  for (const args of [['init', '--yes'], ['memories'], ['export'], ['verify'], ['teardown', '--yes']]) {
    const result = await h.admin(args);
    assert.equal(result.code, 1, args[0]);
    assert.match(result.stderr, /not valid JSON/, args[0]);
    assert.match(result.stderr, /\.bak/, `${args[0]} names the backup`);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('a state file of the wrong version is refused with a next step', async (t) => {
  const { h } = await initialized(t);
  const file = path.join(h.workdir, 'state', 'state.json');
  fs.writeFileSync(file, JSON.stringify({ ...h.readState(), version: 99 }));
  const result = await h.admin(['init', '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /version 99/);
  assert.match(result.stderr, /next:/);
});
