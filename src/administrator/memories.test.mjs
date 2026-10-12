import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIPPED_ROUTING, withHarness } from '../testing/harness.support.mjs';

async function demo(t) {
  const h = await withHarness(t);
  assert.equal((await h.admin(['init', '--yes'])).code, 0);
  h.fake.setRouting(SHIPPED_ROUTING);
  return h;
}

const row = (output, label) => output.split('\n').find((line) => line.includes(label)) ?? '';

test('with no options, memories lists every Space with its long-term Memory counts', async (t) => {
  const h = await demo(t);
  await h.say('ana', 'We always run database migrations before deploying the API.');
  const result = await h.admin(['memories']);
  assert.equal(result.code, 0, result.output);
  const lines = result.stdout.split('\n');
  const names = ['lucia', 'marco', 'ana', 'bruno', 'carla', 'diego', 'team-shared', 'leadership-shared'];
  for (const name of names) assert.ok(lines.some((line) => line.trim().startsWith(name)), `${name} is listed`);
  assert.match(row(result.stdout, 'ana (Personal)'), /\s0\s+1\s*$/, 'one insight in the Personal space of ana');
  assert.match(row(result.stdout, 'team-shared (Team Shared)'), /\s3\s+1\s*$/, 'three Seeds and one routed insight');
  assert.match(row(result.stdout, 'leadership-shared'), /\s2\s+0\s*$/);
  assert.doesNotMatch(result.stdout, /session/);
});

test('--all-types adds the session rows to the counts', async (t) => {
  const h = await demo(t);
  await h.say('ana', 'We always run database migrations before deploying the API.');
  const result = await h.admin(['memories', '--all-types']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /session/);
  assert.match(row(result.stdout, 'ana (Personal)'), /\s0\s+1\s+1\s*$/);
});

test('--space lists one Space\'s long-term Memories with their Agent IDs and hides session rows', async (t) => {
  const h = await demo(t);
  await h.say('ana', 'We always run database migrations before deploying the API.');
  const result = await h.admin(['memories', '--space', 'team-shared']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /Our default branch is main/);
  assert.match(row(result.stdout, 'Our default branch is main'), /pinned.*agent=seed/);
  assert.match(row(result.stdout, 'database migrations'), /insight.*agent=ana/);
  const personal = await h.admin(['memories', '--space', 'ana']);
  assert.match(personal.stdout, /database migrations/);
  assert.doesNotMatch(personal.stdout, /Our default branch/, 'a Personal space holds only its own Memories');
  const withSessions = await h.admin(['memories', '--space', 'ana', '--all-types']);
  assert.equal(withSessions.stdout.split('database migrations').length - 1, 2, 'insight plus the raw session row');
  assert.match(withSessions.stdout, /session/);
});

test('--as shows what one Participant sees through their Chain, with the Space each Memory came from', async (t) => {
  const h = await demo(t);
  await h.say('ana', 'We always run database migrations before deploying the API.');
  await h.say('lucia', 'We will hire two senior backend engineers for the checkout team in Q4.');
  const developer = await h.admin(['memories', '--as', 'bruno']);
  assert.equal(developer.code, 0, developer.output);
  assert.match(row(developer.stdout, 'Our default branch is main'), /from=Team Shared/);
  assert.match(row(developer.stdout, 'database migrations'), /from=Team Shared/);
  assert.doesNotMatch(developer.stdout, /annual planning offsite|hire two senior/, 'a Developer never sees Leadership Shared');
  const leader = await h.admin(['memories', '--as', 'lucia']);
  assert.match(row(leader.stdout, 'annual planning offsite'), /from=Leadership Shared/);
  const hire = leader.stdout.split('\n').filter((line) => line.includes('hire two senior'));
  assert.equal(hire.length, 2, 'the Personal insight and the routed copy');
  assert.ok(hire.some((line) => /from=Personal/.test(line)));
  assert.ok(hire.some((line) => /from=Leadership Shared/.test(line)));
  assert.match(leader.stdout, /Our default branch is main/, 'a Leader reads Team Shared');
  const withSessions = await h.admin(['memories', '--as', 'ana', '--all-types']);
  assert.match(withSessions.stdout, /session/);
});

test('unknown names, conflicting options and a missing state are explained', async (t) => {
  const h = await demo(t);
  const unknown = await h.admin(['memories', '--space', 'nobody']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown Space: nobody/);
  assert.match(unknown.stderr, /team-shared/);
  const person = await h.admin(['memories', '--as', 'nobody']);
  assert.equal(person.code, 1);
  assert.match(person.stderr, /Unknown participant: nobody/);
  assert.match(person.stderr, /lucia/);
  const both = await h.admin(['memories', '--space', 'ana', '--as', 'ana']);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--space or --as, not both/);

  const empty = await withHarness(t);
  const noState = await empty.admin(['memories']);
  assert.equal(noState.code, 1);
  assert.match(noState.stderr, /init/);
});

test('memories never prints a key or the server address', async (t) => {
  const h = await demo(t);
  await h.say('ana', 'We always run database migrations before deploying the API.');
  const state = h.readState();
  const secrets = [...Object.values(state.spaces).map((space) => space.key), ...Object.values(state.chains).map((chain) => chain.key), h.fake.url];
  for (const args of [[], ['--all-types'], ['--space', 'team-shared'], ['--as', 'ana', '--all-types']]) {
    const result = await h.admin(['memories', ...args]);
    for (const secret of secrets) assert.ok(!result.output.includes(secret), `leak in memories ${args.join(' ')}`);
  }
});

test('memories --help says it only reads', async (t) => {
  const h = await withHarness(t, { fake: false });
  const help = await h.admin(['memories', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /What it changes:\n\s+- Nothing/);
});
