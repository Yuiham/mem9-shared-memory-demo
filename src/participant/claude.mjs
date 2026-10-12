// The Claude Code recipe: install the plugin at project-local scope and write the
// settings the plugin reads from its environment.
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared/cli.mjs';
import { ensureDir, writeFileAtomic } from '../shared/fsx.mjs';
import { mustRun, requireTools } from './tools.mjs';

export const label = 'Claude Code';

export const REQUIRED_TOOLS = [
  { command: 'claude', problem: 'The `claude` command was not found.', fix: 'Install Claude Code.' },
  { command: 'bash', problem: 'bash was not found (the plugin\'s hooks are bash scripts).', fix: 'Install bash.' },
  { command: 'curl', problem: 'curl was not found (the plugin\'s hooks use it to reach the server).', fix: 'Install curl.' },
];

const settingsPath = (dir) => path.join(dir, '.claude', 'settings.local.json');

export async function plan({ person, dir }) {
  return {
    lines: [
      'Add the mem9 marketplace to Claude Code and install the mem9 plugin at project-local scope.',
      `Write the server address, your key and your Agent ID (${person.agentId}) to .claude/settings.local.json in ${dir} (owner-only), keeping any other settings.`,
    ],
    context: {},
  };
}

// Reads the existing settings; a file that is not valid JSON is never overwritten.
function readSettings(dir) {
  const file = settingsPath(dir);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new CliError('.claude/settings.local.json in the project directory is not valid JSON, so it was left untouched.', {
      next: 'Fix or remove that file, then run this program again.',
    });
  }
}

export function preflight({ env, dir }) {
  requireTools(env, REQUIRED_TOOLS, { agentName: label });
  readSettings(dir);
}

export async function configure({ io, env, person, dir }) {
  const settings = readSettings(dir);
  const run = (args) => mustRun({ display: `claude ${args.join(' ')}`, command: 'claude', args, cwd: dir, env });
  io.out('Adding the mem9 marketplace to Claude Code...');
  await run(['plugin', 'marketplace', 'add', 'mem9-ai/mem9']);
  io.out('Installing the mem9 plugin (project-local scope)...');
  await run(['plugin', 'install', 'mem9@mem9', '--scope', 'local']);
  settings.env = {
    ...(settings.env && typeof settings.env === 'object' ? settings.env : {}),
    MEM9_API_URL: person.serverUrl,
    MEM9_API_KEY: person.chainKey,
    MEM9_AGENT_ID: person.agentId,
  };
  ensureDir(path.dirname(settingsPath(dir)));
  writeFileAtomic(settingsPath(dir), `${JSON.stringify(settings, null, 2)}\n`);
  io.out('Wrote .claude/settings.local.json (owner-only).');
}

export function nextSteps({ dir }) {
  return {
    command: 'claude',
    notes: [
      `Start Claude Code from that directory (${dir}). Started anywhere else, the plugin does not find your settings and creates a separate, empty Space.`,
      '.claude/settings.local.json holds your key: do not commit or share it.',
    ],
  };
}
