// How init creates Chains: through the mem9 Admin API when its three settings are present,
// directly on the mem9 server otherwise, and what it does when either way is refused.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chainKeysOf, SMALL_CAST, withHarness } from '../testing/harness.support.mjs';

const CREATE_CHAIN = '/v1alpha2/space-chains';
const NO_ADMIN = { SHAREDMEM_ADMIN_API_URL: undefined, SHAREDMEM_ADMIN_API_KEY: undefined, SHAREDMEM_PROJECT_ID: undefined };
const SECRET = 'a-create-secret-of-the-server';

const readStateText = (h) => fs.readFileSync(path.join(h.workdir, 'state', 'state.json'), 'utf8');
const createCalls = (h) => h.fake.requestsTo('POST', CREATE_CHAIN).filter((request) => request.path === CREATE_CHAIN);

// Runs init for the two-person cast. `env` overrides settings; `h.env` drops any that are undefined.
async function init(h, env = {}) {
  const cast = h.writeCast(SMALL_CAST);
  return h.admin(['init', '--cast', cast, '--yes'], { env: h.env(env) });
}

// Nothing a person must keep secret, or that names where the services are, is printed or stored.
function assertNoLeak(h, texts, extra = []) {
  const state = fs.existsSync(path.join(h.workdir, 'state', 'state.json')) ? h.readState() : { spaces: {}, chains: {} };
  const secrets = [
    ...Object.values(state.spaces).map((space) => space.key),
    ...chainKeysOf(state),
    h.fake.url,
    ...(h.console ? [h.console.adminKey, h.console.projectId, h.console.url] : []),
    ...extra,
  ];
  for (const text of texts) for (const secret of secrets) assert.ok(!text.includes(secret), 'a secret or an address was printed');
}

// The state holds the keys of the Spaces and Chains, but never the credentials used to create them.
function assertNotStored(h, secrets) {
  const text = readStateText(h);
  const credentials = [...secrets, ...(h.console ? [h.console.adminKey, h.console.projectId, h.console.url] : [])];
  for (const secret of credentials) assert.ok(!text.includes(secret), 'a credential for creating Chains was written to the state');
}

test('with the three Admin API settings, init creates every Chain through the Admin API and records both keys', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  // The create gate of the mem9 server is on, and the Administrator has no secret for it:
  // the Admin API is the way in.
  h.fake.requireCreateSecret('known-only-to-the-console');
  const result = await init(h);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /2 Chains in total; 2 still to create \(through the Admin API\)/);

  const state = h.readState();
  assert.equal(fs.statSync(path.join(h.workdir, 'state', 'state.json')).mode & 0o777, 0o600);
  for (const name of ['lucia', 'ana']) {
    const chain = state.chains[name];
    const registered = h.console.registrations.find((entry) => entry.name === `sharedmem-demo-${name}`);
    assert.equal(chain.origin, 'admin-api');
    assert.equal(chain.id, registered.id, 'the Chain id is the id the Admin API returned');
    assert.equal(chain.name, `sharedmem-demo-${name}`);
    assert.match(chain.managementKey, /^chain_/);
    assert.match(chain.memoryKey, /^chain_/);
    assert.notEqual(chain.managementKey, chain.memoryKey);
    assert.deepEqual(Object.keys(chain).sort(), ['id', 'managementKey', 'memoryKey', 'name', 'nodes', 'origin']);
    assert.equal(h.fake.chains.get(chain.id).nodes.length, name === 'lucia' ? 3 : 2, 'the Chain was configured with its management key');
  }

  assert.equal(h.console.requests.length, 2);
  for (const request of h.console.requests) {
    assert.deepEqual([request.method, request.path], ['POST', '/v1/space-chains']);
    assert.equal(request.authorization, `Bearer ${h.console.adminKey}`);
    assert.deepEqual(Object.keys(request.body).sort(), ['description', 'name', 'project_id']);
    assert.equal(request.body.project_id, h.console.projectId);
  }
  assert.equal(createCalls(h).length, 0, 'no Chain was created directly on the mem9 server');

  assertNotStored(h, []);
  assertNoLeak(h, [result.output]);
});

