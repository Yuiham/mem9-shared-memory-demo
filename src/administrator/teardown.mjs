// teardown: deletes the Chains the state records. Spaces and their Memories stay,
// because the server cannot delete Spaces. A Chain created through the Admin API is
// registered in the Console, so teardown does not delete it on the server: that would leave
// a registration the Console can no longer delete. It forgets the Chain here and says to
// delete it in the Console.
import { parseOptions, renderHelp } from '../shared/cli.mjs';
import { confirm } from '../shared/prompt.mjs';
import { ApiError } from '../shared/http.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { ORIGIN_ADMIN_API } from './creation.mjs';

const OPTIONS = [
  { name: 'yes', short: 'y', type: 'boolean', description: 'Delete without asking.' },
  ...COMMON_OPTIONS,
];

const BUILD_AGAIN = 'build the Chains again on the same Spaces';

const HELP = {
  usage: '[options]',
  summary: 'Deletes the Chains this demo created.',
  changes: [
    'On the server: deletes every Chain that init created directly on the mem9 server, and with it the Chain\'s webhooks. A Chain the server no longer knows counts as already deleted.',
    'A Chain that init created through the Admin API is registered in the Console, so it is not deleted on the server: teardown only forgets it here, and you delete it in the Console. Until then init cannot create a Chain with the same name in the same Project.',
    'Spaces cannot be deleted: every Space and its Memories remain on the server. The state keeps their keys, so a later init reuses them.',
    'Locally: removes the Chains (and their webhook records) from state/state.json; the Spaces stay recorded.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin teardown          # list the Chains, then ask',
    'sharedmem-admin teardown --yes    # delete without asking',
  ],
  next: `Run \`sharedmem-admin init\` to ${BUILD_AGAIN}. A Chain that teardown listed as registered in the Console has to be deleted there first.`,
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
  const registered = names.filter((name) => store.state.chains[name].origin === ORIGIN_ADMIN_API);
  const direct = names.filter((name) => !registered.includes(name));
  if (direct.length > 0) {
    io.out('This will delete these Chains on the server:');
    for (const name of direct) io.out(`  - ${store.state.chains[name].name}`);
  }
  if (registered.length > 0) {
    io.out('These Chains are registered in the Console. Teardown does not delete them on the server, because the Console could then no longer delete them. It only forgets them here; delete them in the Console:');
    for (const name of registered) io.out(`  - ${store.state.chains[name].name}`);
  }
  io.out('Spaces cannot be deleted. Every Space and its Memories remain, and the state keeps their keys.');
  if (!(await confirm(io, direct.length > 0 ? 'Delete these Chains?' : 'Forget these Chains?', { yes: values.yes }))) {
    io.out('Cancelled. Nothing was changed.');
    return 1;
  }
  for (const name of names) {
    const chain = store.state.chains[name];
    let note = 'deleted';
    if (registered.includes(name)) {
      note = 'left on the server (registered in the Console; delete it there)';
    } else {
      try {
        await mem9.deleteChain(chain);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        note = 'already deleted (the server no longer knows it)';
      }
    }
    delete store.state.chains[name];
    delete store.state.webhooks[name];
    store.save();
    io.out(`  ${chain.name}: ${note}`);
  }
  store.state.participants = [];
  store.save();
  io.out('');
  if (registered.length === 0) {
    io.out('Done: the Chains are deleted. Spaces and their Memories remain on the server.');
    io.out(`Next step: run \`sharedmem-admin init\` to ${BUILD_AGAIN}.`);
  } else {
    io.out(`Done: ${direct.length} deleted on the server, ${registered.length} forgotten here and left registered in the Console. Spaces and their Memories remain on the server.`);
    io.out(`Next step: delete the Chains listed above in the Console, then run \`sharedmem-admin init\` to ${BUILD_AGAIN}.`);
  }
  return 0;
}

export const summary = 'Delete the Chains this demo created (Spaces cannot be deleted).';
