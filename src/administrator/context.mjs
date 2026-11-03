// What every command that talks to the server starts from: the working directory, the
// server address (masked in all output), the state and a mem9 client.
import { fileURLToPath } from 'node:url';
import { loadServerUrl, resolveWorkdir } from '../shared/env.mjs';
import { createApiClient } from '../shared/http.mjs';
import { createChainMaker, loadCreationSettings } from './creation.mjs';
import { createMem9 } from './mem9.mjs';
import { StateStore } from './state.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const COMMON_OPTIONS = [
  { name: 'workdir', type: 'string', placeholder: 'directory', description: 'Where .env, state/ and out/ live (default: the repository; SHAREDMEM_WORKDIR also works).' },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show this help.' },
];

// `creation: true` is for the one command that creates Chains: it also reads how to create
// them (the Admin API settings or the create secret) and returns a `chainMaker`. Every other
// command ignores those settings.
export function openContext({ io, env, workdirFlag, creation = false }) {
  const workdir = resolveWorkdir({ flag: workdirFlag, env, fallback: REPO_ROOT });
  const serverUrl = loadServerUrl({ workdir, env });
  io.redactor.addAddress(serverUrl);
  const store = new StateStore({ workdir, serverUrl, io });
  store.load();
  const mem9 = createMem9(createApiClient(serverUrl));
  const settings = creation ? loadCreationSettings({ workdir, env, io }) : null;
  if (serverUrl.startsWith('http:')) {
    const secret = settings?.way === 'direct' && settings.secret ? ' The create secret is sent to it as well.' : '';
    io.warnOnce('plain-http', `The server address uses plain HTTP, so traffic is not encrypted.${secret} Use fictional data only.`);
  }
  if (settings?.way === 'admin' && settings.adminUrl.startsWith('http:')) {
    io.warnOnce('plain-http-admin', 'The Admin API address uses plain HTTP, so the Admin API key is sent unencrypted.');
  }
  return { io, env, workdir, serverUrl, store, mem9, chainMaker: settings ? createChainMaker({ settings, mem9 }) : null };
}