test('with the Admin API settings present, a create secret is not used', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  const result = await init(h, { SHAREDMEM_CREATE_SECRET: SECRET });
  assert.equal(result.code, 0, result.output);
  assert.equal(h.console.requests.length, 2);
  assert.ok(h.console.requests.every((request) => request.authorization === `Bearer ${h.console.adminKey}`));
  assert.equal(h.fake.requests.filter((request) => request.authorization !== undefined).length, 0, 'no request to the mem9 server carries a Bearer credential');
  assertNoLeak(h, [result.output], [SECRET]);
  assertNotStored(h, [SECRET]);
});

test('without the Admin API settings, init creates Chains directly on a server whose gate is off, sending no credential', async (t) => {
  const h = await withHarness(t);
  const result = await init(h);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /2 Chains in total; 2 still to create \(directly on the server\)/);
  const state = h.readState();
  assert.ok(Object.values(state.chains).every((chain) => chain.origin === 'mem9' && chain.managementKey !== chain.memoryKey));
  assert.equal(createCalls(h).length, 2);
  assert.ok(createCalls(h).every((request) => request.authorization === undefined && request.key === undefined));
  assert.equal(h.fake.chains.get(state.chains.ana.id).nodes.length, 2, 'configured with the management key');
  assertNoLeak(h, [result.output]);
});

test('a create secret is sent as a Bearer credential when one is set, also to a server whose gate is off, and is never stored or printed', async (t) => {
  const h = await withHarness(t);
  const result = await init(h, { SHAREDMEM_CREATE_SECRET: SECRET });
  assert.equal(result.code, 0, result.output);
  assert.equal(createCalls(h).length, 2);
  assert.ok(createCalls(h).every((request) => request.authorization === `Bearer ${SECRET}`));
  assert.ok(h.fake.requests.filter((request) => !(request.method === 'POST' && request.path === CREATE_CHAIN)).every((request) => request.authorization === undefined), 'the secret goes with the create call only');
  assertNoLeak(h, [result.output], [SECRET]);
  assertNotStored(h, [SECRET]);
});

test('a server whose gate is on lets init create Chains when the create secret matches', async (t) => {
  const h = await withHarness(t);
  h.fake.requireCreateSecret(SECRET);
  const result = await init(h, { SHAREDMEM_CREATE_SECRET: SECRET });
  assert.equal(result.code, 0, result.output);
  assert.equal(h.fake.chains.size, 2);
  assertNoLeak(h, [result.output], [SECRET]);
  assertNotStored(h, [SECRET]);
});

test('a server whose gate is on refuses init without a create secret, and the message names both ways in', async (t) => {
  const h = await withHarness(t);
  h.fake.requireCreateSecret(SECRET);
  const result = await init(h);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /error: This server requires a credential to create a Chain/);
  assert.match(result.stderr, /SHAREDMEM_ADMIN_API_URL, SHAREDMEM_ADMIN_API_KEY and SHAREDMEM_PROJECT_ID/);
  assert.match(result.stderr, /SHAREDMEM_CREATE_SECRET/);
  assert.match(result.stderr, /next: .*Before you start.*docs\/administrator-guide\.md/);
  assert.equal(h.fake.chains.size, 0);
  assert.deepEqual(h.readState().chains, {});
  assert.equal(Object.keys(h.readState().spaces).length, 4, 'the Spaces opened before are kept');
  assertNoLeak(h, [result.output], [SECRET]);
});

test('a create secret the server does not accept is reported as that, not as a missing one', async (t) => {
  const h = await withHarness(t);
  h.fake.requireCreateSecret(SECRET);
  const wrong = 'not-the-secret-of-the-server';
  const result = await init(h, { SHAREDMEM_CREATE_SECRET: wrong });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not accept the create secret/);
  assert.doesNotMatch(result.stderr, /requires a credential/);
  assert.equal(h.fake.chains.size, 0);
  assertNoLeak(h, [result.output], [wrong, SECRET]);
});

// ---- settings that are only partly there ---------------------------------------------------

