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

export function normalizeUrl(raw) {
  const trimmed = String(raw).trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliError(`${SERVER_VARIABLE} is not a valid address.`, {
      next: 'Set it to a full address such as https://host.example.com in the .env file.',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`${SERVER_VARIABLE} must start with http:// or https://.`, {
      next: 'Fix the address in the .env file.',
    });
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

// A flag wins over the environment variable, which wins over the default.
export function resolveWorkdir({ flag, env, fallback }) {
  return path.resolve(flag || env.SHAREDMEM_WORKDIR || fallback);
}

// A variable already set in the process environment wins over the environment file.
export function loadServerUrl({ workdir, env }) {
  if (env[SERVER_VARIABLE]) return normalizeUrl(env[SERVER_VARIABLE]);
  const file = path.join(workdir, '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CliError(`${SERVER_VARIABLE} is not set and there is no .env file in ${workdir}.`, {
        next: 'Copy .env.example to .env and set SHAREDMEM_API_URL to the development server address.',
      });
    }
    throw error;
  }
  const value = parseEnvFile(text)[SERVER_VARIABLE];
  if (!value) {
    throw new CliError(`The .env file does not define ${SERVER_VARIABLE}.`, {
      next: 'Add a line SHAREDMEM_API_URL=<development server address> to the .env file.',
    });
  }
  return normalizeUrl(value);
}
