// The fake Console stands in for the mem9 Admin API in every offline test, so its own
// behavior is pinned here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeConsole } from './fake-console.support.mjs';
import { FakeMem9 } from './fake-mem9.support.mjs';

async function startPair(t, options) {
  const mem9 = await new FakeMem9().start();
  const fakeConsole = await new FakeConsole({ mem9, ...options }).start();
  t.after(async () => {
    await fakeConsole.stop();
    await mem9.stop();
  });
  const post = async (body, { bearer = fakeConsole.adminKey, headers = {} } = {}) => {
    const response = await fetch(`${fakeConsole.url}/v1/space-chains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const mem9Status = async (path, key) => (await fetch(`${mem9.url}${path}`, { headers: { 'X-API-Key': key } })).status;
  return { mem9, fakeConsole, post, mem9Status };
}

test('creating a Chain registers it and creates it on mem9 with a management and a memory key', async (t) => {
  const { mem9, fakeConsole, post, mem9Status } = await startPair(t);
  const created = await post({ project_id: fakeConsole.projectId, name: 'demo-chain', description: 'a demo' });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['management_binding', 'memory_binding', 'space_chain']);
  const { space_chain: chain, management_binding: management, memory_binding: memory } = created.body;
  assert.equal(chain.name, 'demo-chain');
  assert.equal(chain.project_id, fakeConsole.projectId);
  assert.equal(management.role, 'management');
  assert.equal(memory.role, 'memory');
  assert.equal(mem9.chains.get(chain.id).name, 'demo-chain', 'space_chain.id is the mem9 Chain id');
  assert.equal(await mem9Status('/v1alpha2/space-chains/by-key', management.chain_api_key), 200);
  assert.equal(await mem9Status('/v1alpha2/space-chains/by-key', memory.chain_api_key), 401, 'the memory key cannot manage the Chain');
  assert.deepEqual(fakeConsole.registrations.map((entry) => entry.name), ['demo-chain']);
  assert.deepEqual(fakeConsole.requests.map((request) => [request.method, request.path, request.authorization]), [['POST', '/v1/space-chains', `Bearer ${fakeConsole.adminKey}`]]);
  assert.deepEqual(fakeConsole.requests[0].body, { project_id: fakeConsole.projectId, name: 'demo-chain', description: 'a demo' });
});

test('every refusal has the Admin API error shape (code, message, details), not the mem9 one', async (t) => {
  const { fakeConsole, post } = await startPair(t);
  const body = { project_id: fakeConsole.projectId, name: 'demo-chain', description: '' };
  const refusals = [
    ['no Bearer credential', await post(body, { bearer: null }), 401],
    ['a wrong Admin API key', await post(body, { bearer: 'mem9_admin_wrong' }), 401],
    ['an X-API-Key header instead of a Bearer', await post(body, { bearer: null, headers: { 'X-API-Key': fakeConsole.adminKey } }), 401],
    ['an unknown Project', await post({ ...body, project_id: 'not-a-project' }), 404],
    ['a missing name', await post({ project_id: fakeConsole.projectId }), 400],
  ];
  for (const [label, response, status] of refusals) {
    assert.equal(response.status, status, label);
    assert.deepEqual(Object.keys(response.body).sort(), ['code', 'details', 'message'], `${label}: the error has code, message and details`);
    assert.ok(!('error' in response.body), `${label}: it is not the mem9 error shape`);
  }
  assert.equal(fakeConsole.registrations.length, 0, 'a refused request registers nothing');
});

test('a key whose owner is not an owner or admin of the organization is refused with 403', async (t) => {
  const { fakeConsole, post } = await startPair(t, { ownerRole: 'member' });
  const refused = await post({ project_id: fakeConsole.projectId, name: 'demo-chain' });
  assert.equal(refused.status, 403);
  assert.equal(fakeConsole.registrations.length, 0);
});

test('a name that is already registered in the Project is a conflict until the registration is deleted', async (t) => {
  const { mem9, fakeConsole, post, mem9Status } = await startPair(t);
  const body = { project_id: fakeConsole.projectId, name: 'demo-chain' };
  const first = await post(body);
  assert.equal(first.status, 201);
  assert.equal((await post(body)).status, 409);
  assert.equal(mem9.chains.size, 1, 'the conflict creates nothing on mem9');
  fakeConsole.deleteRegistration('demo-chain');
  assert.equal(await mem9Status('/v1alpha2/space-chains/by-key', first.body.management_binding.chain_api_key), 404, 'deleting the registration deletes the Chain on mem9');
  assert.equal((await post(body)).status, 201);
});

test('a test can make the next create answer a service error, once', async (t) => {
  const { fakeConsole, post } = await startPair(t);
  const body = { project_id: fakeConsole.projectId, name: 'demo-chain' };
  for (const status of [400, 502, 503]) {
    fakeConsole.failNext(status);
    const failed = await post(body);
    assert.equal(failed.status, status);
    assert.deepEqual(Object.keys(failed.body).sort(), ['code', 'details', 'message']);
  }
  assert.equal(fakeConsole.registrations.length, 0);
  assert.equal((await post(body)).status, 201);
});
