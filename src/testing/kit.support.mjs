// A Kit for Participant tests: the Participant program and the code it needs, plus a
// person file, in a folder of its own, so a test runs the program the way a
// Participant does and a file missing from a Kit fails the test.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness.support.mjs';

export function defaultPerson(h, overrides = {}) {
  return {
    version: 1,
    name: 'ana',
    role: 'developer',
    agentId: 'ana',
    serverUrl: h.fake.url,
    chainKey: 'chain_0123456789abcdef0123456789abcdef01234567',
    example: 'basic',
    sampleSentences: [
      'We always run database migrations before deploying the API.',
      'I prefer a dark theme in my editor and keep the font size at 14.',
    ],
    sampleQuestion: {
      question: 'What is our rule for merging pull requests?',
      shouldFind: 'The Team Shared Seed: the default branch is main and every pull request needs one approving review.',
    },
    ...overrides,
  };
}

export function createKit(h, personOverrides = {}, folder = 'kit') {
  const dir = path.join(h.root, folder);
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'bin', 'sharedmem-participant'), path.join(dir, 'bin', 'sharedmem-participant'));
  fs.cpSync(path.join(REPO_ROOT, 'src', 'participant'), path.join(dir, 'src', 'participant'), {
    recursive: true,
    filter: (source) => !source.endsWith('.test.mjs'),
  });
  fs.cpSync(path.join(REPO_ROOT, 'src', 'shared'), path.join(dir, 'src', 'shared'), { recursive: true });
  const person = defaultPerson(h, personOverrides);
  fs.writeFileSync(path.join(dir, 'person.json'), `${JSON.stringify(person, null, 2)}\n`, { mode: 0o600 });
  return { dir, person };
}
