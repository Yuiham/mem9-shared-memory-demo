// The fake server is the base of every offline test, so its own behavior is pinned here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { FakeMem9 } from './fake-mem9.support.mjs';

async function startFake(t, options) {
  const fake = await new FakeMem9(options).start();
  t.after(() => fake.stop());
  const call = async (method, path, { key, body, header } = {}) => {
    const response = await fetch(`${fake.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}), ...(header ? { 'X-Mnemo-Agent-Id': header } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { fake, call };
}

async function chainOfThree(call) {
  const spaces = [];
  for (let index = 0; index < 3; index += 1) spaces.push((await call('POST', '/v1alpha1/mem9s')).body.id);
  const created = (await call('POST', '/v1alpha2/space-chains', { body: { name: 'demo' } })).body;
  const key = created.chain_api_key;
  const nodes = (await call('PUT', `/v1alpha2/space-chains/${created.chain.id}/nodes`, {
    key,
    body: { nodes: [
      { tenant_id: spaces[0], external_space_id: 'ana-private', display_name: 'ana' },
      { tenant_id: spaces[1], external_space_id: 'team-shared', display_name: 'team' },
      { tenant_id: spaces[2], external_space_id: 'leadership-shared', display_name: 'leadership' },
    ] },
  })).body.nodes;
  return { spaces, key, chainId: created.chain.id, nodes };
}

test('provisioning creates a Space that answers status; unknown keys are not found', async (t) => {
  const { call } = await startFake(t);
  const id = (await call('POST', '/v1alpha1/mem9s')).body.id;
  assert.deepEqual((await call('GET', '/v1alpha2/status', { key: id })).body, { status: 'active' });
  assert.equal((await call('GET', '/v1alpha2/status', { key: 'nope' })).status, 404);
  assert.equal((await call('GET', '/v1alpha2/status')).status, 401);
});

test('a chain keeps its nodes in order, and the owner node cannot take a routing policy', async (t) => {
  const { call } = await startFake(t);
  const { key, chainId, nodes } = await chainOfThree(call);
  assert.deepEqual(nodes.map((node) => node.position), [0, 1, 2]);
  assert.equal((await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[0].id}/routing-policy`, { key, body: { enabled: true, prompt: 'x' } })).status, 400);
  assert.equal((await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: '' } })).status, 400);
  assert.equal((await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: 'a'.repeat(1201) } })).status, 400);
  assert.equal((await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: 'ok' } })).status, 200);
});

// The server never returns a Space key on a read: a node carries no tenant_id, and a
// Memory's chain_source names its node by position and external space id only.
const leaksSpaceKey = (body, spaces) => {
  const text = JSON.stringify(body);
  return text.includes('tenant_id') || spaces.some((space) => text.includes(space));
};

