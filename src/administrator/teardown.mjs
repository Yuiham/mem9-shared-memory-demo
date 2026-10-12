// teardown: deletes the Chains the state records. Spaces and their Memories stay,
// because the server cannot delete Spaces.
import { parseOptions, renderHelp } from '../shared/cli.mjs';
import { confirm } from '../shared/prompt.mjs';
import { ApiError } from '../shared/http.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';

const OPTIONS = [
  { name: 'yes', short: 'y', type: 'boolean', description: 'Delete without asking.' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '[options]',
  summary: 'Deletes the Chains this demo created.',
  changes: [
    'On the server: deletes every Chain recorded in the state, and with it the Chain\'s webhooks. A Chain the server no longer knows counts as already deleted.',
    'Spaces cannot be deleted: every Space and its Memories remain on the server. The state keeps their keys, so a later init reuses them.',
    'Locally: removes the deleted Chains (and their webhook records) from state/state.json; the Spaces stay recorded.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin teardown          # list the Chains, then ask',
    'sharedmem-admin teardown --yes    # delete without asking',
  ],
  next: 'Run `sharedmem-admin init` to build the Chains again on the same Spaces.',
};

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  const { store, mem9 } = openContext({ io, env, workdirFlag: values.workdir });
  const names = Object.keys(store.state?.chains ?? {});
  if (names.length === 0) {
    io.out('Nothing to tear down: no Chains are recorded in the state.');
    return 0;
  }
  io.out('This will delete these Chains on the server:');
  for (const name of names) io.out(`  - ${store.state.chains[name].name}`);
  io.out('Spaces cannot be deleted. Every Space and its Memories remain, and the state keeps their keys.');
  if (!(await confirm(io, 'Delete these Chains?', { yes: values.yes }))) {
    io.out('Cancelled. Nothing was changed.');
    return 1;
  }
  for (const name of names) {
    const chain = store.state.chains[name];
    let note = 'deleted';
    try {
      await mem9.deleteChain(chain);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      note = 'already deleted (the server no longer knows it)';
    }
    delete store.state.chains[name];
    delete store.state.webhooks[name];
    store.save();
    io.out(`  ${chain.name}: ${note}`);
  }
  store.state.participants = [];
  store.save();
  io.out('');
  io.out('Done: the Chains are deleted. Spaces and their Memories remain on the server.');
  io.out(`Next step: ${HELP.next.replace(/^Run /, 'run ')}`);
  return 0;
}

export const summary = 'Delete the Chains this demo created (Spaces cannot be deleted).';