test('Admin API settings that are only partly there stop init before anything is changed, naming what is missing', async (t) => {
  const variables = ['SHAREDMEM_ADMIN_API_URL', 'SHAREDMEM_ADMIN_API_KEY', 'SHAREDMEM_PROJECT_ID'];
  const h = await withHarness(t, { withConsole: true });
  for (const missing of variables) {
    const result = await init(h, { [missing]: undefined });
    assert.equal(result.code, 1, missing);
    assert.match(result.stderr, new RegExp(`error: Some of the Admin API settings are missing: ${missing}\\.`));
    assert.match(result.stderr, /next: Set all three of SHAREDMEM_ADMIN_API_URL, SHAREDMEM_ADMIN_API_KEY, SHAREDMEM_PROJECT_ID.*or none of them.*Before you start/);
    assertNoLeak(h, [result.output]);
  }
  const two = await init(h, { SHAREDMEM_ADMIN_API_KEY: undefined, SHAREDMEM_PROJECT_ID: undefined });
  assert.match(two.stderr, /are missing: SHAREDMEM_ADMIN_API_KEY, SHAREDMEM_PROJECT_ID\./);
  assert.equal(h.console.requests.length, 0);
  assert.equal(h.fake.chains.size, 0);
  assert.equal(h.fake.spaces.size, 0, 'no Space was opened');
  assert.equal(fs.existsSync(path.join(h.workdir, 'state', 'state.json')), false, 'no state was written');
});

// ---- what the Admin API can refuse -------------------------------------------------------------

const REFUSALS = [
  { title: 'an Admin API key it does not know', env: () => ({ SHAREDMEM_ADMIN_API_KEY: `mem9_admin_${'x'.repeat(43)}` }), say: /did not accept the Admin API key \(401\)/, next: /Check SHAREDMEM_ADMIN_API_KEY/ },
  { title: 'a key whose owner is not an owner or admin', options: { ownerRole: 'member' }, say: /may not create Chains in this Project \(403\)/, next: /owner or admin of the organization/ },
  { title: 'a Project it does not know', env: () => ({ SHAREDMEM_PROJECT_ID: crypto.randomUUID() }), say: /does not know this Project \(404\)/, next: /Check SHAREDMEM_PROJECT_ID and SHAREDMEM_ADMIN_API_URL/ },
  { title: 'a request it cannot read', fail: 400, say: /did not accept the request to create a Chain \(400\)/, next: /Check SHAREDMEM_PROJECT_ID/ },
  { title: 'a mem9 server it cannot reach', fail: 502, say: /could not reach the mem9 server \(502\)/, next: /Run the command again/ },
  { title: 'a moment when it is not available', fail: 503, say: /not available right now \(503\)/, next: /Run the command again/ },
];

for (const refusal of REFUSALS) {
  test(`init explains an Admin API that refuses ${refusal.title}, and keeps what it had opened`, async (t) => {
    const h = await withHarness(t, { withConsole: true, consoleOptions: refusal.options });
    if (refusal.fail) h.console.failNext(refusal.fail);
    const env = refusal.env?.() ?? {};
    const result = await init(h, env);
    assert.equal(result.code, 1, result.output);
    assert.match(result.stderr, new RegExp(`error: .*${refusal.say.source}`));
    assert.match(result.stderr, new RegExp(`next: .*${refusal.next.source}`));
    assert.equal(h.fake.chains.size, 0);
    assert.deepEqual(h.readState().chains, {});
    assert.equal(Object.keys(h.readState().spaces).length, 4, 'the Spaces opened before are kept');
    assertNoLeak(h, [result.output], Object.values(env));
    if (refusal.fail) {
      // The refusal was a single one: running again goes on from there.
      const again = await init(h);
      assert.equal(again.code, 0, again.output);
      assert.equal(Object.keys(h.readState().chains).length, 2);
    }
  });
}

test('init names the Admin API address setting when the Console cannot be reached, and prints neither the address nor the key', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  const env = h.env();
  const [adminUrl, adminKey] = [h.console.url, h.console.adminKey];
  await h.console.stop();
  const cast = h.writeCast(SMALL_CAST);
  const result = await h.admin(['init', '--cast', cast, '--yes'], { env });
  assert.equal(result.code, 1, result.output);
  assert.match(result.stderr, /error: Cannot reach the mem9 Admin API/);
  assert.match(result.stderr, /next: Check SHAREDMEM_ADMIN_API_URL/);
  assert.ok(!result.output.includes(adminUrl) && !result.output.includes(adminKey));
  assert.ok(!result.output.includes(h.fake.url));
  assert.equal(h.fake.chains.size, 0);
});

// ---- a Chain that exists on mem9 but is still registered in the Console --------------------------

