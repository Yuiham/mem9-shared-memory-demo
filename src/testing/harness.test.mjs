// The harness protects the machine running the tests, so its own guarantees are pinned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withHarness } from './harness.support.mjs';
import { preflight } from './run-cli.support.mjs';

const run = (command, args, env, cwd) => spawnSync(command, args, { env, cwd, encoding: 'utf8' });

test('the constructed environment is private to the test and resolves tools to the stand-ins', async (t) => {
  const h = await withHarness(t);
  const env = h.env();
  assert.ok(env.HOME.startsWith(h.root));
  assert.deepEqual(Object.keys(env).filter((name) => /^(OPENAI|ANTHROPIC|MEM9_API|GITHUB|AWS)/.test(name)), []);
  const home = run(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], env, h.workdir);
  assert.equal(home.stdout, env.HOME);
  assert.equal(run('claude', ['--version'], env, h.workdir).status, 2, 'the stand-in refuses unknown arguments');
});

test('the preflight refuses a server address that is not on this machine', async (t) => {
  const h = await withHarness(t);
  const env = { ...h.env(), SHAREDMEM_API_URL: 'https://mem9.example.com' };
  assert.throws(() => preflight(env, { root: h.root, standinDir: h.standins.standinDir }), /does not point at the local machine/);
});

test('the preflight refuses a home directory outside the test', async (t) => {
  const h = await withHarness(t);
  const env = { ...h.env(), HOME: '/somewhere/else' };
  assert.throws(() => preflight(env, { root: h.root, standinDir: h.standins.standinDir }), /HOME points outside/);
});

test('a scenario can leave a tool off the search path', async (t) => {
  const h = await withHarness(t);
  const env = h.env({}, { omit: ['git'] });
  assert.equal(run('git', ['--version'], env, h.workdir).error?.code, 'ENOENT');
  assert.equal(run('bash', ['-c', 'exit 0'], env, h.workdir).status, 0);
});

test('the stand-in codex creates one fake plugin cache per listed version, each with a setup script', async (t) => {
  const h = await withHarness(t);
  const env = h.env({ extra: { STANDIN_CODEX_VERSIONS: 'local 0.2.5 0.2.6' } });
  assert.equal(run('codex', ['plugin', 'add', 'mem9@mem9-ai'], env, h.workdir).status, 0);
  const base = path.join(env.CODEX_HOME, 'plugins', 'cache', 'mem9-ai', 'mem9');
  assert.deepEqual(fs.readdirSync(base).sort(), ['0.2.5', '0.2.6', 'local']);
  assert.ok(fs.existsSync(path.join(base, 'local', 'skills', 'setup', 'scripts', 'setup.mjs')));
  assert.ok(h.standinLog().some((line) => line.startsWith('codex plugin add mem9@mem9-ai')));
});

test('the fake setup script saves a key from a variable, writes a project config and rejects unknown options', async (t) => {
  const h = await withHarness(t);
  const env = h.env({ extra: { STANDIN_SETUP_AGENT_ID: '1', FAKE_KEY: 'sk-fictional-key' } });
  const project = path.join(h.root, 'project');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  const setup = (...args) => run(process.execPath, [h.standins.setupSource, ...args], env, project);

  const saved = setup('profile', 'save-key', '--profile', 'ana', '--base-url', h.fake.url, '--api-key-env', 'FAKE_KEY');
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).status, 'ok');
  assert.equal(JSON.parse(fs.readFileSync(path.join(env.MEM9_HOME, '.credentials.json'), 'utf8')).profiles.ana.apiKey, 'sk-fictional-key');
  assert.equal(fs.statSync(path.join(env.MEM9_HOME, '.credentials.json')).mode & 0o777, 0o600);

  const applied = setup('scope', 'apply', '--scope', 'project', '--profile', 'ana', '--agent-id', 'ana');
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.codex', 'mem9', 'config.json'), 'utf8')), { schemaVersion: 1, profileId: 'ana', agentId: 'ana' });

  const withoutAgent = run(process.execPath, [h.standins.setupSource, 'scope', 'apply', '--scope', 'project', '--profile', 'ana', '--agent-id', 'ana'], h.env({ extra: { STANDIN_SETUP_AGENT_ID: '' } }), project);
  assert.equal(withoutAgent.status, 1);
  assert.match(withoutAgent.stderr, /Unknown argument: --agent-id/);

  const outside = run(process.execPath, [h.standins.setupSource, 'scope', 'apply', '--scope', 'project', '--profile', 'ana'], env, h.root);
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /not inside a Git repository/);
});