// The shape the demo builds: the owner's Personal space has no external space id.
async function personalAndTeam(call) {
  const spaces = [];
  for (let index = 0; index < 2; index += 1) spaces.push((await call('POST', '/v1alpha1/mem9s')).body.id);
  const created = (await call('POST', '/v1alpha2/space-chains', { body: { name: 'demo' } })).body;
  const key = created.chain_api_key;
  const chainId = created.chain.id;
  const set = await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes`, {
    key,
    body: { nodes: [{ tenant_id: spaces[0], display_name: 'Personal' }, { tenant_id: spaces[1], external_space_id: 'team-shared', display_name: 'Team Shared' }] },
  });
  assert.equal(set.status, 200);
  return { spaces, key, chainId, created, set, nodes: set.body.nodes };
}

test('no response carries a Space key, and a node leaves out the optional fields it has no value for', async (t) => {
  const { call } = await startFake(t);
  const { spaces, key, chainId, created, set, nodes: [owner, shared] } = await personalAndTeam(call);
  await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'sharedmem', body: { content: 'Ana prefers short answers.', memory_type: 'pinned', agent_id: 'ana' } });
  await call('POST', '/v1alpha2/mem9s/memories', { key: spaces[1], header: 'sharedmem', body: { content: 'Releases go out on Tuesdays.', memory_type: 'pinned', agent_id: 'seed' } });
  const listed = await call('GET', '/v1alpha2/mem9s/memories', { key });
  const responses = {
    'create chain': created,
    'set nodes': set.body,
    'read nodes': (await call('GET', `/v1alpha2/space-chains/${chainId}/nodes`, { key })).body,
    'read chain': (await call('GET', `/v1alpha2/space-chains/${chainId}`, { key })).body,
    'read chain by key': (await call('GET', '/v1alpha2/space-chains/by-key', { key })).body,
    'set routing policy': (await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${shared.id}/routing-policy`, { key, body: { enabled: true, prompt: 'team facts' } })).body,
    'list memories': listed.body,
  };
  for (const [label, body] of Object.entries(responses)) assert.ok(!leaksSpaceKey(body, spaces), `${label} carries no Space key`);

  assert.equal(owner.position, 0);
  assert.equal(owner.display_name, 'Personal');
  assert.ok(!('external_space_id' in owner), 'the owner node has no external space id, so the field is absent');
  assert.ok(!('routing_policy_prompt' in owner), 'an empty prompt is absent');
  assert.equal(shared.external_space_id, 'team-shared');

  const sourceOf = (content) => listed.body.memories.find((memory) => memory.content === content).chain_source;
  assert.deepEqual(sourceOf('Ana prefers short answers.'), { chain_id: chainId, node_position: 0 });
  assert.deepEqual(sourceOf('Releases go out on Tuesdays.'), { chain_id: chainId, node_position: 1, external_space_id: 'team-shared' });
});

test('setting nodes still takes the Space key as tenant_id and refuses a missing, unknown or repeated one', async (t) => {
  const { call } = await startFake(t);
  const space = (await call('POST', '/v1alpha1/mem9s')).body.id;
  const created = (await call('POST', '/v1alpha2/space-chains', { body: { name: 'demo' } })).body;
  const put = (nodes) => call('PUT', `/v1alpha2/space-chains/${created.chain.id}/nodes`, { key: created.chain_api_key, body: { nodes } });
  assert.equal((await put([{ display_name: 'Personal' }])).status, 400, 'missing');
  assert.equal((await put([{ tenant_id: 'not-a-space' }])).status, 400, 'unknown');
  assert.equal((await put([{ tenant_id: space }, { tenant_id: space, external_space_id: 'x' }])).status, 400, 'repeated');
  assert.equal((await put([{ tenant_id: space }])).status, 200);
});

test('a routed fact names the source and target nodes by id and external space id, never by Space key', async (t) => {
  const { fake, call } = await startFake(t);
  const { key, spaces, chainId, nodes } = await personalAndTeam(call);
  fake.setRouting({ rules: [{ match: /migrations/i, targets: ['team-shared'] }] });
  await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: 'team facts' } });
  await call('POST', `/v1alpha2/space-chains/${chainId}/webhooks`, { key, body: { name: 'receiver', url: 'https://example.invalid/hook', events: ['space_chain.fact_routed'] } });
  await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'codex', body: { agent_id: 'ana', sync: true, messages: [{ role: 'user', content: 'Database migrations must be idempotent.' }] } });
  assert.equal(fake.deliveries.length, 1);
  const { data } = fake.deliveries[0].envelope;
  assert.equal(data.source_node_id, nodes[0].id);
  assert.equal(data.source_external_space_id, '', 'the owner node has no external space id; the event still carries the field');
  assert.equal(data.target_external_space_id, 'team-shared');
  assert.equal(data.routing_policy_node_id, nodes[1].id);
  assert.ok(!('source_tenant_id' in data) && !('target_tenant_id' in data));
  assert.ok(!leaksSpaceKey(fake.deliveries[0].envelope, spaces), 'the whole event carries no Space key');
});

