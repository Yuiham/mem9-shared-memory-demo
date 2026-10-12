// candidates: the approver's view of the announcements the Approval Example held back.
// Approving writes the announcement, word for word, into Team Shared.
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { CandidateStore } from './candidate-store.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { displayName, TEAM } from './layout.mjs';

const OPTIONS = [
  { name: 'include-test', type: 'boolean', description: 'List also the Candidates that `verify` caused (list only).' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '[list | approve <id> | reject <id>] [options]',
  summary: 'Lists the announcements waiting for approval, and approves or rejects them.',
  changes: [
    'list (the default): shows the Candidates, newest last. Candidates that `verify` caused are hidden unless --include-test is given. Nothing changes.',
    'approve <id>: writes the Candidate\'s text, word for word, into Team Shared as a pinned Memory attributed to the Leader who announced it, and then records the approval. If the write fails the Candidate stays pending.',
    'reject <id>: marks the Candidate rejected. Nothing is written to the server.',
    'Only a pending Candidate can be approved or rejected. Candidates live in state/candidates.json.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin candidates',
    'sharedmem-admin candidates approve c1',
    'sharedmem-admin candidates reject c2',
  ],
  next: 'After approving, check Team Shared with `sharedmem-admin memories --space team-shared`, or ask a Developer\'s agent about it.',
};

const origin = (candidate) => (candidate.simulated ? 'simulated' : candidate.test ? 'test' : 'real');
const stamp = (iso) => String(iso ?? '').replace('T', ' ').slice(0, 16);

function list(values, { io, env }) {
  const { workdir } = openContext({ io, env, workdirFlag: values.workdir });
  const all = new CandidateStore({ workdir }).read().candidates;
  const shown = values['include-test'] ? all : all.filter((candidate) => !candidate.test);
  if (shown.length === 0) {
    io.out('No Candidates yet.');
    io.out('A Leader\'s announcement becomes a Candidate when the receiver is running and the Approval Example is active. `sharedmem-admin simulate` creates one without a public address.');
    return 0;
  }
  const pending = shown.filter((candidate) => candidate.status === 'pending').length;
  io.out(`${shown.length} ${shown.length === 1 ? 'Candidate' : 'Candidates'}, ${pending} pending:`);
  for (const candidate of shown) {
    io.out(`  ${candidate.id}  ${candidate.status.padEnd(8)}  ${candidate.leader}  ${origin(candidate).padEnd(9)}  ${stamp(candidate.receivedAt)}`);
    io.out(`      ${candidate.text}`);
  }
  const hidden = all.length - shown.length;
  if (hidden > 0) io.out(`(${hidden} test ${hidden === 1 ? 'Candidate is' : 'Candidates are'} hidden; add --include-test to see them.)`);
  if (pending > 0) io.out('Next step: run `sharedmem-admin candidates approve <id>` or `sharedmem-admin candidates reject <id>`.');
  return 0;
}

function pendingCandidate(store, id, verb) {
  const candidate = store.find(id);
  if (!candidate) {
    throw new CliError(`There is no Candidate ${id}.`, { next: 'Run `sharedmem-admin candidates --include-test` to see every id.' });
  }
  if (candidate.status !== 'pending') {
    throw new CliError(`Candidate ${id} is already ${candidate.status}, so it cannot be ${verb}.`, { next: 'Only a pending Candidate can be approved or rejected.' });
  }
  return candidate;
}

async function approve(id, { io, env, values }) {
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const store = new CandidateStore({ workdir: ctx.workdir });
  const candidate = pendingCandidate(store, id, 'approved');
  const teamKey = ctx.store.state?.spaces?.[TEAM]?.key;
  if (!teamKey) throw new CliError(`${displayName(TEAM)} is not in the state.`, { next: 'Run `sharedmem-admin init` first.' });
  const memory = await ctx.mem9.writePinned(teamKey, { text: candidate.text, agentId: candidate.leader });
  const decided = store.decide(id, { status: 'approved', memoryId: memory?.id ?? null });
  io.out(`Approved ${id}: written to ${displayName(TEAM)} as a pinned Memory from ${candidate.leader}.`);
  if (!decided) io.out(`Candidate ${id} was decided by another process while the Memory was being written; the Memory is in ${displayName(TEAM)}.`);
  io.out('Next step: check Team Shared with `sharedmem-admin memories --space team-shared`, or ask a Developer\'s agent about it.');
  return 0;
}

function reject(id, { io, env, values }) {
  const { workdir } = openContext({ io, env, workdirFlag: values.workdir });
  const store = new CandidateStore({ workdir });
  pendingCandidate(store, id, 'rejected');
  if (!store.decide(id, { status: 'rejected' })) {
    throw new CliError(`Candidate ${id} was decided by another process.`, { next: 'Run `sharedmem-admin candidates` to see its state.' });
  }
  io.out(`Rejected ${id}. Nothing was written to the server.`);
  return 0;
}

export async function run(argv, { io, env, program }) {
  const { values, positionals } = parseOptions(program, OPTIONS, argv, { positionals: { min: 0, max: 2, label: 'list, approve <id> or reject <id>' } });
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  const [verb = 'list', id] = positionals;
  const context = { io, env, values };
  if (verb === 'list' && id === undefined) return list(values, context);
  if (verb === 'approve' || verb === 'reject') {
    if (!id || positionals.length !== 2) throw new UsageError(`${program} ${verb} needs a Candidate id.`, { next: `Run \`${program} ${verb} <id>\`; \`${program}\` lists the ids.` });
    if (values['include-test']) throw new UsageError('--include-test only applies to listing Candidates.', { next: `Run \`${program} --include-test\` to list them.` });
    return verb === 'approve' ? approve(id, context) : reject(id, context);
  }
  throw new UsageError(`Unknown ${program} subcommand: ${verb}.`, { next: `Use one of: list, approve <id>, reject <id>. Run \`${program} --help\` for details.` });
}

export const summary = 'List, approve or reject the announcements waiting for approval.';
