// What every command that talks to the server starts from: the working directory, the
// server address (masked in all output), the state and a mem9 client.
import { fileURLToPath } from 'node:url';
import { loadServerUrl, resolveWorkdir } from '../shared/env.mjs';
import { createApiClient } from '../shared/http.mjs';
import { createMem9 } from './mem9.mjs';
import { StateStore } from './state.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const COMMON_OPTIONS = [
  { name: 'workdir', type: 'string', placeholder: 'directory', description: 'Where .env, state/ and out/ live (default: the repository; SHAREDMEM_WORKDIR also works).' },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show this help.' },
];

export function openContext({ io, env, workdirFlag }) {
  const workdir = resolveWorkdir({ flag: workdirFlag, env, fallback: REPO_ROOT });
  const serverUrl = loadServerUrl({ workdir, env });
  io.redactor.addAddress(serverUrl);
  if (serverUrl.startsWith('http:')) {
    io.warnOnce('plain-http', 'The server address uses plain HTTP, so traffic is not encrypted. Use fictional data only.');
  }
  const store = new StateStore({ workdir, serverUrl, io });
  store.load();
  return { io, env, workdir, serverUrl, store, mem9: createMem9(createApiClient(serverUrl)) };
}