test('a pinned write lands in the owner Space with the resolved agent id as source and actor', async (t) => {
  const { fake, call } = await startFake(t);
  const { key, spaces } = await chainOfThree(call);
  const written = await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'sharedmem', body: { content: 'Ana prefers short answers.', memory_type: 'pinned', agent_id: 'ana' } });
  assert.equal(written.status, 201);
  const [memory] = fake.memoriesIn(spaces[0], { type: 'pinned' });
  assert.equal(memory.source, 'ana');
  assert.equal(memory.updated_by, 'ana');
  assert.equal(fake.memoriesIn(spaces[1]).length, 0);
});

test('a message write extracts into the owner and routes only through enabled, eligible nodes', async (t) => {
  const { fake, call } = await startFake(t);
  const { key, spaces, chainId, nodes } = await chainOfThree(call);
  fake.setRouting({ rules: [{ match: /migrations/i, targets: ['team-shared'] }, { match: /budget/i, targets: ['leadership-shared'] }] });
  await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: 'team facts' } });
  const send = (content) => call('POST', '/v1alpha2/mem9s/memories', { key, header: 'codex', body: { agent_id: 'ana', sync: true, messages: [{ role: 'user', content }] } });
  assert.equal((await send('Database migrations must be idempotent.')).status, 200);
  assert.equal((await send('The budget is frozen.')).status, 200);
  assert.equal(fake.memoriesIn(spaces[0], { type: 'insight' }).length, 2);
  assert.deepEqual(fake.memoriesIn(spaces[1], { type: 'insight' }).map((memory) => memory.content), ['Database migrations must be idempotent.']);
  assert.equal(fake.memoriesIn(spaces[2], { type: 'insight' }).length, 0, 'a node without an enabled policy receives nothing');
  assert.equal(fake.memoriesIn(spaces[1], { type: 'insight' })[0].source, 'codex');
});

test('an asynchronous message write answers 202 and lands shortly afterwards', async (t) => {
  const { fake, call } = await startFake(t, { asyncDelayMs: 10 });
  const { key, spaces } = await chainOfThree(call);
  const response = await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'codex', body: { agent_id: 'ana', messages: [{ role: 'user', content: 'Hello there.' }] } });
  assert.equal(response.status, 202);
  assert.equal(fake.memoriesIn(spaces[0], { type: 'insight' }).length, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fake.memoriesIn(spaces[0], { type: 'insight' }).length, 1);
});

test('listing follows the limit rule and a chain key sees merged long-term memories only', async (t) => {
  const { fake, call } = await startFake(t);
  const { key, spaces } = await chainOfThree(call);
  for (let index = 0; index < 12; index += 1) {
    await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'sharedmem', body: { content: `Fact ${index}`, memory_type: 'pinned', agent_id: 'ana' } });
  }
  await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'codex', body: { agent_id: 'ana', sync: true, messages: [{ role: 'user', content: 'Something said.' }] } });
  assert.equal((await call('GET', '/v1alpha2/mem9s/memories', { key })).body.memories.length, 10, 'default limit');
  assert.equal((await call('GET', '/v1alpha2/mem9s/memories?limit=500', { key })).body.limit, 10, 'out of range falls back');
  const all = (await call('GET', '/v1alpha2/mem9s/memories?limit=200', { key })).body;
  assert.equal(all.memories.length, 13, 'chain view shows pinned and insight only');
  assert.ok(all.memories.every((memory) => memory.chain_source));
  assert.equal(fake.memoriesIn(spaces[0], { type: 'session' }).length, 1);
  assert.equal((await call('GET', `/v1alpha2/mem9s/memories?memory_type=session&limit=200`, { key })).body.memories.length, 1);
});

test('deleting a memory hides it from active listings', async (t) => {
  const { call } = await startFake(t);
  const { key } = await chainOfThree(call);
  const written = (await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'sharedmem', body: { content: 'Remove me.', memory_type: 'pinned', agent_id: 'ana' } })).body;
  assert.equal((await call('DELETE', `/v1alpha2/mem9s/memories/${written.id}`, { key })).status, 204);
  assert.equal((await call('GET', '/v1alpha2/mem9s/memories', { key })).body.memories.length, 0);
});

