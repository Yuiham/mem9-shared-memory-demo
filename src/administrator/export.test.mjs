import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, withHarness } from '../testing/harness.support.mjs';

const readConfig = (name) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', name), 'utf8'));
const cases = new Map(readConfig('cases.json').cases.map((entry) => [entry.id, entry.sentence]));
const seeds = new Map(readConfig('seed-memories.json').memories.map((entry) => [entry.id, entry.text]));
const questions = readConfig('sample-questions.json');

const KIT_FILE = /^(bin\/sharedmem-participant|person\.json|README\.md|src\/participant\/[a-z-]+\.mjs|src\/shared\/[a-z-]+\.mjs)$/;

function filesIn(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesIn(path.join(dir, entry.name), relative) : [relative];
  });
}

const kitDir = (h, name) => path.join(h.workdir, 'out', 'kits', name);
const personOf = (h, name) => JSON.parse(fs.readFileSync(path.join(kitDir(h, name), 'person.json'), 'utf8'));

async function exported(t, { example, cast } = {}) {
  const h = await withHarness(t);
  const initArgs = ['init', '--yes'];
  if (cast) initArgs.push('--cast', h.writeCast(cast));
  if (example) initArgs.push('--example', example);
  assert.equal((await h.admin(initArgs)).code, 0);
  const result = await h.admin(['export']);
  assert.equal(result.code, 0, result.output);
  return { h, result };
}

test('export builds one Kit per Participant, named after them, plus a report', async (t) => {
  const { h } = await exported(t);
  const folders = fs.readdirSync(path.join(h.workdir, 'out', 'kits')).sort();
  assert.deepEqual(folders, ['ana', 'bruno', 'carla', 'diego', 'lucia', 'marco']);
  assert.ok(fs.existsSync(path.join(h.workdir, 'out', 'report.md')));
});

test('a Kit holds only the allow-listed files: no tests, no administrator code, no shipped content', async (t) => {
  const { h } = await exported(t);
  for (const name of ['ana', 'lucia']) {
    const files = filesIn(kitDir(h, name));
    for (const file of files) assert.match(file, KIT_FILE, `${file} is not on the allow-list`);
    assert.ok(files.every((file) => !file.includes('.test.')), 'no tests');
    assert.ok(files.every((file) => !file.includes('administrator') && !file.includes('testing')), 'no administrator code, no test support');
    for (const required of ['bin/sharedmem-participant', 'person.json', 'README.md', 'src/participant/main.mjs', 'src/shared/cli.mjs']) {
      assert.ok(files.includes(required), `${required} is in the Kit`);
    }
  }
});

test('the launcher in a Kit is executable and runs on its own', async (t) => {
  const { h } = await exported(t);
  const launcher = path.join(kitDir(h, 'ana'), 'bin', 'sharedmem-participant');
  assert.ok(fs.statSync(launcher).mode & 0o100, 'executable');
  const result = await h.participant(kitDir(h, 'ana'), ['--help']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /--agent/);
});

test('the person file holds the Participant\'s details, owner-only', async (t) => {
  const { h } = await exported(t);
  const state = h.readState();
  const file = path.join(kitDir(h, 'ana'), 'person.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const person = personOf(h, 'ana');
  assert.deepEqual(Object.keys(person).sort(), ['agentId', 'chainKey', 'example', 'name', 'role', 'sampleQuestion', 'sampleSentences', 'serverUrl', 'version']);
  assert.equal(person.version, 1);
  assert.equal(person.name, 'ana');
  assert.equal(person.role, 'developer');
  assert.equal(person.agentId, 'ana');
  assert.equal(person.serverUrl, state.serverUrl);
  assert.equal(person.chainKey, state.chains.ana.key);
  assert.equal(person.example, 'basic');
  assert.equal(personOf(h, 'lucia').role, 'leader');
});

test('a Kit holds its own chain key and no other secret', async (t) => {
  const { h } = await exported(t);
  const state = h.readState();
  const spaceKeys = Object.values(state.spaces).map((space) => space.key);
  for (const name of ['ana', 'bruno', 'lucia']) {
    const others = Object.entries(state.chains).filter(([owner]) => owner !== name).map(([, chain]) => chain.key);
    for (const file of filesIn(kitDir(h, name))) {
      const text = fs.readFileSync(path.join(kitDir(h, name), file), 'utf8');
      for (const secret of [...others, ...spaceKeys]) assert.ok(!text.includes(secret), `${file} in the Kit of ${name} holds another secret`);
      if (file !== 'person.json') assert.ok(!text.includes(state.chains[name].key), `${file} holds the key too`);
    }
  }
});

test('Sample sentences and questions follow the formula by role and position', async (t) => {
  const { h } = await exported(t);
  const expectedSentences = {
    ana: ['T1', 'N1'],
    bruno: ['T2', 'N2'],
    carla: ['T3', 'N1'],
    diego: ['T4', 'N2'],
    lucia: ['L1', 'L2', 'W1'],
    marco: ['L3', 'L4', 'W2'],
  };
  for (const [name, ids] of Object.entries(expectedSentences)) {
    assert.deepEqual(personOf(h, name).sampleSentences, ids.map((id) => cases.get(id)), name);
  }
  const developerQuestions = ['ana', 'bruno', 'carla', 'diego'].map((name) => personOf(h, name).sampleQuestion);
  assert.deepEqual(developerQuestions.map((entry) => entry.question), questions.developer.map((entry) => entry.question));
  assert.ok(developerQuestions[0].shouldFind.includes(seeds.get('team-1')));
  assert.ok(developerQuestions[1].shouldFind.includes(seeds.get('team-2')));
  assert.ok(developerQuestions[2].shouldFind.includes(seeds.get('team-3')));
  assert.match(developerQuestions[3].shouldFind, /nothing/i, 'the confidentiality question finds nothing');
  assert.deepEqual(['lucia', 'marco'].map((name) => personOf(h, name).sampleQuestion.question), questions.leader.map((entry) => entry.question));
  assert.ok(personOf(h, 'lucia').sampleQuestion.shouldFind.includes(seeds.get('leadership-1')));
  assert.ok(personOf(h, 'marco').sampleQuestion.shouldFind.includes(seeds.get('team-1')));
});

test('a bigger cast wraps around the Sample sentences and questions', async (t) => {
  const { h } = await exported(t, {
    cast: [
      { name: 'lucia', role: 'leader' }, { name: 'marco', role: 'leader' }, { name: 'nina', role: 'leader' },
      { name: 'ana', role: 'developer' }, { name: 'bruno', role: 'developer' }, { name: 'carla', role: 'developer' },
      { name: 'diego', role: 'developer' }, { name: 'eve', role: 'developer' }, { name: 'finn', role: 'developer' },
    ],
  });
  // Position 4 among developers starts again at T1 and N1; position 5 at T2 and N2.
  assert.deepEqual(personOf(h, 'eve').sampleSentences, [cases.get('T1'), cases.get('N1')]);
  assert.deepEqual(personOf(h, 'finn').sampleSentences, [cases.get('T2'), cases.get('N2')]);
  assert.equal(personOf(h, 'eve').sampleQuestion.question, questions.developer[0].question);
  assert.equal(personOf(h, 'finn').sampleQuestion.question, questions.developer[1].question);
  // Leader position 2 starts again at L1 and W1 and at the first Leader question.
  assert.deepEqual(personOf(h, 'nina').sampleSentences, [cases.get('L1'), cases.get('L2'), cases.get('W1')]);
  assert.equal(personOf(h, 'nina').sampleQuestion.question, questions.leader[0].question);
});

test('the Kit\'s README is the Participant guide', async (t) => {
  const { h } = await exported(t);
  const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'participant-guide.md'), 'utf8');
  assert.equal(fs.readFileSync(path.join(kitDir(h, 'ana'), 'README.md'), 'utf8'), guide);
});

