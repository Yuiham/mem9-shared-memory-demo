// memories: shows where Memories landed. It only reads.
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { displayName, SHARED_SPACES } from './layout.mjs';

const OPTIONS = [
  { name: 'space', type: 'string', placeholder: 'name', description: 'List one Space: team-shared, leadership-shared, or a participant\'s name for their Personal space.' },
  { name: 'as', type: 'string', placeholder: 'person', description: 'Show what one participant sees through their Chain, with the Space each Memory came from.' },
  { name: 'all-types', type: 'boolean', description: 'Include session Memories (the raw conversation). By default only pinned and insight Memories are shown.' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '[--space <name> | --as <person>] [options]',
  summary: 'Shows where Memories landed: counts per Space, one Space\'s Memories, or what one participant sees.',
  changes: ['Nothing: it only reads from the server and prints.'],
  options: OPTIONS,
  examples: [
    'sharedmem-admin memories                       # counts for every Space',
    'sharedmem-admin memories --space team-shared   # what Team Shared holds',
    'sharedmem-admin memories --as ana              # what ana sees through her Chain',
    'sharedmem-admin memories --space ana --all-types',
  ],
  next: 'Run `sharedmem-admin verify` to check that the Routing prompts send each Case where it belongs.',
};

const LONG_TERM = ['pinned', 'insight'];
const SHOWN = 200;

const spaceLabel = (name) => (SHARED_SPACES.includes(name) ? `${name} (${displayName(name)})` : `${name} (Personal)`);
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 160);

function requireState(store) {
  if (!store.state || Object.keys(store.state.spaces).length === 0) {
    throw new CliError('Nothing is set up yet: there is no state in this working directory.', { next: 'Run `sharedmem-admin init` first.' });
  }
  return store.state;
}

function printRows(io, rows, { withSource }) {
  for (const memory of rows) {
    const source = withSource ? `  from=${withSource(memory)}` : '';
    io.out(`  ${`[${memory.memory_type}]`.padEnd(10)} agent=${memory.agent_id || '-'}${source}  ${oneLine(memory.content)}`);
  }
}

async function summarize({ ctx, types }) {
  const { io, store, mem9 } = ctx;
  const state = requireState(store);
  const names = [...state.participants.map((person) => person.name), ...SHARED_SPACES].filter((name) => state.spaces[name]);
  const counts = new Map();
  for (const name of names) {
    const row = [];
    for (const type of types) row.push((await mem9.listPage(state.spaces[name].key, { memory_type: type, limit: 1 })).total);
    counts.set(name, row);
  }
  const width = Math.max(...names.map((name) => spaceLabel(name).length), 'Space'.length);
  io.out(`Memory counts per Space (${types.join(', ')}):`);
  io.out('');
  io.out(`  ${'Space'.padEnd(width)}  ${types.map((type) => type.padStart(7)).join('  ')}`);
  for (const name of names) io.out(`  ${spaceLabel(name).padEnd(width)}  ${counts.get(name).map((count) => String(count).padStart(7)).join('  ')}`);
  return 0;
}

async function listSpace({ ctx, space, types }) {
  const { io, store, mem9 } = ctx;
  const state = requireState(store);
  if (!state.spaces[space]) {
    throw new CliError(`Unknown Space: ${space}.`, { next: `Use one of: ${Object.keys(state.spaces).join(', ')}.` });
  }
  const rows = [];
  let total = 0;
  for (const type of types) {
    const page = await mem9.listPage(state.spaces[space].key, { memory_type: type });
    rows.push(...page.memories);
    total += page.total;
  }
  io.out(`${spaceLabel(space)}: ${rows.length} of ${total} Memories shown (${types.join(', ')}).`);
  io.out('');
  printRows(io, rows, {});
  if (total > rows.length) io.out(`\n  Only the first ${SHOWN} of each type are shown.`);
  return 0;
}

async function listAs({ ctx, person, types }) {
  const { io, store, mem9 } = ctx;
  const state = requireState(store);
  const chain = state.chains[person];
  if (!chain) {
    throw new CliError(`Unknown participant: ${person}.`, { next: `Use one of: ${state.participants.map((entry) => entry.name).join(', ')}.` });
  }
  const spaceOf = new Map(Object.entries(state.spaces).map(([name, space]) => [space.key, name]));
  const sourceOf = (memory) => {
    const name = spaceOf.get(memory.chain_source?.tenant_id);
    if (!name) return memory.chain_source?.external_space_id || 'unknown';
    return SHARED_SPACES.includes(name) ? displayName(name) : 'Personal';
  };
  const rows = [...(await mem9.listPage(chain.key)).memories];
  if (!types.every((type) => LONG_TERM.includes(type))) rows.push(...(await mem9.listPage(chain.key, { memory_type: 'session' })).memories);
  io.out(`What ${person} sees through their Chain: ${rows.length} Memories (${types.join(', ')}).`);
  io.out('');
  printRows(io, rows, { withSource: sourceOf });
  return 0;
}

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  if (values.space !== undefined && values.as !== undefined) {
    throw new UsageError('Use --space or --as, not both.', { next: `Run \`${program} --help\` to see the options.` });
  }
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const types = values['all-types'] ? [...LONG_TERM, 'session'] : LONG_TERM;
  if (values.space !== undefined) return listSpace({ ctx, space: values.space, types });
  if (values.as !== undefined) return listAs({ ctx, person: values.as, types });
  return summarize({ ctx, types });
}

export const summary = 'Show where Memories landed: counts, one Space, or what one participant sees.';
