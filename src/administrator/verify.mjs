// verify: sends every Case through the real routing path and compares where it landed
// with where it should have landed.
import crypto from 'node:crypto';
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { ApiError } from '../shared/http.mjs';
import { isPlaceholderUrl, ROUTED_EVENT, VERIFY_PREFIX } from '../shared/names.mjs';
import { CandidateStore } from './candidate-store.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { processIsAlive, readRuntime } from './receiver-runtime.mjs';
import { expectedSpaces, expectsCandidate, loadCases } from './cases.mjs';
import { displayName, LEADERSHIP, TEAM } from './layout.mjs';

const DEFAULT_WAIT_SECONDS = 15;
const POLL_MS = 250;

const OPTIONS = [
  { name: 'cases', type: 'string', placeholder: 'file', description: 'Use the Cases in this file instead of config/cases.json (for a spot check with fresh sentences).' },
  { name: 'wait', type: 'string', placeholder: 'seconds', description: `Approval Example: how long to wait for a held-back announcement to appear as a delivery record and, when the receiver runs, as a Candidate (default ${DEFAULT_WAIT_SECONDS}).` },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '[options]',
  summary: 'Sends every Case through the real routing path and shows, for each, where it should have landed and where it did.',
  changes: [
    'On the server: writes each Case as a conversation through the Chain of the first participant with the speaker\'s role, under its own Agent ID (verify-<run>-<case>) and session, then reads the speaker\'s Personal space, Team Shared and Leadership Shared. Afterwards it removes every Memory it wrote, of every type, from those Spaces.',
    'Approval Example: a Case that should become a Candidate passes when nothing reached Team Shared and the server recorded a new routed-fact delivery for the Chain. When the receiver is running and the webhook address is not a placeholder, the Candidate must also arrive; it is marked as a test Candidate and hidden from the default listing.',
    'Locally: nothing is written, except the test Candidates a running receiver stores. The exit code is 1 when a Case fails.',
    'Routing is judged by the server\'s language model, so a result is a spot check, not a guarantee.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin verify',
    'sharedmem-admin verify --cases my-fresh-cases.json',
  ],
  next: 'If a Case fails, tune the Routing prompts under config/routing-prompts/, run `sharedmem-admin init` to apply them, and verify again. When all pass, run `sharedmem-admin export`.',
};

const SPACES = ['personal', TEAM, LEADERSHIP];
const LONG_TERM = ['pinned', 'insight'];
const WORD_LABEL = { personal: 'Personal', [TEAM]: displayName(TEAM), [LEADERSHIP]: displayName(LEADERSHIP) };
const label = (words) => words.map((word) => WORD_LABEL[word]).join(', ') || '(none)';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function pickSpeaker(state, role) {
  const person = state.participants.find((entry) => entry.role === role);
  if (!person || !state.chains[person.name]) {
    throw new CliError(`There is no ${role} with a Chain in the state.`, { next: 'Run `sharedmem-admin init` first.' });
  }
  return person;
}

// Reads the Memories one Agent ID wrote in the three Spaces a Case can reach.
async function readSpaces({ ctx, speaker, agentId }) {
  const { store, mem9 } = ctx;
  const found = {};
  for (const word of SPACES) {
    const key = store.state.spaces[word === 'personal' ? speaker.name : word].key;
    found[word] = { key, rows: await mem9.listMemories(key, { agent_id: agentId }) };
  }
  return found;
}

