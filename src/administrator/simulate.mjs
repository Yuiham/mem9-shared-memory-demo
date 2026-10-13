// simulate: posts a correctly signed routed-fact delivery to the local receiver, so the
// Approval Example can be shown without a public address. The receiver checks it
// exactly as it checks a real delivery.
import crypto from 'node:crypto';
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { PLACEHOLDER_URL, ROUTED_EVENT } from '../shared/names.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { TEAM } from './layout.mjs';
import { processIsAlive, readRuntime } from './receiver-runtime.mjs';
import { SIMULATED_HEADER, sign } from './signing.mjs';

const OPTIONS = [
  { name: 'leader', type: 'string', placeholder: 'name', description: 'The Leader whose Chain produces the delivery.' },
  { name: 'text', type: 'string', placeholder: 'announcement', description: 'The announcement to propose for Team Shared.' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '--leader <name> --text <announcement> [options]',
  summary: 'Sends the local receiver a signed delivery as if the server had held back an announcement, so you can demonstrate approval without a public address.',
  changes: [
    'On the server: nothing.',
    'Locally: posts a delivery to the running receiver (state/receiver.json says where). The receiver turns it into a Candidate marked "simulated", exactly as it would a real one.',
    'It signs with the Leader\'s webhook signing secret, so the Leader needs a registered endpoint (the placeholder address from `webhook set` is enough), and the receiver must run in the same working directory.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin simulate --leader lucia --text "Starting Monday, all production deploys require two reviewers."',
  ],
  next: 'Run `sharedmem-admin candidates` to see the Candidate, then approve or reject it.',
};

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  for (const [flag, what] of [['leader', 'the name of a Leader'], ['text', 'the announcement']]) {
    if (!values[flag]?.trim()) throw new UsageError(`--${flag} is required.`, { next: `Pass ${what} with --${flag}.` });
  }
  const { store, workdir } = openContext({ io, env, workdirFlag: values.workdir });
  const { state } = store;
  const leader = (state?.participants ?? []).find((person) => person.name === values.leader);
  if (!leader || leader.role !== 'leader' || !state.chains[leader.name]) {
    const names = (state?.participants ?? []).filter((person) => person.role === 'leader').map((person) => person.name);
    throw new CliError(`"${values.leader}" is not a Leader with a Chain.`, { next: names.length > 0 ? `Use one of: ${names.join(', ')}.` : 'Run `sharedmem-admin init` first.' });
  }
  const webhook = state.webhooks?.[leader.name];
  if (!webhook) {
    throw new CliError(`${leader.name} has no registered webhook endpoint, so there is no signing secret to sign with.`, {
      next: `Run \`sharedmem-admin webhook set --url ${PLACEHOLDER_URL}\` (a placeholder is enough), then try again.`,
    });
  }
  const runtime = readRuntime(workdir);
  if (!runtime || !processIsAlive(runtime.pid)) {
    throw new CliError('The receiver is not running.', { next: 'Start it in another terminal with `sharedmem-admin receiver serve`, then try again.' });
  }

  const chain = state.chains[leader.name];
  const eventId = `evt_${crypto.randomBytes(10).toString('hex')}`;
  const envelope = {
    id: eventId,
    type: ROUTED_EVENT,
    api_version: 'v1',
    created_at: new Date().toISOString(),
    scope: { type: 'chain', chain_id: chain.id },
    data: {
      route_id: `route_${crypto.randomBytes(6).toString('hex')}`,
      chain_id: chain.id,
      target_external_space_id: TEAM,
      routing_policy_node_id: chain.nodes?.find((node) => node.space === TEAM)?.id ?? '',
      webhook_only: true,
      source_facts: [{ text: values.text }],
      target_memory: null,
      agent_id: leader.name,
      appId: '',
      session_id: `simulate-${eventId}`,
    },
  };
  const rawBody = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now() / 1000));
  let response;
  try {
    response = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mem9-Event-Id': eventId,
        'X-Mem9-Event-Type': envelope.type,
        'X-Mem9-Timestamp': timestamp,
        'X-Mem9-Signature': sign({ secret: webhook.secret, timestamp, eventId, rawBody }),
        [SIMULATED_HEADER]: '1',
      },
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new CliError('The receiver did not answer.', { next: 'It may have stopped without cleaning up. Start it again with `sharedmem-admin receiver serve` and try again.' });
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CliError(`The receiver refused the simulated delivery (${response.status}): ${answer.error ?? 'no reason given'}.`, {
      next: 'The receiver checks the signature with the secret in this working directory\'s state. Make sure it runs with the same --workdir and that `webhook set` was run after the last init.',
    });
  }
  const ids = answer.candidates ?? [];
  io.out(`Simulated delivery sent for ${leader.name}: ${ids.length > 0 ? `Candidate ${ids.join(', ')} is pending (marked simulated).` : 'the receiver accepted it but created no Candidate.'}`);
  io.out(`Next step: ${HELP.next.replace(/^Run/, 'run')}`);
  return 0;
}

export const summary = 'Send the local receiver a signed delivery, to demonstrate approval without a public URL.';
