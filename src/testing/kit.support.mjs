// A real exported Kit for Participant tests: the Administrator program builds the
// Kits, and the Participant program is run from the Kit folder, so a file missing from
// a Kit fails a test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SMALL_CAST } from './harness.support.mjs';

// Runs init and export for a small cast, then returns the Kit of one participant. The
// person file can be adjusted afterwards with `overrides` (the Kit stays a real Kit).
export async function createKit(h, { participant = 'ana', example, cast = SMALL_CAST, overrides = {} } = {}) {
  const castFile = h.writeCast(cast, 'kit-cast.json');
  const init = await h.admin(['init', '--yes', '--cast', castFile, ...(example ? ['--example', example] : [])]);
  assert.equal(init.code, 0, init.output);
  const exported = await h.admin(['export']);
  assert.equal(exported.code, 0, exported.output);
  const dir = path.join(h.workdir, 'out', 'kits', participant);
  const file = path.join(dir, 'person.json');
  const person = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...overrides };
  if (Object.keys(overrides).length > 0) fs.writeFileSync(file, `${JSON.stringify(person, null, 2)}\n`, { mode: 0o600 });
  return { dir, person };
}
