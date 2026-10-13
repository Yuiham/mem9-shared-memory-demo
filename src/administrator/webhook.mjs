// webhook: registers the webhook endpoint of each Leader Chain, so that announcements
// the Approval Example holds back reach the local receiver.
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { ApiError } from '../shared/http.mjs';
import { isPlaceholderUrl, PLACEHOLDER_URL, ROUTED_EVENT } from '../shared/names.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';

const EVENTS = [ROUTED_EVENT];
const PLACEHOLDER_EXAMPLE = PLACEHOLDER_URL;

const OPTIONS = [
  { name: 'url', type: 'string', placeholder: 'public URL', description: 'The public HTTPS address the server should deliver to (set).' },
  { name: 'test', type: 'boolean', description: 'Also ask the server to send a test event to each endpoint (set).' },
  { name: 'leader', type: 'string', placeholder: 'name', description: 'Only this Leader\'s Chain (deliveries; default: every Leader).' },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: '<set --url <public URL> [--test] | deliveries [--leader <name>]> [options]',
  summary: 'Registers one webhook endpoint per Leader Chain, so the Approval Example\'s announcements reach your receiver.',
  changes: [
    'On the server: creates one endpoint on each Leader Chain, subscribed only to routed-fact events, or updates the endpoint it already created (its signing secret stays). With --test it also asks the server to send a test event to each endpoint.',
    'Locally: records each endpoint and its signing secret in state/state.json. The secret is never printed.',
    'The server requires an HTTPS address without credentials and refuses a literal private IP address such as 127.0.0.1, so a receiver on this computer needs a tunnel that gives it a public HTTPS address. The server resolves a host name only when it delivers.',
    'deliveries: lists the server\'s delivery records for each Leader Chain (or one with --leader), newest first, with status, attempts and the last error. Records carry no event content and do not say which node a delivery was for. Nothing changes.',
    `With no public address yet, register a placeholder such as ${PLACEHOLDER_EXAMPLE}: it is accepted and can never deliver, which is enough for \`verify\` and \`simulate\`. Do not combine it with --test.`,
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin webhook set --url https://abc123.tunnel.example.com/    # a real tunnel',
    `sharedmem-admin webhook set --url ${PLACEHOLDER_EXAMPLE}                   # placeholder, no delivery`,
    'sharedmem-admin webhook set --url https://abc123.tunnel.example.com/ --test',
    'sharedmem-admin webhook deliveries --leader lucia    # did the server try, and what failed?',
  ],
  next: 'Start the receiver with `sharedmem-admin receiver serve`, then check the Approval Cases with `sharedmem-admin verify`.',
};

function parseTarget(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError('--url is not a valid address.', { next: `Pass a full address such as https://abc123.tunnel.example.com/, or the placeholder ${PLACEHOLDER_EXAMPLE}.` });
  }
  return parsed;
}

// The server decides whether an address is acceptable; this only explains its answer.
function explainRejection(error) {
  return new CliError(`The server rejected the webhook address (${error.message}).`, {
    next: 'The server requires an HTTPS address without credentials and refuses private IP addresses such as 127.0.0.1, so a receiver on this computer needs a tunnel that gives it a public HTTPS address. Start a tunnel to the receiver\'s port, then run this command again with its address. Until then, use the placeholder address ' + PLACEHOLDER_EXAMPLE + '.',
  });
}

