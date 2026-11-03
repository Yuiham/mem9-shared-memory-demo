import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chainKeysOf, withHarness } from '../testing/harness.support.mjs';

async function initialized(t, options) {
  const h = await withHarness(t, options);
  const result = await h.admin(['init', '--yes']);
  assert.equal(result.code, 0, result.output);
  return h;
}

const writeState = (h, state) => fs.writeFileSync(path.join(h.workdir, 'state', 'state.json'), JSON.stringify(state));

test('teardown deletes the Chains created directly on mem9, with their management key, and nothing else, and the state keeps the Spaces', async (t) => {
  const h = await initialized(t);
  const before = h.readState();
  assert.ok(Object.values(before.chains).every((chain) => chain.origin === 'mem9'));
  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.equal(h.count('DELETE', /^\/v1alpha2\/space-chains\//), 6);
  assert.ok(h.fake.requestsTo('DELETE', '/v1alpha2/space-chains/').every((request) => request.role === 'management'), 'a Chain is deleted with its management key');
  assert.ok([...h.fake.chains.values()].every((chain) => chain.deleted));
  assert.equal(h.fake.spaceIds().length, 8, 'Spaces stay on the server');
  assert.equal(h.fake.memoriesIn(before.spaces['team-shared'].key, { type: 'pinned' }).length, 3, 'Memories stay');
  const after = h.readState();
  assert.deepEqual(after.chains, {});
  assert.deepEqual(after.spaces, before.spaces);
  assert.match(result.stdout, /Spaces and their Memories remain/);
});

test('teardown lists what it will delete and asks first; without a terminal it needs --yes', async (t) => {
  const h = await initialized(t);
  const result = await h.admin(['teardown']);
  assert.equal(result.code, 2, 'a missing confirmation is a usage error');
  assert.match(result.stdout, /sharedmem-demo-ana/);
  assert.match(result.stderr, /--yes/);
  assert.equal(h.count('DELETE', /^\/v1alpha2\/space-chains\//), 0);
  assert.ok([...h.fake.chains.values()].every((chain) => !chain.deleted));
  assert.equal(Object.keys(h.readState().chains).length, 6);
});

test('a Chain the server no longer knows counts as already deleted', async (t) => {
  const h = await initialized(t);
  h.fake.chainByName('sharedmem-demo-bruno').deleted = true;
  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /already deleted/i);
  assert.deepEqual(h.readState().chains, {});
});

test('after teardown, init reuses the Spaces, creates the Chains again and does not duplicate Seed memories', async (t) => {
  const h = await initialized(t);
  const spaces = h.readState().spaces;
  const oldKeys = chainKeysOf(h.readState());
  assert.equal((await h.admin(['teardown', '--yes'])).code, 0);
  await h.admin(['init', '--example', 'approval', '--yes']).then((result) => assert.equal(result.code, 0, result.output));
  assert.equal(h.count('POST', '/v1alpha1/mem9s'), 8, 'no new Space');
  assert.equal(h.count('POST', '/v1alpha2/space-chains'), 12, 'six new Chains');
  const state = h.readState();
  assert.deepEqual(state.spaces, spaces);
  assert.equal(state.example, 'approval');
  for (const key of chainKeysOf(state)) assert.ok(!oldKeys.includes(key));
  assert.equal(h.fake.memoriesIn(spaces['team-shared'].key, { type: 'pinned' }).length, 3);
  assert.equal(h.fake.memoriesIn(spaces['leadership-shared'].key, { type: 'pinned' }).length, 2);
});

test('teardown with no state is not an error, and its output never shows a key', async (t) => {
  const h = await withHarness(t);
  const empty = await h.admin(['teardown', '--yes']);
  assert.equal(empty.code, 0, empty.output);
  assert.match(empty.stdout, /Nothing to tear down/);
  assert.equal(h.fake.requests.length, 0);

  await h.admin(['init', '--yes']);
  const state = h.readState();
  const result = await h.admin(['teardown', '--yes']);
  for (const key of chainKeysOf(state)) assert.ok(!result.output.includes(key));
  assert.ok(!result.output.includes(h.fake.url));
});

test('teardown leaves a Chain created through the Admin API on mem9, forgets it here and says to delete it in the Console', async (t) => {
  const h = await initialized(t, { withConsole: true });
  const before = h.readState();
  assert.ok(Object.values(before.chains).every((chain) => chain.origin === 'admin-api'));
  const asked = await h.admin(['teardown']);
  assert.equal(asked.code, 2, 'a missing confirmation is a usage error');
  assert.match(asked.stdout, /registered in the Console/);
  assert.match(asked.stdout, /sharedmem-demo-ana/);
  assert.doesNotMatch(asked.stdout, /will delete these Chains on the server/, 'nothing is listed for deletion on the server');
  assert.equal(h.count('DELETE', /^\/v1alpha2\/space-chains\//), 0);

  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.equal(h.count('DELETE', /^\/v1alpha2\/space-chains\//), 0, 'no delete request reaches mem9');
  assert.ok([...h.fake.chains.values()].every((chain) => !chain.deleted), 'every Chain is still there');
  assert.equal(h.console.registrations.length, 6, 'and still registered in the Console');
  for (const chain of Object.values(before.chains)) assert.match(result.stdout, new RegExp(chain.name), `${chain.name} is named`);
  assert.match(result.stdout, /delete (it|them) in the Console/i);
  const after = h.readState();
  assert.deepEqual(after.chains, {}, 'the local record is cleared');
  assert.deepEqual(after.webhooks, {});
  assert.deepEqual(after.spaces, before.spaces);
  const secrets = [...chainKeysOf(before), h.console.adminKey, h.console.projectId, h.console.url, h.fake.url];
  for (const secret of secrets) assert.ok(!result.output.includes(secret) && !asked.output.includes(secret), 'no key, secret or address is printed');
});

test('teardown sorts a mixed state: the direct Chains are deleted on mem9, the Console ones are only forgotten', async (t) => {
  const h = await initialized(t, { withConsole: true });
  const state = h.readState();
  for (const name of ['ana', 'bruno']) state.chains[name].origin = 'mem9';
  writeState(h, state);
  const asked = await h.admin(['teardown']);
  assert.match(asked.stdout, /delete these Chains on the server:\s+- sharedmem-demo-ana\s+- sharedmem-demo-bruno\s/);
  assert.match(asked.stdout, /registered in the Console[^]*sharedmem-demo-carla/);
  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0, result.output);
  const deleted = h.fake.requestsTo('DELETE', '/v1alpha2/space-chains/').map((request) => request.path.split('/').pop());
  assert.deepEqual(deleted.sort(), [state.chains.ana.id, state.chains.bruno.id].sort());
  assert.equal([...h.fake.chains.values()].filter((chain) => chain.deleted).length, 2);
  assert.deepEqual(h.readState().chains, {});
});

test('after teardown of Console Chains, init is refused on the names until they are deleted in the Console', async (t) => {
  const h = await initialized(t, { withConsole: true });
  const names = Object.values(h.readState().chains).map((chain) => chain.name);
  assert.equal((await h.admin(['teardown', '--yes'])).code, 0);
  const refused = await h.admin(['init', '--yes']);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already exists in the Project/);
  assert.ok(names.some((name) => refused.stderr.includes(`"${name}"`)), 'the message names the Chain that is in the way');
  assert.match(refused.stderr, /next: .*delete it in the Console/i);
  for (const registration of [...h.console.registrations]) h.console.deleteRegistration(registration.name);
  const again = await h.admin(['init', '--yes']);
  assert.equal(again.code, 0, again.output);
  assert.equal(Object.keys(h.readState().chains).length, 6);
});

test('teardown --help says what it deletes and what it keeps', async (t) => {
  const h = await withHarness(t, { fake: false });
  const help = await h.admin(['teardown', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /What it changes:/);
  assert.match(help.stdout, /Spaces cannot be deleted/);
  assert.match(help.stdout, /Examples:/);
});
