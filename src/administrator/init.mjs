// init: creates or reuses the Spaces and Chains for the cast, applies the Routing prompts
// and the chosen Example, and writes the Seed memories that are not there yet.
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { confirm } from '../shared/prompt.mjs';
import { ApiError } from '../shared/http.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { loadDemoCast, loadPrompts, loadSeeds } from './content.mjs';
import { chainNameFor, displayName, EXAMPLES, nodeLayout, policyMatches, SHARED_SPACES } from './layout.mjs';

const OPTIONS = [
  { name: 'example', type: 'string', placeholder: 'basic|approval', description: 'Which Example to apply. Default: the recorded one, or basic on the first run.' },
  { name: 'cast', type: 'string', placeholder: 'file', description: 'A cast file to use instead of config/cast.json.' },
  { name: 'yes', short: 'y', type: 'boolean', description: 'Apply the plan without asking.' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '[options]',
  summary: 'Creates (or reuses) the Spaces and Chains for the cast, applies the Routing prompts and the chosen Example, and writes the Seed memories.',
  changes: [
    'On the server: provisions one Personal space per participant plus Team Shared and Leadership Shared, creates one Chain per participant, sets each Chain\'s nodes and routing policies, and writes the Seed memories that are not already there.',
    'Locally: writes state/state.json (mode 600) and a backup next to it. The state holds every key, so keep it private.',
    'Safe to re-run: what already exists is reused. Re-run with the other --example to switch Examples; chain keys do not change.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin init                      # show the plan, then ask',
    'sharedmem-admin init --yes                # apply without asking (the Basic Example the first time)',
    'sharedmem-admin init --example approval   # switch to the Approval Example',
  ],
  next: 'Run `sharedmem-admin verify` to check the Routing prompts, or `sharedmem-admin export` to build the Kits.',
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function checkCastAgainstState(participants, state) {
  const recorded = state?.participants ?? [];
  const wanted = new Map(participants.map((participant) => [participant.name, participant.role]));
  const problems = [
    ...recorded.filter((person) => !wanted.has(person.name)).map((person) => `${person.name} (removed from the cast)`),
    ...recorded.filter((person) => wanted.has(person.name) && wanted.get(person.name) !== person.role).map((person) => `${person.name} (role changed)`),
  ];
  if (problems.length > 0) {
    throw new CliError(`The cast no longer matches the Chains already created: ${problems.join(', ')}.`, {
      next: 'Run `sharedmem-admin teardown` first, then run init again with the new cast. The Spaces are kept and reused.',
    });
  }
}

function describePlan({ participants, state, example }) {
  const spaces = [...participants.map((person) => person.name), ...SHARED_SPACES];
  const toCreate = spaces.filter((name) => !state?.spaces?.[name]);
  const chainsToCreate = participants.filter((person) => !state?.chains?.[person.name]);
  const recorded = state?.example;
  const exampleText = !recorded ? `${example} (first run)` : recorded === example ? `${example} (unchanged)` : `${example} (switching from ${recorded})`;
  return [
    'Plan:',
    `  - Example: ${exampleText}.`,
    `  - ${plural(spaces.length, 'Space')} in total (${participants.length} Personal, 2 Shared); ${toCreate.length} still to create.`,
    `  - ${plural(participants.length, 'Chain')} in total; ${chainsToCreate.length} still to create. Nodes and routing policies are checked on the server and only differences are changed.`,
    `  - Seed memories are written to Team Shared and Leadership Shared when they are not already there.`,
    '  - Local files: state/state.json and its backup in the working directory.',
  ];
}

async function provisionSpaces({ ctx, participants }) {
  const { store, mem9, io } = ctx;
  for (const name of [...participants.map((person) => person.name), ...SHARED_SPACES]) {
    if (store.state.spaces[name]) continue;
    const key = await mem9.provisionSpace();
    store.state.spaces[name] = { key };
    store.save();
    io.out(`  provisioned ${SHARED_SPACES.includes(name) ? displayName(name) : `the Personal space of ${name}`}`);
  }
}

async function createChain({ ctx, person }) {
  const { store, mem9 } = ctx;
  const created = await mem9.createChain(chainNameFor(person.name), `Shared-memory demo Chain for ${person.name}`);
  store.state.chains[person.name] = { id: created.chain.id, name: created.chain.name, key: created.chain_api_key, nodes: [] };
  store.save();
}

async function configureChain({ ctx, person, example, prompts }) {
  const { store, mem9, io } = ctx;
  const { state } = store;
  let known = null;
  try {
    known = await mem9.chainByKey(state.chains[person.name].key);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    await createChain({ ctx, person });
    io.out(`  the server no longer knows the Chain of ${person.name}; a new Chain was created again on the same Spaces (its key changed, so export the Kits again)`);
  }
  const chain = state.chains[person.name];
  const layout = nodeLayout(person, example, prompts);
  const tenant = (space) => state.spaces[space].key;
  const current = [...(known?.nodes ?? [])].sort((a, b) => a.position - b.position);
  const sameNodes = current.length === layout.length && layout.every((wanted, index) => (
    current[index].tenant_id === tenant(wanted.space)
    && (current[index].external_space_id ?? '') === wanted.externalSpaceId
    && (current[index].display_name ?? '') === wanted.displayName
  ));
  let nodes = current;
  if (!sameNodes) {
    nodes = await mem9.setNodes(chain, layout.map((wanted) => ({
      tenant_id: tenant(wanted.space),
      ...(wanted.externalSpaceId ? { external_space_id: wanted.externalSpaceId } : {}),
      display_name: wanted.displayName,
    })));
    nodes.sort((a, b) => a.position - b.position);
  }
  const spaceOf = new Map(Object.entries(state.spaces).map(([name, space]) => [space.key, name]));
  chain.nodes = nodes.map((node) => ({ id: node.id, space: spaceOf.get(node.tenant_id), position: node.position, externalSpaceId: node.external_space_id ?? '' }));
  store.save();
  let changed = 0;
  for (const [index, wanted] of layout.entries()) {
    if (index === 0 || policyMatches(nodes[index], wanted.policy)) continue;
    await mem9.setRoutingPolicy(chain, nodes[index].id, wanted.policy);
    changed += 1;
  }
  io.out(`  ${person.name}: ${sameNodes ? 'nodes unchanged' : 'nodes set'}, ${plural(changed, 'routing policy')} updated`);
}

async function writeSeeds({ ctx, seeds }) {
  const { store, mem9, io } = ctx;
  const existing = new Map();
  let written = 0;
  for (const seed of seeds) {
    const key = store.state.spaces[seed.space].key;
    if (!existing.has(seed.space)) existing.set(seed.space, await mem9.listMemories(key, { memory_type: 'pinned', agent_id: 'seed' }));
    if (existing.get(seed.space).some((memory) => memory.content === seed.text)) continue;
    await mem9.writePinned(key, { text: seed.text, agentId: 'seed', tags: ['seed'] });
    written += 1;
  }
  io.out(`  seed memories: ${written} written, ${seeds.length - written} already present`);
}

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  if (values.example !== undefined && !EXAMPLES.includes(values.example)) {
    throw new UsageError(`Unknown Example: ${values.example}. The Example must be basic or approval.`, { next: 'Run again with --example basic or --example approval.' });
  }
  const cast = loadDemoCast(values.cast);
  const prompts = loadPrompts();
  const seeds = loadSeeds();
  for (const seed of seeds) {
    if (!SHARED_SPACES.includes(seed.space)) throw new CliError(`Seed memory ${seed.id} names an unknown Space: ${seed.space}.`, { next: 'Use team-shared or leadership-shared in config/seed-memories.json.' });
  }
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const { store } = ctx;
  const participants = cast.participants.map(({ name, role }) => ({ name, role }));
  checkCastAgainstState(participants, store.state);
  const example = values.example ?? store.state?.example ?? 'basic';

  io.out(describePlan({ participants, state: store.state, example }).join('\n'));
  if (example === 'approval' && !Object.keys(store.state?.webhooks ?? {}).length) {
    io.warnOnce('approval-no-webhook', 'The Approval Example is being applied but no webhook is registered, so announcements will be lost until you run `sharedmem-admin webhook set`.');
  }
  if (!(await confirm(io, 'Apply this plan?', { yes: values.yes }))) {
    io.out('Cancelled. Nothing was changed.');
    return 1;
  }

  if (!store.state) store.create({ example });
  store.state.example = example;
  store.state.participants = participants;
  store.save();

  io.out('Working:');
  await provisionSpaces({ ctx, participants });
  for (const person of participants) if (!store.state.chains[person.name]) await createChain({ ctx, person });
  for (const person of participants) await configureChain({ ctx, person, example, prompts });
  await writeSeeds({ ctx, seeds });
  store.save();

  io.out('');
  io.out(`Done: ${plural(Object.keys(store.state.spaces).length, 'Space')} and ${plural(participants.length, 'Chain')} are ready for the ${example === 'basic' ? 'Basic' : 'Approval'} Example.`);
  io.out(`Next step: ${HELP.next.replace(/^Run /, 'run ')}`);
  return 0;
}

export const summary = 'Create or reuse the Spaces and Chains, apply the Routing prompts and an Example, write Seed memories.';