test('the report says who received which Kit and which Example is active, with no secrets', async (t) => {
  const { h } = await exported(t, { example: 'approval' });
  const state = h.readState();
  const report = fs.readFileSync(path.join(h.workdir, 'out', 'report.md'), 'utf8');
  for (const person of state.participants) {
    const line = report.split('\n').find((entry) => entry.includes(`| ${person.name} `));
    assert.ok(line, `${person.name} is in the report`);
    assert.ok(line.toLowerCase().includes(person.role), `${person.name}'s role is in the report`);
    assert.ok(line.includes(`kits/${person.name}`), `${person.name}'s Kit folder is in the report`);
  }
  assert.match(report, /Approval/);
  const secrets = [state.serverUrl, ...Object.values(state.chains).map((chain) => chain.key), ...Object.values(state.spaces).map((space) => space.key)];
  for (const secret of secrets) assert.ok(!report.includes(secret), 'no secret in the report');
});

test('export prints where the Kits are and never prints a key or the server address', async (t) => {
  const { h, result } = await exported(t);
  const state = h.readState();
  assert.match(result.stdout, /out\/kits/);
  assert.match(result.stdout, /secret/i, 'says that a Kit is a secret');
  for (const secret of [state.serverUrl, ...Object.values(state.chains).map((chain) => chain.key)]) assert.ok(!result.output.includes(secret));
});

test('re-exporting rebuilds everything from scratch', async (t) => {
  const { h } = await exported(t);
  fs.writeFileSync(path.join(kitDir(h, 'ana'), 'stray.txt'), 'left over');
  fs.mkdirSync(kitDir(h, 'gone'));
  fs.writeFileSync(path.join(h.workdir, 'out', 'report.md'), 'old report');
  fs.writeFileSync(path.join(h.workdir, 'out', 'keep.txt'), 'not ours');
  const result = await h.admin(['export']);
  assert.equal(result.code, 0, result.output);
  assert.ok(!fs.existsSync(path.join(kitDir(h, 'ana'), 'stray.txt')));
  assert.ok(!fs.existsSync(kitDir(h, 'gone')));
  assert.notEqual(fs.readFileSync(path.join(h.workdir, 'out', 'report.md'), 'utf8'), 'old report');
  assert.equal(fs.readFileSync(path.join(h.workdir, 'out', 'keep.txt'), 'utf8'), 'not ours', 'only Kits and the report are removed');
});

test('a re-export after switching Examples refreshes the label in every person file', async (t) => {
  const { h } = await exported(t);
  const before = personOf(h, 'lucia');
  assert.equal(before.example, 'basic');
  assert.equal((await h.admin(['init', '--yes', '--example', 'approval'])).code, 0);
  assert.equal(personOf(h, 'lucia').example, 'basic', 'the Kit is a snapshot until the next export');
  assert.equal((await h.admin(['export'])).code, 0);
  assert.equal(personOf(h, 'lucia').example, 'approval');
  assert.equal(personOf(h, 'lucia').chainKey, before.chainKey, 'the key does not change');
  assert.match(fs.readFileSync(path.join(h.workdir, 'out', 'report.md'), 'utf8'), /Approval/);
});

test('without a state, export says to run init first', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['export']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /init/);
  assert.ok(!fs.existsSync(path.join(h.workdir, 'out')), 'nothing is written');
});

test('export --help covers what it changes and the next step', async (t) => {
  const h = await withHarness(t);
  const result = await h.admin(['export', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /out\//);
  assert.match(result.stdout, /from scratch/i);
  assert.match(result.stdout, /Next step/i);
});
