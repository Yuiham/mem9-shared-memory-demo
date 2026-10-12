// Entry point of the Administrator program: picks the command and reports errors.
import { createIo, reportError, UsageError } from '../shared/cli.mjs';
import { ApiError, toCliError } from '../shared/http.mjs';
import { COMMANDS } from './commands.mjs';

const PROGRAM = 'sharedmem-admin';

export function overview() {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length), 0);
  const lines = [
    `Usage: ${PROGRAM} <command> [options]`,
    '',
    'Sets up, checks and tears down the shared-memory demo for a team on a mem9 server.',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
    '',
    `Run \`${PROGRAM} <command> --help\` to see what a command changes, its options and examples.`,
  ];
  return lines.join('\n');
}

export async function main(argv, { stdout, stderr, stdin, env = process.env } = {}) {
  const io = createIo({ stdout, stderr, stdin });
  try {
    const [name, ...rest] = argv;
    if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
      io.out(overview());
      return 0;
    }
    const command = COMMANDS[name];
    if (!command) {
      throw new UsageError(`Unknown command: ${name}.`, { next: `Run \`${PROGRAM}\` without arguments to see the commands.` });
    }
    return await command.run(rest, { io, env, program: `${PROGRAM} ${name}` });
  } catch (error) {
    return reportError(io, error instanceof ApiError ? toCliError(error) : error);
  }
}
