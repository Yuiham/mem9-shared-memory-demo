// The Codex recipe: install the plugin through Codex's own marketplace commands, then
// configure it through the plugin's setup command in the plugin cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../shared/cli.mjs';
import { mustRun, requireTools, runTool } from './tools.mjs';

export const label = 'Codex';

export const REQUIRED_TOOLS = [
  { command: 'codex', problem: 'The `codex` command was not found.', fix: 'Install the Codex command-line tool.' },
  { command: 'git', problem: 'Git was not found (Codex project setup needs a Git repository).', fix: 'Install Git.' },
];

const KEY_VARIABLE = 'MEM9_DEMO_CHAIN_KEY';
const profileOf = (person) => `sharedmem-${person.name}`;

export async function plan({ person, dir, env }) {
  const needsGitInit = !(await insideGitRepository({ dir, env }));
  const lines = [
    ...(needsGitInit ? [`Run \`git init\` in ${dir}, because it is not inside a Git repository and Codex's project setup needs one.`] : []),
    'Add the mem9 marketplace to Codex and add the mem9 plugin.',
    `Save a profile named ${profileOf(person)} (server address and your key) and apply it to the project through the plugin's setup command, with your Agent ID (${person.agentId}) when the plugin supports it.`,
  ];
  return { lines, context: { needsGitInit } };
}

export function preflight({ env }) {
  requireTools(env, REQUIRED_TOOLS, { agentName: label });
}

async function insideGitRepository({ dir, env }) {
  const result = await runTool({ command: 'git', args: ['rev-parse', '--is-inside-work-tree'], cwd: dir, env });
  return result.code === 0 && result.stdout.trim() === 'true';
}

// The plugin's own rule: the `local` directory when it exists, otherwise the last name
// in sorted order (not the highest version number).
export function findSetupScript(env) {
  const codexHome = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const base = path.join(codexHome, 'plugins', 'cache', 'mem9-ai', 'mem9');
  let names = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(base, name, 'skills', 'setup', 'scripts', 'setup.mjs')));
  } catch {
    names = [];
  }
  if (names.length === 0) {
    throw new CliError('The mem9 plugin was added, but its setup command was not found in the Codex plugin cache ($CODEX_HOME/plugins/cache/mem9-ai/mem9).', {
      next: 'Restart Codex once so it finishes installing the plugin, then run this program again.',
    });
  }
  const chosen = names.includes('local') ? 'local' : names.sort().at(-1);
  return path.join(base, chosen, 'skills', 'setup', 'scripts', 'setup.mjs');
}

// The plugin keeps profiles in $MEM9_HOME/.credentials.json (default ~/.mem9) and creates
// the file without restricting it, so the Chain key would be readable by other users of
// the computer. Restricting it to its owner changes nothing for the plugin.
function restrictCredentialsFile(env) {
  const file = path.join(env.MEM9_HOME || path.join(os.homedir(), '.mem9'), '.credentials.json');
  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function parseResult(stdout) {
  const line = stdout.trim().split('\n').filter(Boolean).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export async function configure({ io, env, person, dir, context }) {
  if (context.needsGitInit) {
    await mustRun({ display: 'git init', command: 'git', args: ['init', '-q'], cwd: dir, env });
    io.out('Initialized a Git repository.');
  }
  const run = (args) => mustRun({ display: `codex ${args.join(' ')}`, command: 'codex', args, cwd: dir, env });
  io.out('Adding the mem9 marketplace to Codex...');
  await run(['plugin', 'marketplace', 'add', 'mem9-ai/mem9']);
  io.out('Adding the mem9 plugin...');
  await run(['plugin', 'add', 'mem9@mem9-ai']);

  const script = findSetupScript(env);
  const setup = (args, extraEnv = {}) => mustRun({
    display: `node setup.mjs ${args.slice(0, 2).join(' ')}`,
    command: process.execPath,
    args: [script, ...args],
    cwd: dir,
    env: { ...env, ...extraEnv },
  });
  const profile = profileOf(person);
  io.out('Saving your profile...');
  const saved = await setup(
    ['profile', 'save-key', '--profile', profile, '--label', `Shared-memory demo (${person.name})`, '--base-url', person.serverUrl, '--api-key-env', KEY_VARIABLE],
    { [KEY_VARIABLE]: person.chainKey },
  );
  if (parseResult(saved.stdout)?.status !== 'ok') throw new CliError('The plugin\'s setup command did not report success while saving the profile.', { next: 'Run this program again; if it keeps failing, see the troubleshooting guide.' });
  restrictCredentialsFile(env);

  const usage = await runTool({ command: process.execPath, args: [script, 'scope', 'apply', '--help'], cwd: dir, env });
  const supportsAgentId = usage.code === 0 && `${usage.stdout}${usage.stderr}`.includes('--agent-id');
  const applyArgs = ['scope', 'apply', '--scope', 'project', '--profile', profile, ...(supportsAgentId ? ['--agent-id', person.agentId] : [])];
  io.out('Applying the profile to the project...');
  const applied = await setup(applyArgs);
  if (parseResult(applied.stdout)?.status !== 'ok') throw new CliError('The plugin\'s setup command did not report success while applying the profile.', { next: 'Run this program again; if it keeps failing, see the troubleshooting guide.' });
  io.out('Configured the Codex plugin for this project.');
  return { supportsAgentId };
}

export function nextSteps({ dir, result }) {
  const notes = [
    'Restart Codex if it is already running, so it picks up the new plugin.',
    'Setting up the plugin also repairs your user-level Codex hook files (under your Codex home folder), and your key is saved in the plugin\'s user-level credentials file (this program makes that file owner-only). Only the project settings stay inside the project.',
  ];
  if (!result?.supportsAgentId) {
    notes.push('The installed Codex plugin cannot set an Agent ID yet, so that step was skipped: your Codex writes under the shared Agent ID "codex", and near-duplicate facts from different people can merge. Update the plugin and run this program again once it supports Agent IDs.');
  }
  return { command: 'codex', notes };
}