test('a Chain deleted only on mem9 stays registered in the Console: init keeps the old record, names the Chain in the way, and recovers once it is deleted there', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  assert.equal((await init(h)).code, 0);
  const before = h.readState().chains.ana;
  h.fake.chains.get(before.id).deleted = true;

  const refused = await init(h);
  assert.equal(refused.code, 1, refused.output);
  assert.match(refused.stderr, /error: A Chain named "sharedmem-demo-ana" already exists in the Project \(409\)/);
  assert.match(refused.stderr, /next: Delete it in the Console, then run `sharedmem-admin init` again/);
  assert.deepEqual(h.readState().chains.ana, before, 'the old record is kept');

  h.console.deleteRegistration('sharedmem-demo-ana');
  const again = await init(h);
  assert.equal(again.code, 0, again.output);
  assert.match(again.stdout, /the server no longer knows the Chain of ana/);
  const after = h.readState().chains.ana;
  assert.notEqual(after.id, before.id);
  assert.notEqual(after.managementKey, before.managementKey);
  assert.notEqual(after.memoryKey, before.memoryKey);
  assert.equal(after.origin, 'admin-api');
});

// ---- the warnings about plain HTTP -----------------------------------------------------------------

const occurrences = (text, part) => text.split(part).length - 1;

test('on the Admin API path init warns once about the plain-HTTP server address and once about the plain-HTTP Admin API address, which names the Admin API key', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  const result = await init(h, { SHAREDMEM_CREATE_SECRET: SECRET });
  assert.equal(result.code, 0, result.output);
  assert.equal(occurrences(result.stderr, 'warning: The server address uses plain HTTP'), 1);
  assert.equal(occurrences(result.stderr, 'warning: The Admin API address uses plain HTTP, so the Admin API key is sent unencrypted.'), 1);
  assert.doesNotMatch(result.stderr, /create secret/, 'the secret is not used on this path, so the warning does not name it');
});

test('on the direct path the plain-HTTP warning names the create secret only when one is set', async (t) => {
  const h = await withHarness(t);
  const without = await init(h);
  assert.equal(occurrences(without.stderr, 'plain HTTP'), 1);
  assert.doesNotMatch(without.stderr, /create secret/);
  const withSecret = await init(h, { SHAREDMEM_CREATE_SECRET: SECRET });
  assert.equal(occurrences(withSecret.stderr, 'plain HTTP'), 1);
  assert.match(withSecret.stderr, /The create secret is sent to it as well\./);
  assert.doesNotMatch(withSecret.stderr, /Admin API/);
});

// ---- where the settings come from; what a later run needs -------------------------------------------

test('a re-run needs no Admin API settings when every Chain exists, and makes no create request', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  assert.equal((await init(h)).code, 0);
  const again = await init(h, NO_ADMIN);
  assert.equal(again.code, 0, again.output);
  assert.match(again.stdout, /2 Chains in total; 0 still to create\./);
  assert.doesNotMatch(again.stdout, /through the Admin API|directly on the server/);
  assert.equal(h.console.requests.length, 2, 'the Console heard from the first run only');
  assert.equal(createCalls(h).length, 0);
});

test('the Admin API settings can come from .env, and the process environment wins over it', async (t) => {
  const h = await withHarness(t, { withConsole: true });
  const lines = (projectId) => [
    `SHAREDMEM_ADMIN_API_URL=${h.console.url}`,
    `SHAREDMEM_ADMIN_API_KEY=${h.console.adminKey}`,
    `SHAREDMEM_PROJECT_ID=${projectId}`,
  ].join('\n');
  fs.writeFileSync(path.join(h.workdir, '.env'), `${lines(crypto.randomUUID())}\n`);
  const wrong = await init(h, NO_ADMIN);
  assert.equal(wrong.code, 1, 'the Project in .env is not the Console\'s');
  assert.match(wrong.stderr, /does not know this Project \(404\)/);

  // The address and the key still come from .env; the Project comes from the process environment.
  const wins = await init(h, { ...NO_ADMIN, SHAREDMEM_PROJECT_ID: h.console.projectId });
  assert.equal(wins.code, 0, wins.output);
  assert.ok(Object.values(h.readState().chains).every((chain) => chain.origin === 'admin-api'));
  assert.equal(h.console.requests.length, 3, 'one refused create, then two that worked');
  assertNoLeak(h, [wins.output, wrong.output]);
});

// ---- a server from before the two keys ----------------------------------------------------------------

test('a server that still answers with one Chain key is reported as too old, and no key is recorded or printed', async (t) => {
  const h = await withHarness(t);
  h.fake.answerCreateWithOneKey();
  const result = await init(h);
  assert.equal(result.code, 1, result.output);
  assert.match(result.stderr, /error: The answer to creating a Chain does not carry both a management key and a memory key\./);
  assert.match(result.stderr, /next: .*Update the server/);
  assert.deepEqual(h.readState().chains, {});
  for (const key of h.fake.keys.keys()) assert.ok(!result.output.includes(key), 'a key from the answer was printed');
});

