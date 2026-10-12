// Entry point of the Participant program: connects one person's coding agent to their
// Chain, prints what to try, and stops. It never launches the agent.
import fs from 'node:fs';
import path from 'node:path';
import { CliError, createIo, parseOptions, renderHelp, reportError, UsageError } from '../shared/cli.mjs';
import { askText, confirm, select } from '../shared/prompt.mjs';
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import { printGuidance } from './guidance.mjs';
import { loadPerson } from './person.mjs';

const PROGRAM = 'sharedmem-participant';
const RECIPES = { claude, codex };

const OPTIONS = [
  { name: 'agent', type: 'string', placeholder: 'claude|codex', description: 'Which coding agent to set up. Asked with the arrow keys when omitted at a terminal.' },
  { name: 'dir', type: 'string', placeholder: 'directory', description: 'The project directory to configure. Asked (default: the current one) when omitted at a terminal.' },
  { name: 'yes', short: 'y', type: 'boolean', description: 'Answer yes to every confirmation, including the one about running git init.' },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show this help.' },
];

const HELP = {
  usage: '[options]',
  summary: 'Connects your coding agent (Claude Code or Codex) to your Chain, then prints your sample sentences and question.',
  changes: [
    'Installs the mem9 plugin through the agent\'s own marketplace commands.',
    'Writes the plugin settings for this project: your server address, your key and your Agent ID. Claude Code: .claude/settings.local.json in the project. Codex: a saved profile in your user-level mem9 folder plus .codex/mem9/config.json in the project.',
    'Codex only: runs `git init` in the project if it is not inside a Git repository, and the plugin repairs your user-level Codex hook files.',
    'It never starts your agent. Safe to run again.',
  ],
  options: OPTIONS,
  examples: [
    `${PROGRAM}                                   # choose the agent and directory, then confirm`,
    `${PROGRAM} --agent claude --dir . --yes      # no questions`,
    `${PROGRAM} --agent codex --dir ~/work/api --yes`,
  ],
  next: 'Open a new terminal window, go to the project directory and start your agent.',
};

async function chooseAgent(io, flag) {
  if (flag !== undefined) {
    if (!(flag in RECIPES)) throw new UsageError(`Unknown agent: ${flag}. The agent must be claude or codex.`, { next: 'Run again with --agent claude or --agent codex.' });
    return flag;
  }
  return select(io, 'Which coding agent do you use?', [
    { value: 'claude', label: claude.label },
    { value: 'codex', label: codex.label },
  ], { flag: '--agent' });
}

async function chooseDirectory(io, flag) {
  let chosen = flag;
  if (chosen === undefined) {
    if (!io.isTTY) throw new CliError('No project directory was given.', { next: 'Pass --dir <directory> to choose without a prompt.' });
    chosen = await askText(io, 'Project directory', process.cwd());
  }
  const dir = path.resolve(chosen);
  let stat = null;
  try {
    stat = fs.statSync(dir);
  } catch {
    // reported below
  }
  if (!stat?.isDirectory()) {
    throw new CliError(`The directory ${dir} does not exist.`, { next: 'Create it or pass an existing directory with --dir.' });
  }
  return dir;
}

export async function main(argv, { stdout, stderr, stdin, env = process.env } = {}) {
  const io = createIo({ stdout, stderr, stdin });
  try {
    const { values } = parseOptions(PROGRAM, OPTIONS, argv);
    if (values.help) {
      io.out(renderHelp(PROGRAM, HELP));
      return 0;
    }
    const person = loadPerson();
    io.redactor.addSecret(person.chainKey);
    io.redactor.addAddress(person.serverUrl);
    if (person.serverUrl.startsWith('http:')) {
      io.warnOnce('plain-http', 'The server address uses plain HTTP, so traffic is not encrypted. Use fictional data only.');
    }
    const agent = await chooseAgent(io, values.agent);
    const dir = await chooseDirectory(io, values.dir);
    const recipe = RECIPES[agent];

    recipe.preflight({ env, dir });
    const { lines, context } = await recipe.plan({ person, dir, env });
    io.out(`Plan for ${person.name} with ${recipe.label} in ${dir}:`);
    for (const line of lines) io.out(`  - ${line}`);
    if (!(await confirm(io, 'Go ahead?', { yes: values.yes }))) {
      io.out('Cancelled. Nothing was changed.');
      return 1;
    }
    const result = await recipe.configure({ io, env, person, dir, context });
    const { command, notes } = recipe.nextSteps({ dir, result });
    printGuidance(io, { person, agentLabel: recipe.label, dir, command, notes });
    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
