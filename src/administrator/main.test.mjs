import assert from 'node:assert/strict';
import test from 'node:test';
import { withHarness } from '../testing/harness.support.mjs';

test('running with no arguments prints the overview and succeeds', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: sharedmem-admin <command>/);
  assert.match(result.stdout, /sharedmem-admin <command> --help/);
});

test('an unknown command is a usage error with a next step', async (t) => {
  const h = await withHarness(t, { fake: false });
  const result = await h.admin(['frobnicate']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown command: frobnicate/);
  assert.match(result.stderr, /next: Run `sharedmem-admin` without arguments/);
});
