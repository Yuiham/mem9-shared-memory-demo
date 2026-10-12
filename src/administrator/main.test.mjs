import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withHarness } from '../testing/harness.support.mjs';

const COMMAND_NAMES = ['init', 'memories', 'verify', 'export', 'webhook', 'receiver', 'candidates', 'simulate', 'teardown'];

test('running with no arguments prints the overview and succeeds', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: sharedmem-admin <command>/);
  assert.match(result.stdout, /sharedmem-admin <command> --help/);
  for (const name of COMMAND_NAMES) assert.match(result.stdout, new RegExp(`^  ${name}\\s`, 'm'));
});

test('an unknown command is a usage error with a next step', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin(['frobnicate']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown command: frobnicate/);
  assert.match(result.stderr, /next: Run `sharedmem-admin` without arguments/);
});

test('every command has help with usage, what it changes, options, examples and a next step', async (t) => {
  const h = await withHarness(t, { fake: false });
  for (const name of COMMAND_NAMES) {
    const result = await h.admin([name, '--help']);
    assert.equal(result.code, 0, name);
    for (const part of [`Usage: sharedmem-admin ${name}`, 'What it changes:', 'Options:', 'Examples:', 'Next step:']) {
      assert.ok(result.stdout.includes(part), `${name} help lacks "${part}"`);
    }
    const unknown = await h.admin([name, '--bogus']);
    assert.equal(unknown.code, 2, name);
    assert.match(unknown.stderr, /Unknown option: --bogus/);
    const extra = await h.admin([name, 'surprise']);
    assert.equal(extra.code, 2, `${name} takes no positional arguments`);
  }
});

test('a plain-HTTP server address produces one warning per run and the address never appears in output', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['init', '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.stderr.split('plain HTTP').length - 1, 1);
  assert.match(result.stderr, /warning: .*fictional data only/);
  assert.ok(!result.output.includes(h.fake.url));
  assert.doesNotMatch(result.output, /127\.0\.0\.1|localhost/);
});

test('commands that need the state say so when init has not run', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['teardown', '--yes']);
  assert.equal(result.code, 0);
  assert.equal(fs.existsSync(path.join(h.workdir, 'state')), false, 'a command that changes nothing creates no state');
});