async function removeWritten({ ctx, speaker, agentId }) {
  const found = await readSpaces({ ctx, speaker, agentId });
  for (const { key, rows } of Object.values(found)) {
    if (rows.length > 0) await ctx.mem9.deleteMemories(key, rows.map((row) => row.id));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls until `check` returns something truthy or the time is up.
async function waitUntil(check, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

const deliveryIds = async (mem9, chain) => new Set((await mem9.webhookDeliveries(chain, 200)).map((record) => record.id));

// The webhook address of a placeholder can never deliver, so no Candidate can arrive.
const isPlaceholder = (webhook) => isPlaceholderUrl(webhook.url);

// The Approval path of a Case that should become a Candidate: the server recorded a new
// routed-fact delivery for the Chain and, when a receiver can be reached, the Candidate
// arrived there. Returns { ok, note }.
async function checkApprovalPath({ ctx, speaker, agentId, seen, waitMs }) {
  const { store, mem9, workdir } = ctx;
  const chain = store.state.chains[speaker.name];
  const seconds = waitMs / 1000;
  const fresh = await waitUntil(async () => (await mem9.webhookDeliveries(chain, 200)).filter((record) => !seen.has(record.id) && record.event_type === ROUTED_EVENT).length > 0, waitMs);
  if (!fresh) {
    return { ok: false, note: `the server recorded no routed-fact delivery for this Chain within ${seconds} seconds; the Routing prompt may not have matched, or the Team Shared node is not webhook-only.` };
  }
  const runtime = readRuntime(workdir);
  if (!runtime || !processIsAlive(runtime.pid)) {
    return { ok: true, note: 'delivery recorded; start the receiver to check that the Candidate arrives too.' };
  }
  if (isPlaceholder(store.state.webhooks[speaker.name])) {
    return { ok: true, note: 'delivery recorded; the Candidate check was skipped because the webhook address is a placeholder that can never deliver.' };
  }
  const candidates = new CandidateStore({ workdir });
  const arrived = await waitUntil(() => candidates.read().candidates.some((candidate) => candidate.agentId === agentId), waitMs);
  if (!arrived) {
    return { ok: false, note: `the server recorded a delivery, but no Candidate reached the receiver within ${seconds} seconds. Check that the webhook address forwards to the receiver and that the receiver runs in this working directory.` };
  }
  return { ok: true, note: 'delivery recorded and the Candidate arrived at the receiver (marked as a test Candidate).' };
}

async function runCase({ ctx, testCase, example, runId, waitMs, written }) {
  const { store, mem9 } = ctx;
  const speaker = pickSpeaker(store.state, testCase.role);
  const agentId = `${VERIFY_PREFIX}${runId}-${testCase.id}`;
  const expected = expectedSpaces(testCase, example);
  const result = { id: testCase.id, speaker: speaker.name, expected, actual: [], status: 'fail', note: '', agentId, speakerEntry: speaker };
  const wantsCandidate = expectsCandidate(testCase, example);
  // Registered before anything is written, so the sweep also covers a Case that stops
  // halfway (a write whose answer was lost may still have created Memories).
  written.push(result);
  try {
    const seen = wantsCandidate ? await deliveryIds(mem9, store.state.chains[speaker.name]) : null;
    await mem9.writeMessages(store.state.chains[speaker.name].key, {
      messages: [{ role: 'user', content: testCase.sentence }],
      agentId,
      sessionId: agentId,
    });
    const found = await readSpaces({ ctx, speaker, agentId });
    result.actual = SPACES.filter((word) => found[word].rows.some((row) => LONG_TERM.includes(row.memory_type)));
    result.status = expected.length === result.actual.length && expected.every((word) => result.actual.includes(word)) ? 'pass' : 'fail';
    if (result.status === 'pass' && wantsCandidate) {
      const approval = await checkApprovalPath({ ctx, speaker, agentId, seen, waitMs });
      if (!approval.ok) result.status = 'fail';
      result.note = approval.note;
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    result.note = `the server answered ${error.status} to ${error.where}: ${error.message}`;
    result.status = 'fail';
  }
  return result;
}

function printTable(io, results) {
  const head = ['Case', 'Speaker', 'Expected', 'Actual', 'Result'];
  const rows = results.map((entry) => [entry.id, entry.speaker, label(entry.expected), entry.status === 'skip' ? '-' : label(entry.actual), entry.status.toUpperCase()]);
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => `  ${cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()}`;
  io.out(line(head));
  for (const row of rows) io.out(line(row));
}

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  const waitSeconds = values.wait === undefined ? DEFAULT_WAIT_SECONDS : Number(values.wait);
  if (values.wait !== undefined && !/^\d+(\.\d+)?$/.test(values.wait)) {
    throw new UsageError('--wait must be a number of seconds (0 or more).', { next: 'For example --wait 30.' });
  }
  const cases = loadCases(values.cases);
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const { state } = ctx.store;
  if (!state || Object.keys(state.chains).length === 0) {
    throw new CliError('Nothing is set up yet: the state has no Chains.', { next: 'Run `sharedmem-admin init` first.' });
  }
  const example = state.example;
  const exampleLabel = example === 'basic' ? 'Basic' : 'Approval';
  const runId = crypto.randomBytes(4).toString('hex');

  io.out(`Verify run ${runId}: ${plural(cases.length, 'Case')} against the ${exampleLabel} Example.`);
  io.out('');
  const results = [];
  const written = [];
  try {
    for (const testCase of cases) {
      if (expectsCandidate(testCase, example) && !state.webhooks?.[pickSpeaker(state, testCase.role).name]) {
        results.push({ id: testCase.id, speaker: pickSpeaker(state, testCase.role).name, expected: expectedSpaces(testCase, example), actual: [], status: 'skip', note: 'needs a webhook' });
        continue;
      }
      results.push(await runCase({ ctx, testCase, example, runId, waitMs: waitSeconds * 1000, written }));
    }
  } finally {
    // Tidy up even when the run stops early; the sweep only reads and deletes what this run wrote.
    for (const entry of written) {
      try {
        await removeWritten({ ctx, speaker: entry.speakerEntry, agentId: entry.agentId });
      } catch {
        io.warnOnce(`cleanup-${entry.id}`, `Could not remove the test Memories of Case ${entry.id}. They carry the Agent ID ${entry.agentId}.`);
      }
    }
  }

  printTable(io, results);
  io.out('');
  for (const entry of results.filter((item) => item.note && item.status !== 'skip')) io.out(`  ${entry.id}: ${entry.note}`);
  const skipped = results.filter((entry) => entry.status === 'skip');
  if (skipped.length > 0) {
    io.out(`  Skipped ${skipped.map((entry) => entry.id).join(', ')}: the ${exampleLabel} Example needs a webhook for these Cases, and no webhook is registered for the Leader they use. Run \`sharedmem-admin webhook set --url <public URL>\` first.`);
  }
  const count = (status) => results.filter((entry) => entry.status === status).length;
  io.out(`${plural(results.length, 'Case')}: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped.`);
  if (count('fail') > 0) {
    io.out('Next step: tune the Routing prompts under config/routing-prompts/, run `sharedmem-admin init` to apply them, and run `sharedmem-admin verify` again.');
    return 1;
  }
  io.out('Next step: run `sharedmem-admin export` to build the Kits.');
  return 0;
}

export const summary = 'Send every Case through real routing and compare expected with actual.';
