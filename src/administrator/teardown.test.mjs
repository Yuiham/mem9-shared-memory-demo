import assert from 'node:assert/strict';
import test from 'node:test';
import { withHarness } from '../testing/harness.support.mjs';

async function initialized(t) {
  const h = await withHarness(t);
  const result = await h.admin(['init', '--yes']);
  assert.equal(result.code, 0, result.output);
  return h;
}

test('teardown deletes the Chains and nothing else, and the state keeps the Spaces', async (t) => {
  const h = await initialized(t);
  const before = h.readState();
  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.equal(h.count('DELETE', /^\/v1alpha2\/space-chains\//), 6);
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
  const oldKeys = Object.values(h.readState().chains).map((chain) => chain.key);
  assert.equal((await h.admin(['teardown', '--yes'])).code, 0);
  await h.admin(['init', '--example', 'approval', '--yes']).then((result) => assert.equal(result.code, 0, result.output));
  assert.equal(h.count('POST', '/v1alpha1/mem9s'), 8, 'no new Space');
  assert.equal(h.count('POST', '/v1alpha2/space-chains'), 12, 'six new Chains');
  const state = h.readState();
  assert.deepEqual(state.spaces, spaces);
  assert.equal(state.example, 'approval');
  for (const chain of Object.values(state.chains)) assert.ok(!oldKeys.includes(chain.key));
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
  for (const chain of Object.values(state.chains)) assert.ok(!result.output.includes(chain.key));
  assert.ok(!result.output.includes(h.fake.url));
});

test('teardown --help says what it deletes and what it keeps', async (t) => {
  const h = await withHarness(t, { fake: false });
  const help = await h.admin(['teardown', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /What it changes:/);
  assert.match(help.stdout, /Spaces cannot be deleted/);
  assert.match(help.stdout, /Examples:/);
});
