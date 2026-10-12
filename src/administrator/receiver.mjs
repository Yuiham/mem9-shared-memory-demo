// receiver: a small local HTTP server for the server's webhook deliveries. It checks each
// delivery's signature and timestamp, ignores duplicates, and turns every announcement
// the Approval Example held back into a Candidate. It listens on the loopback interface
// only; a tunnel provides the public address.
import http from 'node:http';
import { CliError, parseOptions, renderHelp, UsageError } from '../shared/cli.mjs';
import { CandidateStore } from './candidate-store.mjs';
import { COMMON_OPTIONS, openContext } from './context.mjs';
import { processIsAlive, readRuntime, removeRuntime, writeRuntime } from './receiver-runtime.mjs';
import { SIMULATED_HEADER, signatureMatches, timestampIsFresh } from './signing.mjs';

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024;

const OPTIONS = [
  { name: 'port', type: 'string', placeholder: 'number', description: `The port to listen on (default ${DEFAULT_PORT}; 0 picks any free port).` },
  ...COMMON_OPTIONS,
];

const HELP = {
  usage: 'serve [--port <number>] [options]',
  summary: 'Runs the local receiver for the server\'s webhook deliveries until you stop it with Ctrl+C.',
  changes: [
    'On the server: nothing.',
    'Locally: listens on 127.0.0.1 only, accepts deliveries on any path, and adds a Candidate to state/candidates.json for every announcement the Approval Example held back. While it runs, state/receiver.json says where it listens; the file is removed when it stops.',
    'It checks the signature with the signing secret recorded for the delivery\'s Chain, refuses timestamps more than five minutes from this computer\'s clock, ignores duplicates, and ignores deliveries that are not held-back announcements. It always answers quickly with a 2xx status when it accepts or ignores a delivery.',
    'A tunnel that forwards a public HTTPS address to this port is yours to provide; `sharedmem-admin simulate` covers the demonstration when there is none.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin receiver serve               # port 8787',
    'sharedmem-admin receiver serve --port 0      # any free port; the address is printed',
  ],
  next: 'In another terminal, run `sharedmem-admin simulate --leader <name> --text "..."`, or point a tunnel at the port and run `sharedmem-admin webhook set --url <tunnel address>`.',
};

// Control characters and over-long values from the network never reach the terminal.
const printable = (value) => String(value ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 80);

function leaderForChain(state, chainId) {
  if (!state || typeof chainId !== 'string') return null;
  const entry = (state.participants ?? []).find((person) => person.role === 'leader' && state.chains[person.name]?.id === chainId && state.webhooks?.[person.name]);
  return entry ? entry.name : null;
}

// Decides what to do with one delivery. Returns { status, outcome, message, created }.
function judge({ headers, raw, store, candidates }) {
  const eventId = headers['x-mem9-event-id'];
  const timestamp = headers['x-mem9-timestamp'];
  const signature = headers['x-mem9-signature'];
  if (!eventId || !timestamp || !signature) return { status: 400, message: 'the signature headers are missing' };
  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    return { status: 400, message: 'the body is not JSON' };
  }
  const state = store.load();
  const leader = leaderForChain(state, envelope?.scope?.chain_id ?? envelope?.data?.chain_id);
  if (!leader) return { status: 401, message: 'the delivery is not for a Chain with a registered webhook' };
  if (!signatureMatches({ secret: state.webhooks[leader].secret, timestamp, eventId, rawBody: raw, signature })) {
    return { status: 401, message: 'the signature does not match' };
  }
  if (!timestampIsFresh(timestamp)) return { status: 401, message: 'the timestamp is more than five minutes away from this computer\'s clock' };
  if (envelope.id !== eventId) return { status: 400, message: 'the event id in the body does not match the header' };
  if (candidates.hasHandled(eventId)) return { status: 200, outcome: 'duplicate' };

  const data = envelope.data ?? {};
  const heldBack = envelope.type === 'space_chain.fact_routed' && data.webhook_only === true;
  if (!heldBack) {
    candidates.recordDelivery({ eventId, candidates: [] });
    return { status: 200, outcome: envelope.type === 'webhook.test' ? 'test event' : 'ignored' };
  }
  const agentId = typeof data.agent_id === 'string' ? data.agent_id : '';
  const facts = (Array.isArray(data.source_facts) ? data.source_facts : []).map((fact) => fact?.text).filter((text) => typeof text === 'string' && text.trim() !== '');
  const created = candidates.recordDelivery({
    eventId,
    candidates: facts.map((text) => ({
      text,
      leader,
      agentId,
      sessionId: typeof data.session_id === 'string' ? data.session_id : '',
      eventId,
      routeId: typeof data.route_id === 'string' ? data.route_id : '',
      test: agentId.startsWith('verify-'),
      simulated: headers[SIMULATED_HEADER] === '1',
      receivedAt: new Date().toISOString(),
    })),
  });
  return { status: 200, outcome: 'accepted', created, leader };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parsePort(raw) {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port > 65535) {
    throw new UsageError(`--port must be a number from 0 to 65535 (got "${printable(raw)}").`, { next: 'Use 0 for any free port.' });
  }
  return port;
}

