import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sourceFiles, violationsIn } from './testing/import-scan.support.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// This file holds deliberately bad import lines as test data, so the scan skips it.
const SELF = path.join('src', 'structure.test.mjs');

test('every source file respects the module rules and imports only built-in Node modules', () => {
  const files = sourceFiles(repoRoot).filter((file) => file !== SELF);
  assert.ok(files.length > 10, 'the scan should find the source files');
  const problems = files.flatMap((file) => violationsIn(file, fs.readFileSync(path.join(repoRoot, file), 'utf8')));
  assert.deepEqual(problems, []);
});

test('the scan catches each kind of violation', () => {
  const cases = [
    ['src/administrator/a.mjs', "import x from '../participant/b.mjs';", /administrator module imports participant/],
    ['src/participant/a.mjs', "import x from '../administrator/b.mjs';", /participant module imports administrator/],
    ['src/shared/a.mjs', "import x from '../administrator/b.mjs';", /shared module imports administrator/],
    ['src/administrator/a.mjs', "import x from '../testing/b.support.mjs';", /product code imports the testing module/],
    ['src/testing/a.support.mjs', "import x from '../shared/b.mjs';", /testing module imports shared/],
    ['src/shared/a.mjs', "import pkg from 'left-pad';", /not built into Node/],
    ['src/shared/a.mjs', "const m = await import('left-pad');", /not built into Node/],
    ['src/shared/a.mjs', "export * from 'left-pad';", /not built into Node/],
  ];
  for (const [file, text, expected] of cases) {
    const problems = violationsIn(file, text);
    assert.equal(problems.length, 1, `${file}: ${text}`);
    assert.match(problems[0], expected);
  }
  assert.deepEqual(violationsIn('src/administrator/a.mjs', "import fs from 'node:fs'; import x from '../shared/b.mjs'; import y from './c.mjs';"), []);
  assert.deepEqual(violationsIn('src/administrator/a.test.mjs', "import h from '../testing/harness.support.mjs';"), []);
});

test('no lockfile or dependency declaration exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  for (const lockfile of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    assert.equal(fs.existsSync(path.join(repoRoot, lockfile)), false, lockfile);
  }
});