// ---- a server that limits how fast Spaces can be opened --------------------------------------------------

const provisionCalls = (h) => h.fake.requestsTo('POST', '/v1alpha1/mem9s').length;
const WAIT_LINE = (seconds, retry) => new RegExp(`the server limits how fast Spaces can be opened; waiting ${seconds}s before trying again \\(retry ${retry} of 5\\)`);

test('when the server answers 429 to opening a Space, init waits the seconds it asked for, says so, and goes on', async (t) => {
  const h = await withHarness(t);
  h.fake.limitProvisioning({ rejectFirst: 2, retryAfter: 1 });
  const started = Date.now();
  const result = await init(h);
  const seconds = (Date.now() - started) / 1000;
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, WAIT_LINE(1, 1));
  assert.match(result.stdout, WAIT_LINE(1, 2));
  assert.equal(occurrences(result.stdout, 'waiting 1s'), 2);
  assert.ok(seconds >= 1.8, `init waited for the two refusals (${seconds}s)`);
  assert.equal(provisionCalls(h), 6, 'four Spaces and two refused attempts');
  assert.equal(Object.keys(h.readState().spaces).length, 4);
  assertNoLeak(h, [result.output]);
});

test('init waits the number of seconds the server names, not a fixed one', async (t) => {
  const h = await withHarness(t);
  h.fake.limitProvisioning({ rejectFirst: 1, retryAfter: 2 });
  const started = Date.now();
  const result = await init(h);
  const seconds = (Date.now() - started) / 1000;
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, WAIT_LINE(2, 1));
  assert.ok(seconds >= 1.8, `init waited the two seconds it was asked for (${seconds}s)`);
});

test('a 429 without a Retry-After header is waited out as one second', async (t) => {
  const h = await withHarness(t);
  h.fake.limitProvisioning({ rejectFirst: 1, retryAfter: null });
  const result = await init(h);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, WAIT_LINE(1, 1));
});

test('a server that keeps refusing stops init after five retries, keeps the Spaces already opened, and a later run goes on from there', async (t) => {
  const h = await withHarness(t);
  h.fake.limitProvisioning({ rejectFirst: 100, retryAfter: 1, after: 2 });
  const stopped = await init(h);
  assert.equal(stopped.code, 1, stopped.output);
  for (const retry of [1, 2, 3, 4, 5]) assert.match(stopped.stdout, WAIT_LINE(1, retry));
  assert.doesNotMatch(stopped.stdout, /retry 6 of 5/);
  assert.match(stopped.stderr, /error: The server is still limiting how fast Spaces can be opened after 5 retries\./);
  assert.match(stopped.stderr, /next: Run `sharedmem-admin init` again later; it continues where it stopped\./);
  assert.equal(provisionCalls(h), 8, 'two Spaces, then the sixth refusal of the third');
  assert.equal(Object.keys(h.readState().spaces).length, 2, 'the Spaces opened before are kept');
  assert.equal(h.fake.chains.size, 0);
  assertNoLeak(h, [stopped.output]);

  h.fake.limitProvisioning({ rejectFirst: 0 });
  const resumed = await init(h);
  assert.equal(resumed.code, 0, resumed.output);
  assert.equal(Object.keys(h.readState().spaces).length, 4);
  assert.equal(provisionCalls(h), 10, 'only the two missing Spaces were opened');
});

test('a Retry-After longer than a minute stops init at once instead of waiting', async (t) => {
  const h = await withHarness(t);
  h.fake.limitProvisioning({ rejectFirst: 1, retryAfter: 61, after: 1 });
  const started = Date.now();
  const result = await init(h);
  assert.ok(Date.now() - started < 5000, 'init did not wait');
  assert.equal(result.code, 1, result.output);
  assert.match(result.stderr, /error: The server is limiting how fast Spaces can be opened and asked for a wait of 61 seconds, which is too long to wait here\./);
  assert.match(result.stderr, /next: Run `sharedmem-admin init` again later; it continues where it stopped\./);
  assert.doesNotMatch(result.stdout, /waiting/);
  assert.equal(provisionCalls(h), 2);
  assert.equal(Object.keys(h.readState().spaces).length, 1);
  assertNoLeak(h, [result.output]);
});