async function serve(values, { io, env }) {
  const port = parsePort(values.port);
  const ctx = openContext({ io, env, workdirFlag: values.workdir });
  const { store, workdir } = ctx;
  const candidates = new CandidateStore({ workdir });
  const running = readRuntime(workdir);
  if (running && running.pid !== process.pid && processIsAlive(running.pid)) {
    throw new CliError(`A receiver is already running for this working directory (process ${running.pid}).`, { next: 'Stop it with Ctrl+C in its terminal, or use a different --workdir.' });
  }
  if (Object.keys(store.state?.webhooks ?? {}).length === 0) {
    io.warnOnce('no-webhook', 'No webhook is registered yet, so every delivery is refused until you run `sharedmem-admin webhook set --url <address>`.');
  }

  const server = http.createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method !== 'POST') return reply(405, { error: 'only POST deliveries are accepted' });
      const raw = await readBody(request);
      const result = judge({ headers: request.headers, raw, store, candidates });
      const label = printable(request.headers['x-mem9-event-id']);
      if (result.status >= 400) {
        io.out(`  ${label}: refused (${result.status}): ${result.message}`);
        return reply(result.status, { error: result.message });
      }
      if (result.outcome === 'accepted') {
        const ids = result.created.map((candidate) => candidate.id);
        io.out(`  ${label}: ${ids.length === 0 ? 'held-back announcement without text, nothing to approve' : `Candidate ${ids.join(', ')} from ${result.leader} is pending`}`);
        return reply(200, { outcome: result.outcome, candidates: ids });
      }
      io.out(`  ${label}: ${result.outcome}`);
      return reply(200, { outcome: result.outcome, candidates: [] });
    } catch (error) {
      if (error.tooLarge) return reply(413, { error: 'the body is too large' });
      io.out(`  delivery failed inside the receiver: ${printable(error.message)}`);
      return reply(500, { error: 'the receiver could not handle the delivery' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(error.code === 'EADDRINUSE'
        ? new CliError(`Port ${port} is already in use.`, { next: 'Pass another number with --port, or --port 0 for any free port.' })
        : error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = `http://127.0.0.1:${server.address().port}`;
  writeRuntime(workdir, { url: address, pid: process.pid, startedAt: new Date().toISOString() });
  io.out(`Receiver listening on ${address} (this computer only).`);
  io.out('Forward your tunnel\'s public HTTPS address to this port; deliveries are accepted on any path. Press Ctrl+C to stop.');

  return new Promise((resolve) => {
    const stop = () => {
      removeRuntime(workdir);
      server.closeAllConnections?.();
      server.close(() => {
        io.out('Receiver stopped.');
        resolve(0);
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

const SUBCOMMANDS = { serve };

export async function run(argv, context) {
  const { program, io } = context;
  const { values, positionals } = parseOptions(program, OPTIONS, argv, { positionals: { min: 0, max: 1, label: 'a subcommand' } });
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  const [name] = positionals;
  if (!SUBCOMMANDS[name]) {
    throw new UsageError(name ? `Unknown ${program} subcommand: ${name}.` : `${program} needs a subcommand.`, {
      next: `Use: ${Object.keys(SUBCOMMANDS).join(', ')}. Run \`${program} --help\` for details.`,
    });
  }
  return SUBCOMMANDS[name](values, context);
}

export const summary = 'Run the local receiver for webhook deliveries (Approval Example).';