async function register({ ctx, name, url }) {
  const { store, mem9 } = ctx;
  const chain = store.state.chains[name];
  const known = store.state.webhooks[name];
  if (known) {
    try {
      await mem9.updateWebhook(chain, known.id, { url, events: EVENTS, enabled: true });
      known.url = url;
      store.save();
      return 'updated (the signing secret is kept)';
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  const created = await mem9.createWebhook(chain, { name: chain.name, url, events: EVENTS });
  // The secret is shown once, so it is saved before anything else happens.
  store.state.webhooks[name] = { id: created.id, url, secret: created.signing_secret };
  store.save();
  return known ? 'created again (the server no longer had it)' : 'created';
}

async function set(values, { io, env, program }) {
  if (!values.url) {
    throw new UsageError('--url is required.', { next: `Pass the public address of your receiver, or the placeholder ${PLACEHOLDER_EXAMPLE}.` });
  }
  const parsed = parseTarget(values.url);
  const placeholder = isPlaceholderUrl(parsed.href);
  if (placeholder && values.test) {
    throw new UsageError('A placeholder address can never deliver, so --test would only fail.', { next: 'Run again without --test, or give the address of a tunnel.' });
  }
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const { state } = ctx.store;
  const leaders = (state?.participants ?? []).filter((person) => person.role === 'leader' && state.chains[person.name]);
  if (leaders.length === 0) {
    throw new CliError('There is no Leader Chain in the state.', { next: 'Run `sharedmem-admin init` first.' });
  }
  state.webhooks ??= {};
  for (const leader of leaders) {
    try {
      const note = await register({ ctx, name: leader.name, url: values.url });
      io.out(`  ${leader.name}: webhook ${note}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && /^url:/.test(error.message)) throw explainRejection(error);
      throw error;
    }
  }
  if (values.test) {
    for (const leader of leaders) {
      const delivery = await ctx.mem9.testWebhook(state.chains[leader.name], state.webhooks[leader.name].id);
      io.out(`  ${leader.name}: test event queued (delivery ${delivery?.id ?? 'unknown'})`);
    }
  }
  io.out('');
  if (placeholder) {
    io.out('The address is a placeholder: the server accepts it but can never deliver to it. That is enough for `verify` and `simulate`; run this command again with a tunnel address to receive real deliveries.');
  } else {
    io.out(`Deliveries go to ${values.url}. Forward that address to the receiver's port (\`sharedmem-admin receiver serve\`).`);
  }
  if (values.test) io.out('Watch the receiver\'s terminal for the test events. The server sends them in the background.');
  io.out(`Next step: ${HELP.next.replace(/^Start/, 'start')}`);
  return 0;
}

const DELIVERY_LIMIT = 20;

async function deliveries(values, { io, env }) {
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const { state } = ctx.store;
  const leaders = (state?.participants ?? []).filter((person) => person.role === 'leader' && state.chains[person.name]);
  if (leaders.length === 0) throw new CliError('There is no Leader Chain in the state.', { next: 'Run `sharedmem-admin init` first.' });
  let chosen = leaders;
  if (values.leader) {
    chosen = leaders.filter((leader) => leader.name === values.leader);
    if (chosen.length === 0) {
      throw new CliError(`"${values.leader}" is not a Leader with a Chain.`, { next: `Use one of: ${leaders.map((leader) => leader.name).join(', ')}.` });
    }
  }
  for (const leader of chosen) {
    const records = await ctx.mem9.webhookDeliveries(state.chains[leader.name], DELIVERY_LIMIT);
    io.out(`${leader.name}: ${records.length === 0 ? 'no delivery records' : `${records.length} delivery ${records.length === 1 ? 'record' : 'records'}, newest first`}`);
    for (const record of records) {
      const http = record.last_http_status ?? '-';
      io.out(`  ${String(record.created_at ?? '').slice(0, 19).replace('T', ' ')}  ${record.event_type}  ${record.status}  attempts=${record.attempt_count}  http=${http}${record.last_error ? `  ${record.last_error}` : ''}`);
    }
  }
  io.out('');
  io.out('Records say nothing about the event content or which node a delivery was for; only the receiver sees the content.');
  io.out('Next step: if deliveries fail, check the registered address with `sharedmem-admin webhook set --url <address> --test` and watch the receiver\'s terminal.');
  return 0;
}

const SUBCOMMANDS = { set, deliveries };

export async function run(argv, context) {
  const { program } = context;
  const { values, positionals } = parseOptions(program, OPTIONS, argv, { positionals: { min: 0, max: 1, label: 'a subcommand' } });
  if (values.help) {
    context.io.out(renderHelp(program, HELP));
    return 0;
  }
  const [name] = positionals;
  if (!SUBCOMMANDS[name]) {
    throw new UsageError(name ? `Unknown ${program} subcommand: ${name}.` : `${program} needs a subcommand.`, {
      next: `Use one of: ${Object.keys(SUBCOMMANDS).join(', ')}. Run \`${program} --help\` for details.`,
    });
  }
  return SUBCOMMANDS[name](values, context);
}

export const summary = 'Register the webhook endpoint of each Leader Chain (Approval Example).';
