// Working directory, environment file and server address.
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

export const SERVER_VARIABLE = 'SHAREDMEM_API_URL';

export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function normalizeUrl(raw, variable = SERVER_VARIABLE) {
  const trimmed = String(raw).trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliError(`${variable} is not a valid address.`, {
      next: 'Set it to a full address such as https://host.example.com in the .env file.',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`${variable} must start with http:// or https://.`, {
      next: 'Fix the address in the .env file.',
    });
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

// The settings in the working directory's environment file, or null when there is no such file.
function readEnvFile(workdir) {
  try {
    return parseEnvFile(fs.readFileSync(path.join(workdir, '.env'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// An optional setting: the process environment wins over the environment file, and a
// setting that is nowhere is `undefined`, not an error.
export function loadSetting({ workdir, env, name }) {
  if (env[name]) return env[name].trim() || undefined;
  return readEnvFile(workdir)?.[name]?.trim() || undefined;
}

// A flag wins over the environment variable, which wins over the default.
export function resolveWorkdir({ flag, env, fallback }) {
  return path.resolve(flag || env.SHAREDMEM_WORKDIR || fallback);
}

// A variable already set in the process environment wins over the environment file.
export function loadServerUrl({ workdir, env }) {
  if (env[SERVER_VARIABLE]) return normalizeUrl(env[SERVER_VARIABLE]);
  const file = readEnvFile(workdir);
  if (file === null) {
    throw new CliError(`${SERVER_VARIABLE} is not set and there is no .env file in ${workdir}.`, {
      next: 'Copy .env.example to .env and set SHAREDMEM_API_URL to the mem9 server address.',
    });
  }
  const value = file[SERVER_VARIABLE];
  if (!value) {
    throw new CliError(`The .env file does not define ${SERVER_VARIABLE}.`, {
      next: 'Add a line SHAREDMEM_API_URL=<mem9 server address> to the .env file.',
    });
  }
  return normalizeUrl(value);
}