test('webhook creation follows the server rules', async (t) => {
  const { call } = await startFake(t);
  const { key, chainId } = await chainOfThree(call);
  const create = (url, events = ['space_chain.fact_routed']) => call('POST', `/v1alpha2/space-chains/${chainId}/webhooks`, { key, body: { name: 'receiver', url, events } });
  assert.equal((await create('http://example.invalid/hook')).status, 400, 'plain HTTP');
  assert.equal((await create('https://user:pw@example.invalid/hook')).status, 400, 'userinfo');
  assert.equal((await create('https://127.0.0.1/hook')).status, 400, 'literal private address');
  assert.equal((await create('https://example.invalid/hook', ['unknown.event'])).status, 400, 'unknown event');
  const created = await create('https://example.invalid/hook');
  assert.equal(created.status, 201);
  assert.match(created.body.signing_secret, /^whsec_/);
});

test('plain loopback HTTP webhooks are accepted only when the test allows them', async (t) => {
  const { call } = await startFake(t, { allowHttpLocalhost: true });
  const { key, chainId } = await chainOfThree(call);
  const response = await call('POST', `/v1alpha2/space-chains/${chainId}/webhooks`, { key, body: { name: 'local', url: 'http://localhost:9/hook', events: ['space_chain.fact_routed'] } });
  assert.equal(response.status, 201);
});

test('a flushed delivery carries a signature the documented way verifies', async (t) => {
  const { fake, call } = await startFake(t, { allowHttpLocalhost: true });
  const { key, chainId, nodes } = await chainOfThree(call);
  fake.setRouting({ rules: [{ match: /migrations/i, targets: ['team-shared'] }] });
  await call('PUT', `/v1alpha2/space-chains/${chainId}/nodes/${nodes[1].id}/routing-policy`, { key, body: { enabled: true, prompt: 'team facts', webhook_only: true } });
  const secret = (await call('POST', `/v1alpha2/space-chains/${chainId}/webhooks`, { key, body: { name: 'local', url: 'http://localhost:9/hook', events: ['space_chain.fact_routed'] } })).body.signing_secret;
  await call('POST', '/v1alpha2/mem9s/memories', { key, header: 'codex', body: { agent_id: 'ana', sync: true, messages: [{ role: 'user', content: 'Database migrations must be idempotent.' }] } });

  const received = [];
  const receiver = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => { received.push({ headers: request.headers, raw: Buffer.concat(chunks).toString('utf8') }); response.writeHead(204).end(); });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { receiver.closeAllConnections(); receiver.close(resolve); }));
  await fake.flushDeliveries(`http://127.0.0.1:${receiver.address().port}/hook`);

  assert.equal(received.length, 1);
  const { headers, raw } = received[0];
  const expected = `v1=${crypto.createHmac('sha256', secret).update(`${headers['x-mem9-timestamp']}.${headers['x-mem9-event-id']}.${raw}`).digest('hex')}`;
  assert.equal(headers['x-mem9-signature'], expected);
  assert.equal(headers['x-mem9-event-type'], 'space_chain.fact_routed');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.data.webhook_only, true);
  assert.equal(envelope.data.target_memory, null, 'a webhook-only node stores no copy');
  const records = (await call('GET', `/v1alpha2/space-chains/${chainId}/webhook-deliveries`, { key })).body.deliveries;
  assert.equal(records[0].status, 'delivered');
});

test('injected failures start after the given number of creating calls', async (t) => {
  const { fake, call } = await startFake(t);
  fake.injectFailure({ after: 2 });
  assert.equal((await call('POST', '/v1alpha1/mem9s')).status, 201);
  assert.equal((await call('POST', '/v1alpha1/mem9s')).status, 201);
  assert.equal((await call('POST', '/v1alpha1/mem9s')).status, 500);
  fake.clearFailure();
  assert.equal((await call('POST', '/v1alpha1/mem9s')).status, 201);
});
