import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withHarness } from '../testing/harness.support.mjs';
import { createKit } from '../testing/kit.support.mjs';

const MARKETPLACE_CLAUDE = 'claude plugin marketplace add mem9-ai/mem9';
const INSTALL_CLAUDE = 'claude plugin install mem9@mem9 --scope local';
const MARKETPLACE_CODEX = 'codex plugin marketplace add mem9-ai/mem9';
const ADD_CODEX = 'codex plugin add mem9@mem9-ai';

async function setup(t, kitOptions) {
  const h = await withHarness(t);
  const kit = await createKit(h, kitOptions);
  const project = path.join(h.root, 'project');
  fs.mkdirSync(project);
  return { h, kit, project, run: (args, options) => h.participant(kit.dir, args, options) };
}

const commandsOf = (h, tool) => h.standinLog().filter((line) => line.startsWith(`${tool} `)).map((line) => line.replace(/ \(cwd=.*\)$/, ''));
const setupLog = (h) => h.standinLog().filter((line) => line.startsWith('setup '));

function gitInit(h, dir) {
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, env: h.env(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

// ---- Claude Code ------------------------------------------------------------------

test('Claude Code: adds the marketplace, installs at project-local scope and writes the settings', async (t) => {
  const { h, kit, project, run } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(commandsOf(h, 'claude'), [MARKETPLACE_CLAUDE, INSTALL_CLAUDE]);
  assert.ok(h.standinLog().filter((line) => line.startsWith('claude ')).every((line) => line.endsWith(`(cwd=${project})`)), 'commands run in the chosen directory');
  const file = path.join(project, '.claude', 'settings.local.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).env, {
    MEM9_API_URL: kit.person.serverUrl,
    MEM9_API_KEY: kit.person.chainKey,
    MEM9_AGENT_ID: 'ana',
  });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

// Found by installing the real plugin: the install enables the plugin in the same file
// the variables are written to, so the file must be read again after the install.
test('Claude Code: the plugin stays enabled in the settings the install wrote', async (t) => {
  const { project, run } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  const settings = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(settings.enabledPlugins, { 'mem9@mem9': true });
  assert.equal(settings.env.MEM9_AGENT_ID, 'ana');
});

test('Claude Code: prints where to go, what to say and ask and what to expect, and never launches the agent', async (t) => {
  const { h, kit, project, run } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, new RegExp(`cd ${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(result.stdout, /new terminal window/i);
  assert.match(result.stdout, /^\s+claude\s*$/m, 'the command to run');
  for (const sentence of kit.person.sampleSentences) assert.ok(result.stdout.includes(sentence));
  assert.ok(result.stdout.includes(kit.person.sampleQuestion.question));
  assert.ok(result.stdout.includes(kit.person.sampleQuestion.shouldFind));
  assert.match(result.stdout, /about a minute/);
  assert.match(result.stdout, /from that directory/i, 'start Claude Code from the configured directory');
  assert.ok(commandsOf(h, 'claude').every((line) => line.startsWith('claude plugin ')), 'only plugin commands: the agent itself is never started');
});

test('Claude Code: the key and the server address never appear in the output', async (t) => {
  const { kit, project, run } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.ok(!result.output.includes(kit.person.chainKey));
  assert.ok(!result.output.includes(kit.person.serverUrl));
  assert.equal(result.stderr.split('plain HTTP').length - 1, 1, 'one plain-HTTP warning per run');
});

test('Claude Code: existing settings are kept and only the three variables are set', async (t) => {
  const { project, run } = await setup(t);
  const file = path.join(project, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'other@market': true }, env: { FOO: '1', MEM9_AGENT_ID: 'old' } }), { mode: 0o644 });
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(merged.permissions, { allow: ['Bash(ls)'] });
  assert.deepEqual(merged.enabledPlugins, { 'other@market': true, 'mem9@mem9': true });
  assert.equal(merged.env.FOO, '1');
  assert.equal(merged.env.MEM9_AGENT_ID, 'ana');
  assert.equal(merged.env.MEM9_WRITER_ID, undefined, 'the writing-tool name is left at its default');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a file that was wider becomes owner-only');
});

test('Claude Code: a settings file that is not valid JSON is never overwritten, and nothing was installed', async (t) => {
  const { h, project, run } = await setup(t);
  const file = path.join(project, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not valid JSON/);
  assert.match(result.stderr, /next:/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  assert.deepEqual(commandsOf(h, 'claude'), [], 'checked before any side effect');
});

test('Claude Code: running again is safe and prints the guidance again', async (t) => {
  const { h, project, run } = await setup(t);
  const first = await run(['--agent', 'claude', '--dir', project, '--yes']);
  const file = path.join(project, '.claude', 'settings.local.json');
  const before = fs.readFileSync(file, 'utf8');
  const second = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(second.code, 0, second.output);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(commandsOf(h, 'claude').length, 4, 'the install commands are issued again');
  assert.equal(second.stdout, first.stdout, 'the same guidance');
});

test('Claude Code: a failing claude command stops the run with its name and output, and writes no settings', async (t) => {
  const { project, run, h } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', project, '--yes'], { env: h.env({ extra: { STANDIN_FAIL_CLAUDE: '1' } }) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /claude plugin marketplace add mem9-ai\/mem9/);
  assert.match(result.stderr, /simulated failure/);
  assert.match(result.stderr, /next:.*again/);
  assert.equal(fs.existsSync(path.join(project, '.claude', 'settings.local.json')), false);
});

test('Claude Code: a missing claude, bash or curl is named, and nothing is changed', async (t) => {
  const { h, project, run } = await setup(t);
  const missingClaude = await run(['--agent', 'claude', '--dir', project, '--yes'], { env: h.env({}, { omit: ['claude'], scenario: 'missing-claude' }) });
  assert.equal(missingClaude.code, 1);
  assert.match(missingClaude.stderr, /`claude` command was not found/);
  assert.match(missingClaude.stderr, /Install Claude Code/);
  const missingBoth = await run(['--agent', 'claude', '--dir', project, '--yes'], { env: h.env({}, { omit: ['bash', 'curl'] }) });
  assert.equal(missingBoth.code, 1);
  assert.match(missingBoth.stderr, /bash/);
  assert.match(missingBoth.stderr, /curl/);
  assert.equal(fs.existsSync(path.join(project, '.claude')), false);
  assert.deepEqual(commandsOf(h, 'claude'), []);
});

// ---- Codex ------------------------------------------------------------------------

test('Codex: installs the plugin, saves the profile through the setup script and applies project scope with the Agent ID', async (t) => {
  const { h, kit, project, run } = await setup(t);
  gitInit(h, project);
  const env = h.env({ extra: { STANDIN_SETUP_AGENT_ID: '1' } });
  const result = await run(['--agent', 'codex', '--dir', project, '--yes'], { env });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(commandsOf(h, 'codex'), [MARKETPLACE_CODEX, ADD_CODEX]);
  const log = setupLog(h);
  assert.ok(log.some((line) => /^setup profile save-key --profile sharedmem-ana .*--api-key-env MEM9_DEMO_CHAIN_KEY/.test(line)));
  assert.ok(log.includes('setup key-variable=MEM9_DEMO_CHAIN_KEY key-present=true'));
  assert.ok(log.some((line) => /^setup scope apply --scope project --profile sharedmem-ana --agent-id ana/.test(line)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.codex', 'mem9', 'config.json'), 'utf8')), { schemaVersion: 1, profileId: 'sharedmem-ana', agentId: 'ana' });
  const credentials = JSON.parse(fs.readFileSync(path.join(env.MEM9_HOME, '.credentials.json'), 'utf8'));
  assert.equal(credentials.profiles['sharedmem-ana'].apiKey, kit.person.chainKey, 'the key reached the setup script through its environment');
  assert.ok(h.standinLog().every((line) => !line.includes(kit.person.chainKey)), 'the key is on no command line');
  assert.ok(!result.output.includes(kit.person.chainKey));
  assert.match(result.stdout, /restart Codex|Restart Codex/);
  assert.match(result.stdout, /user-level/i, 'the guidance mentions the user-level hook files');
  assert.ok(commandsOf(h, 'codex').every((line) => line.startsWith('codex plugin ')), 'Codex itself is never started');
});

// Found by installing the real plugin: its setup script creates the credentials file with
// the default mode, so the Chain key would be readable by other users of the computer.
test('Codex: the credentials file that holds the key is made owner-only', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const env = h.env({ extra: { STANDIN_SETUP_AGENT_ID: '1' } });
  const result = await run(['--agent', 'codex', '--dir', project, '--yes'], { env });
  assert.equal(result.code, 0, result.output);
  assert.equal(fs.statSync(path.join(env.MEM9_HOME, '.credentials.json')).mode & 0o777, 0o600);
});

test('Codex: without Agent ID support in the setup command, that step is skipped with a notice and setup completes', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const result = await run(['--agent', 'codex', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.ok(setupLog(h).some((line) => /^setup scope apply --scope project --profile sharedmem-ana$/.test(line)), 'no --agent-id is passed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.codex', 'mem9', 'config.json'), 'utf8')), { schemaVersion: 1, profileId: 'sharedmem-ana' });
  assert.match(result.stdout, /cannot set an Agent ID yet/);
  assert.match(result.stdout, /shared Agent ID "codex"/);
});

test('Codex: the setup script is taken from the local directory when there is one, otherwise the last name in sorted order', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const withLocal = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({ extra: { STANDIN_CODEX_VERSIONS: '0.2.5 local 0.2.10' } }) });
  assert.equal(withLocal.code, 0, withLocal.output);
  assert.ok(setupLog(h).includes('setup script-version=local'));
  const before = setupLog(h).length;
  const env = h.env({ extra: { STANDIN_CODEX_VERSIONS: '0.2.5 0.2.10' } });
  fs.rmSync(path.join(env.CODEX_HOME, 'plugins'), { recursive: true, force: true });
  const sorted = await run(['--agent', 'codex', '--dir', project, '--yes'], { env });
  assert.equal(sorted.code, 0, sorted.output);
  assert.ok(setupLog(h).slice(before).includes('setup script-version=0.2.5'), '0.2.5 sorts after 0.2.10 as text');
});

test('Codex: a directory that is not a Git repository is initialized only after asking, and --yes answers', async (t) => {
  const { h, project, run } = await setup(t);
  const refused = await run(['--agent', 'codex', '--dir', project]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--yes/);
  assert.match(refused.stdout, /git init.*not inside a Git repository/i, 'the plan says it would run git init');
  assert.equal(fs.existsSync(path.join(project, '.git')), false);
  assert.deepEqual(commandsOf(h, 'codex'), [], 'nothing was installed');
  const result = await run(['--agent', 'codex', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.ok(fs.existsSync(path.join(project, '.git')));
  assert.ok(fs.existsSync(path.join(project, '.codex', 'mem9', 'config.json')));
  const check = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: project, env: h.env(), encoding: 'utf8' });
  assert.equal(check.stdout.trim(), 'true', 'a real repository, not an empty .git directory');
});

test('Codex: a subdirectory of a repository is accepted without initializing anything', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const inner = path.join(project, 'packages', 'api');
  fs.mkdirSync(inner, { recursive: true });
  const result = await run(['--agent', 'codex', '--dir', inner, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.equal(fs.existsSync(path.join(inner, '.git')), false);
  assert.ok(fs.existsSync(path.join(inner, '.codex', 'mem9', 'config.json')));
});

test('Codex: running again is safe, rewrites the same settings and prints the guidance again', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const env = h.env({ extra: { STANDIN_SETUP_AGENT_ID: '1' } });
  const first = await run(['--agent', 'codex', '--dir', project, '--yes'], { env });
  const file = path.join(project, '.codex', 'mem9', 'config.json');
  const before = fs.readFileSync(file, 'utf8');
  const second = await run(['--agent', 'codex', '--dir', project, '--yes'], { env });
  assert.equal(second.code, 0, second.output);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(commandsOf(h, 'codex').length, 4);
  assert.equal(second.stdout, first.stdout);
});

test('Codex: a missing codex or git is named, and nothing is changed', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const noCodex = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({}, { omit: ['codex'], scenario: 'missing-codex' }) });
  assert.equal(noCodex.code, 1);
  assert.match(noCodex.stderr, /`codex` command was not found/);
  const noGit = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({}, { omit: ['git'] }) });
  assert.equal(noGit.code, 1);
  assert.match(noGit.stderr, /Git/);
  assert.deepEqual(commandsOf(h, 'codex'), []);
});

test('Codex: a failing codex command and a failing setup script both stop the run with their messages', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const codexFails = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({ extra: { STANDIN_FAIL_CODEX: '1' } }) });
  assert.equal(codexFails.code, 1);
  assert.match(codexFails.stderr, /codex plugin marketplace add mem9-ai\/mem9/);
  assert.match(codexFails.stderr, /simulated failure/);
  const setupFails = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({ extra: { STANDIN_SETUP_FAIL: '1' } }) });
  assert.equal(setupFails.code, 1);
  assert.match(setupFails.stderr, /simulated setup failure/);
  assert.match(setupFails.stderr, /next:/);
});

test('Codex: a plugin cache without the setup script is explained', async (t) => {
  const { h, project, run } = await setup(t);
  gitInit(h, project);
  const result = await run(['--agent', 'codex', '--dir', project, '--yes'], { env: h.env({ extra: { STANDIN_CODEX_VERSIONS: ' ' } }) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /setup command was not found/);
  assert.match(result.stderr, /next:.*(restart|again)/i);
});

// ---- Both agents ------------------------------------------------------------------

test('without a terminal nothing prompts: a missing agent, directory or confirmation is an error naming the flag', async (t) => {
  const { h, project, run } = await setup(t);
  const noAgent = await run(['--dir', project, '--yes']);
  assert.equal(noAgent.code, 1);
  assert.match(noAgent.stderr, /--agent/);
  const noDir = await run(['--agent', 'claude', '--yes']);
  assert.equal(noDir.code, 1);
  assert.match(noDir.stderr, /--dir/);
  const noConfirmation = await run(['--agent', 'claude', '--dir', project]);
  assert.equal(noConfirmation.code, 1);
  assert.match(noConfirmation.stderr, /--yes/);
  assert.match(noConfirmation.stdout, /Plan/, 'the plan is shown before asking');
  assert.deepEqual(commandsOf(h, 'claude'), []);
});

test('usage mistakes are exit code 2: an unknown agent, an unknown option, a stray argument', async (t) => {
  const { project, run } = await setup(t);
  const agent = await run(['--agent', 'vim', '--dir', project, '--yes']);
  assert.equal(agent.code, 2);
  assert.match(agent.stderr, /claude or codex/);
  const option = await run(['--bogus']);
  assert.equal(option.code, 2);
  assert.match(option.stderr, /Unknown option: --bogus/);
  const stray = await run(['claude']);
  assert.equal(stray.code, 2);
});

test('a directory that does not exist is an error with a next step', async (t) => {
  const { h, run } = await setup(t);
  const result = await run(['--agent', 'claude', '--dir', path.join(h.root, 'nowhere'), '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not exist/);
  assert.match(result.stderr, /next:/);
});

test('a Kit without a usable person file is explained', async (t) => {
  const { kit, project, run } = await setup(t);
  fs.writeFileSync(path.join(kit.dir, 'person.json'), '{ broken');
  const broken = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /person file/);
  fs.rmSync(path.join(kit.dir, 'person.json'));
  const missing = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no person file/i);
  assert.match(missing.stderr, /next: .*Administrator/);
});

test('--help says what the program changes and shows examples', async (t) => {
  const { run } = await setup(t);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  for (const part of ['Usage: sharedmem-participant', 'What it changes:', 'Options:', '--agent', '--dir', '--yes', 'Examples:', 'Next step:']) {
    assert.ok(help.stdout.includes(part), part);
  }
});

test('a Leader in the Approval Example is told which announcements wait for approval', async (t) => {
  const { project, run } = await setup(t, { participant: 'lucia', example: 'approval' });
  const result = await run(['--agent', 'claude', '--dir', project, '--yes']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.stdout, /Approval/);
  assert.match(result.stdout, /approv/i);
});
