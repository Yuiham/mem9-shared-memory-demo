// How a Chain gets created. Two ways, chosen by the settings present:
//   - through the mem9 Admin API, which the hosted mem9 service needs: the Chain is
//     registered in the Console of a Project and the Administrator holds an Admin API key;
//   - directly on a mem9 server, which a server the Administrator runs allows: the server
//     may ask for a create secret as a Bearer credential, or may not.
// Either way the result is the same: the Chain's id and name, how it was created, and the
// management key and the memory key it was issued, shown once.
import { CliError } from '../shared/cli.mjs';
import { loadSetting, normalizeUrl } from '../shared/env.mjs';
import { ApiError, createApiClient } from '../shared/http.mjs';

export const ADMIN_URL_VARIABLE = 'SHAREDMEM_ADMIN_API_URL';
export const ADMIN_KEY_VARIABLE = 'SHAREDMEM_ADMIN_API_KEY';
export const PROJECT_VARIABLE = 'SHAREDMEM_PROJECT_ID';
export const CREATE_SECRET_VARIABLE = 'SHAREDMEM_CREATE_SECRET';
const ADMIN_VARIABLES = [ADMIN_URL_VARIABLE, ADMIN_KEY_VARIABLE, PROJECT_VARIABLE];

// How a Chain was created, as the state records it. `teardown` reads it: a Chain registered
// in the Console is never deleted on the mem9 server.
export const ORIGIN_ADMIN_API = 'admin-api';
export const ORIGIN_SERVER = 'mem9';

const GUIDE = 'See "Before you start" in docs/administrator-guide.md.';

// The Admin API settings are all present, or all absent; the create secret is optional.
// Everything secret is registered with the redactor before anything can be printed.
export function loadCreationSettings({ workdir, env, io }) {
  const [url, key, projectId] = ADMIN_VARIABLES.map((name) => loadSetting({ workdir, env, name }));
  const present = [url, key, projectId].filter(Boolean).length;
  if (present === 3) {
    const adminUrl = normalizeUrl(url, ADMIN_URL_VARIABLE);
    io.redactor.addAddress(adminUrl, '<admin-api-address>');
    io.redactor.addSecret(key);
    io.redactor.addSecret(projectId);
    return { way: 'admin', adminUrl, adminKey: key, projectId };
  }
  if (present > 0) {
    const missing = ADMIN_VARIABLES.filter((name, index) => ![url, key, projectId][index]);
    throw new CliError(`Some of the Admin API settings are missing: ${missing.join(', ')}.`, {
      next: `Set all three of ${ADMIN_VARIABLES.join(', ')} to create Chains through the mem9 Admin API, or none of them to create Chains directly on the server. ${GUIDE}`,
    });
  }
  const secret = loadSetting({ workdir, env, name: CREATE_SECRET_VARIABLE }) ?? null;
  if (secret) io.redactor.addSecret(secret);
  return { way: 'direct', secret };
}

// A key that the answer must carry, with the role it was issued for.
function issued(body, field, role) {
  const binding = body?.[field];
  return binding?.role === role && typeof binding.chain_api_key === 'string' && binding.chain_api_key !== '' ? binding.chain_api_key : null;
}

function normalize(body, chainField, origin) {
  const chain = body?.[chainField];
  const managementKey = issued(body, 'management_binding', 'management');
  const memoryKey = issued(body, 'memory_binding', 'memory');
  if (typeof chain?.id !== 'string' || !managementKey || !memoryKey) {
    throw new CliError('The answer to creating a Chain does not carry both a management key and a memory key.', {
      next: 'This demo needs a mem9 server that issues the two keys. Update the server, or use a version of the demo that matches it.',
    });
  }
  return { id: chain.id, name: chain.name, origin, managementKey, memoryKey };
}

const adminError = (error, name) => {
  const outcome = {
    400: ['The mem9 Admin API did not accept the request to create a Chain (400).', `Check ${PROJECT_VARIABLE}. ${GUIDE}`],
    401: ['The mem9 Admin API did not accept the Admin API key (401).', `Check ${ADMIN_KEY_VARIABLE}: the key must exist and be active. ${GUIDE}`],
    403: ['This Admin API key may not create Chains in this Project (403).', 'The owner of the key must be an owner or admin of the organization the Project belongs to.'],
    404: ['The mem9 Admin API does not know this Project (404).', `Check ${PROJECT_VARIABLE} and ${ADMIN_URL_VARIABLE}. ${GUIDE}`],
    409: [`A Chain named "${name}" already exists in the Project (409).`, 'Delete it in the Console, then run `sharedmem-admin init` again.'],
    502: ['The mem9 Admin API could not reach the mem9 server (502).', 'Run the command again. Chains that were created are kept.'],
    503: ['The mem9 Admin API is not available right now (503).', 'Run the command again. Chains that were created are kept.'],
  }[error.status];
  return outcome ? new CliError(outcome[0], { next: outcome[1] }) : error;
};

// `mem9` is the Administrator's mem9 module; the Admin API gets a client of its own.
export function createChainMaker({ settings, mem9 }) {
  if (settings.way === 'admin') {
    const api = createApiClient(settings.adminUrl, { identify: false, label: 'mem9 Admin API', addressVariable: ADMIN_URL_VARIABLE });
    return {
      way: 'admin',
      describe: 'through the Admin API',
      async create(name, description) {
        try {
          const body = await api.request('POST', '/v1/space-chains', {
            bearer: settings.adminKey,
            body: { project_id: settings.projectId, name, description },
          });
          return normalize(body, 'space_chain', ORIGIN_ADMIN_API);
        } catch (error) {
          throw error instanceof ApiError ? adminError(error, name) : error;
        }
      },
    };
  }
  return {
    way: 'direct',
    describe: 'directly on the server',
    async create(name, description) {
      try {
        return normalize(await mem9.createChain(name, description, { secret: settings.secret }), 'chain', ORIGIN_SERVER);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (settings.secret) {
          throw new CliError('The server did not accept the create secret (401).', {
            next: `Check that ${CREATE_SECRET_VARIABLE} is the secret this server was set up with. ${GUIDE}`,
          });
        }
        throw new CliError(`This server requires a credential to create a Chain. For the hosted mem9 service, set ${ADMIN_VARIABLES.join(', ').replace(/, ([^,]*)$/, ' and $1')} in .env. For a server you run yourself, set ${CREATE_SECRET_VARIABLE} to its create secret.`, {
          next: GUIDE.replace(/^See/, 'see'),
        });
      }
    },
  };
}
