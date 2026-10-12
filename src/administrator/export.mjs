// export: builds one Kit per Participant and a report without secrets. A Kit is a
// folder holding the Participant program, the code it imports, the person file and a
// README, and nothing else. Everything is rebuilt from scratch on every run.
import fs from 'node:fs';
import path from 'node:path';
import { CliError, parseOptions, renderHelp } from '../shared/cli.mjs';
import { ensureDir, writeFileAtomic, writeJsonOwnerOnly } from '../shared/fsx.mjs';
import { loadCases } from './cases.mjs';
import { loadSeeds, readJsonConfig } from './content.mjs';
import { COMMON_OPTIONS, REPO_ROOT, openContext } from './context.mjs';
import { assignSamples } from './samples.mjs';

const OPTIONS = [...COMMON_OPTIONS];

const HELP = {
  usage: '[options]',
  summary: 'Builds one Kit per Participant, plus a report of who gets which Kit.',
  changes: [
    'On the server: nothing. This command only reads the local state.',
    'Locally: removes out/kits/ and out/report.md, then writes out/kits/<name>/ for every Participant and out/report.md. Everything is rebuilt from scratch; other files in out/ stay.',
    'A Kit holds the Participant program, the code it needs, a person file (owner-only) with that person\'s name, role, server address, chain API key, Agent ID, Sample sentences, Sample question and the active Example, and a README. It never holds tests, administrator code or another person\'s key.',
    'A Kit is a secret: it holds a chain API key. The report holds no secret.',
  ],
  options: OPTIONS,
  examples: [
    'sharedmem-admin export    # rebuild all Kits and the report',
  ],
  next: 'Send each person only their own Kit folder (for example as a zip) and ask them to open README.md in it.',
};

const LAUNCHER = 'bin/sharedmem-participant';
const ENTRY = 'src/participant/main.mjs';
const ALLOWED = [/^src\/participant\/[a-z-]+\.mjs$/, /^src\/shared\/[a-z-]+\.mjs$/];
const ROLE_LABEL = { leader: 'Leader', developer: 'Developer' };
const EXAMPLE_LABEL = { basic: 'Basic', approval: 'Approval' };

const IMPORT_PATTERN = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

// The files the Participant program needs: its entry and everything it imports,
// found by reading the imports, so a new import is shipped without touching a list.
function programFiles() {
  const files = new Set();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop();
    if (files.has(file)) continue;
    if (!ALLOWED.some((pattern) => pattern.test(file)) || file.includes('.test.') || file.includes('.support.')) {
      throw new CliError(`The Participant program imports ${file}, which must not be shipped in a Kit.`, {
        next: 'Participant code may import only other Participant files and shared files (never tests or administrator code).',
      });
    }
    files.add(file);
    const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] ?? match[2])));
    }
  }
  return [LAUNCHER, ...[...files].sort()];
}

function copyProgram(kitDir, files) {
  for (const file of files) {
    const source = path.join(REPO_ROOT, file);
    const target = path.join(kitDir, file);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
    fs.chmodSync(target, fs.statSync(source).mode & 0o111 ? 0o755 : 0o644);
  }
}

function readGuide() {
  const file = path.join(REPO_ROOT, 'docs', 'participant-guide.md');
  try {
    return fs.readFileSync(file);
  } catch {
    throw new CliError('The Participant guide docs/participant-guide.md cannot be read.', { next: 'Restore the file from the repository.' });
  }
}

function reportText({ state, kits, exportedAt }) {
  const lines = [
    '# Kit report',
    '',
    `- Active Example: ${EXAMPLE_LABEL[state.example]}`,
    `- Exported: ${exportedAt}`,
    `- Kits: ${kits.length}`,
    '',
    '| Participant | Role | Agent ID | Kit folder | Handed out |',
    '| --- | --- | --- | --- | --- |',
    ...kits.map((kit) => `| ${kit.name} | ${ROLE_LABEL[kit.role]} | ${kit.name} | ${kit.folder} | [ ] |`),
    '',
    'Each Kit holds one person\'s chain API key, so it is a secret. Hand it only to that person.',
    'The Example named inside a Kit is a label for the guidance. After switching Examples with `init`, run `export` again to refresh it; the keys do not change.',
    '',
  ];
  return lines.join('\n');
}

export async function run(argv, { io, env, program }) {
  const { values } = parseOptions(program, OPTIONS, argv);
  if (values.help) {
    io.out(renderHelp(program, HELP));
    return 0;
  }
  const { store, workdir } = openContext({ io, env, workdirFlag: values.workdir });
  const state = store.state;
  const participants = (state?.participants ?? []).filter((person) => state.chains[person.name]);
  if (participants.length === 0) {
    throw new CliError('There is nothing to export: the state records no Chains.', { next: 'Run `sharedmem-admin init` first.' });
  }

  const samples = assignSamples(participants, {
    cases: loadCases(),
    questions: readJsonConfig('sample-questions.json'),
    seeds: loadSeeds(),
  });
  const guide = readGuide();
  const files = programFiles();

  const out = path.join(workdir, 'out');
  const kitsDir = path.join(out, 'kits');
  const reportFile = path.join(out, 'report.md');
  fs.rmSync(kitsDir, { recursive: true, force: true });
  fs.rmSync(reportFile, { force: true });

  const kits = [];
  for (const person of participants) {
    const kitDir = path.join(kitsDir, person.name);
    copyProgram(kitDir, files);
    writeFileAtomic(path.join(kitDir, 'README.md'), guide, 0o644);
    writeJsonOwnerOnly(path.join(kitDir, 'person.json'), {
      version: 1,
      name: person.name,
      role: person.role,
      agentId: person.name,
      serverUrl: state.serverUrl,
      chainKey: state.chains[person.name].key,
      example: state.example,
      ...samples.get(person.name),
    });
    kits.push({ name: person.name, role: person.role, folder: `kits/${person.name}` });
  }
  writeFileAtomic(reportFile, reportText({ state, kits, exportedAt: new Date().toISOString() }), 0o600);

  io.out(`Exported ${kits.length} ${kits.length === 1 ? 'Kit' : 'Kits'} for the ${EXAMPLE_LABEL[state.example]} Example:`);
  for (const kit of kits) io.out(`  - ${kit.name} (${ROLE_LABEL[kit.role]})  out/${kit.folder}`);
  io.out('Report: out/report.md');
  io.out('');
  io.out('Each Kit holds one person\'s chain API key, so a Kit is a secret: hand it only to that person.');
  io.out(`Next step: ${HELP.next.replace(/^Send/, 'send')}`);
  return 0;
}

export const summary = 'Build one Kit per Participant and a report without secrets.';
