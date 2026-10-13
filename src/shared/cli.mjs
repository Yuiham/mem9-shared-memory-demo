// Command-line plumbing shared by both programs: errors with a next step, output with
// masking, strict option parsing and help rendering.
import { parseArgs } from 'node:util';
import { Redactor } from './redact.mjs';

export class CliError extends Error {
  constructor(message, { next = '', code = 1 } = {}) {
    super(message);
    this.name = 'CliError';
    this.next = next;
    this.code = code;
  }
}

export class UsageError extends CliError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 2 });
    this.name = 'UsageError';
  }
}

export function createIo({
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = process.stdin,
  redactor = new Redactor(),
} = {}) {
  const warned = new Set();
  const write = (stream, text) => {
    stream.write(`${redactor.apply(text)}\n`);
  };
  return {
    redactor,
    stdin,
    stdout,
    isTTY: Boolean(stdin.isTTY && stdout.isTTY),
    out: (text = '') => write(stdout, text),
    err: (text = '') => write(stderr, text),
    warnOnce(key, text) {
      if (warned.has(key)) return;
      warned.add(key);
      write(stderr, `warning: ${text}`);
    },
  };
}

// Prints an error with its next step and returns the exit code to use.
export function reportError(io, error) {
  if (error instanceof CliError) {
    io.err(`error: ${error.message}`);
    if (error.next) io.err(`next: ${error.next}`);
    return error.code;
  }
  io.err(`error: unexpected failure: ${error?.message ?? error}`);
  io.err('next: Run the command again. If it keeps failing, see docs/troubleshooting.md.');
  return 1;
}

// option: { name, type: 'boolean' | 'string', short?, description, placeholder? }
export function parseOptions(program, optionList, argv, { positionals = { min: 0, max: 0, label: '' } } = {}) {
  const options = {};
  for (const option of optionList) {
    options[option.name] = { type: option.type, ...(option.short ? { short: option.short } : {}) };
  }
  const hint = `Run \`${program} --help\` to see the available options.`;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    const quoted = /'([^']+)'/.exec(error.message);
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      throw new UsageError(`Unknown option: ${quoted ? quoted[1] : 'unrecognized'}.`, { next: hint });
    }
    if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new UsageError(error.message.split('.')[0] + '.', { next: hint });
    }
    throw new UsageError(error.message.split('\n')[0], { next: hint });
  }
  const count = parsed.positionals.length;
  if (count < positionals.min || count > positionals.max) {
    const expected = positionals.max === 0 ? 'takes no arguments' : `expects ${positionals.label || 'different arguments'}`;
    throw new UsageError(`${program} ${expected}.`, { next: hint });
  }
  return { values: parsed.values, positionals: parsed.positionals };
}

function formatOptions(optionList) {
  const rows = optionList.map((option) => {
    const flag = `${option.short ? `-${option.short}, ` : ''}--${option.name}${option.type === 'string' ? ` <${option.placeholder ?? 'value'}>` : ''}`;
    return [flag, option.description];
  });
  const width = Math.max(0, ...rows.map(([flag]) => flag.length));
  return rows.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`);
}

// spec: { usage, summary, changes: [text], options: [option], examples: [text], next }
export function renderHelp(program, spec) {
  const lines = [`Usage: ${program} ${spec.usage}`, '', spec.summary, '', 'What it changes:'];
  for (const item of spec.changes) lines.push(`  - ${item}`);
  lines.push('', 'Options:', ...formatOptions(spec.options));
  lines.push('', 'Examples:');
  for (const example of spec.examples) lines.push(`  ${example}`);
  lines.push('', `Next step: ${spec.next}`);
  return lines.join('\n');
}
