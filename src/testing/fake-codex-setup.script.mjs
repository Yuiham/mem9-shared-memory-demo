// Stand-in for the Codex plugin's setup script. It is copied into a fake plugin cache
// by the stand-in `codex` command and run through Node, like the real one.
// It follows the plugin contract notes: a strict argument parser, one JSON line on
// success, a message on standard error and exit code 1 on failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const supportsAgentId = process.env.STANDIN_SETUP_AGENT_ID === '1';

function log(line) {
  if (process.env.STANDIN_LOG) fs.appendFileSync(process.env.STANDIN_LOG, `${line}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const valueOptions = new Set([
  '--scope', '--profile', '--label', '--base-url', '--api-key-env', '--cwd',
  '--default-timeout-ms', '--search-timeout-ms', '--recall-min-prompt-length',
  '--update-check', '--update-check-interval-hours',
  ...(supportsAgentId ? ['--agent-id'] : []),
]);

function parse(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--help') { options.help = true; continue; }
    if (!valueOptions.has(token)) fail(`Unknown argument: ${token}`);
    options[token.slice(2)] = tokens[index + 1];
    index += 1;
  }
  return options;
}

const [group, command, ...rest] = args;
log(`setup ${group ?? ''} ${command ?? ''} ${rest.join(' ')}`.replace(/\s+/g, ' ').trim());
// Which plugin cache version this copy of the script sits in: <version>/skills/setup/scripts.
log(`setup script-version=${path.basename(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))}`);
if (process.env.STANDIN_SETUP_FAIL && !rest.includes('--help')) fail('simulated setup failure');

if (group === 'scope' && command === 'apply' && rest.includes('--help')) {
  console.log([
    'Usage: setup.mjs scope apply --scope <user|project> --profile <id>',
    '  [--default-timeout-ms <ms>] [--search-timeout-ms <ms>] [--recall-min-prompt-length <chars>]',
    ...(supportsAgentId ? ['  [--agent-id <id>]'] : []),
    '  [--update-check <enabled|disabled>] [--update-check-interval-hours <hours>] [--cwd <dir>]',
  ].join('\n'));
  process.exit(0);
}

if (group === 'profile' && command === 'save-key') {
  const options = parse(rest);
  if (!options.profile || !options['api-key-env']) fail('profile save-key needs --profile and --api-key-env');
  const keyPresent = Boolean(process.env[options['api-key-env']]);
  log(`setup key-variable=${options['api-key-env']} key-present=${keyPresent}`);
  if (!keyPresent) fail(`The environment variable ${options['api-key-env']} is empty.`);
  const mem9Home = process.env.MEM9_HOME || path.join(os.homedir(), '.mem9');
  fs.mkdirSync(mem9Home, { recursive: true });
  const file = path.join(mem9Home, '.credentials.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { profiles: {} };
  existing.profiles[options.profile] = { baseUrl: options['base-url'] ?? '', apiKey: process.env[options['api-key-env']] };
  fs.writeFileSync(file, JSON.stringify(existing, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'ok', command: 'profile save-key', profileId: options.profile, action: 'saved', baseUrl: options['base-url'] ?? '', credentialsPath: file, apiKeyEnv: options['api-key-env'], backups: [] }));
  process.exit(0);
}

if (group === 'scope' && command === 'apply') {
  const options = parse(rest);
  if (!['user', 'project'].includes(options.scope) || !options.profile) fail('scope apply needs --scope <user|project> and --profile <id>');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.scope === 'project') {
    let dir = cwd;
    let inside = false;
    for (;;) {
      if (fs.existsSync(path.join(dir, '.git'))) { inside = true; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!inside) fail('Current directory is not inside a Git repository. Run `$mem9:setup` from a project before applying project scope.');
    const configPath = path.join(cwd, '.codex', 'mem9', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const config = { ...existing, schemaVersion: 1, profileId: options.profile };
    if (options['agent-id'] !== undefined) config.agentId = options['agent-id'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(JSON.stringify({ status: 'ok', command: 'scope apply', scope: 'project', profileId: options.profile, action: 'applied', configSummary: config, configPath, backups: [] }));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'ok', command: 'scope apply', scope: 'user', profileId: options.profile, action: 'applied', backups: [] }));
  process.exit(0);
}

fail(`Unknown command: ${args.join(' ')}`);
