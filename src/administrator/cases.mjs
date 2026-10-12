// Cases: sentences a person says, with the Spaces each should reach in each Example.
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared/cli.mjs';
import { EXAMPLES, LEADERSHIP, TEAM } from './layout.mjs';
import { CONFIG_DIR } from './content.mjs';

export const DEFAULT_CASES_FILE = path.join(CONFIG_DIR, 'cases.json');
const SPACE_WORDS = ['personal', TEAM, LEADERSHIP];
const ROLES = ['leader', 'developer'];
const EXAMPLE_LABEL = { basic: 'Basic', approval: 'Approval' };

export function validateCases(document) {
  const list = Array.isArray(document) ? document : document?.cases;
  if (!Array.isArray(list) || list.length === 0) return ['The Case file needs a "cases" list with at least one Case.'];
  const problems = [];
  const seen = new Set();
  for (const [index, entry] of list.entries()) {
    const id = entry?.id;
    const label = typeof id === 'string' && id !== '' ? `Case "${id}"` : `Case ${index + 1}`;
    if (typeof id !== 'string' || id === '') problems.push(`${label} has no id.`);
    else {
      if (!/^[A-Za-z0-9-]+$/.test(id)) problems.push(`The id "${id}" may only use letters, digits and hyphens.`);
      if (seen.has(id)) problems.push(`The id "${id}" is used more than once.`);
      seen.add(id);
    }
    if (!ROLES.includes(entry?.role)) problems.push(`${label} needs the role "leader" or "developer".`);
    if (typeof entry?.sentence !== 'string' || entry.sentence.trim() === '') problems.push(`${label} has no sentence.`);
    const missing = EXAMPLES.filter((example) => !Array.isArray(entry?.reaches?.[example]));
    if (missing.length > 0) {
      problems.push(`${label} needs a list of Spaces for each Example (missing: ${missing.join(', ')}).`);
      continue;
    }
    for (const example of EXAMPLES) {
      for (const word of entry.reaches[example]) {
        if (word === 'candidate') {
          if (example !== 'approval') problems.push(`${label} expects a candidate in the ${EXAMPLE_LABEL[example]} Example; candidates exist only in the Approval Example.`);
        } else if (!SPACE_WORDS.includes(word)) {
          problems.push(`${label} names an unknown Space: ${word}. Use personal, ${TEAM} or ${LEADERSHIP}.`);
        }
      }
    }
  }
  return problems;
}

export function loadCases(file) {
  const target = file ? path.resolve(file) : DEFAULT_CASES_FILE;
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new CliError('The Case file does not exist.', { next: 'Check the path given with --cases.' });
    throw error;
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new CliError('The Case file is not valid JSON.', { next: 'Fix the file and run the command again.' });
  }
  const problems = validateCases(document);
  if (problems.length > 0) {
    throw new CliError(`The Case file is not valid:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`, {
      next: 'Fix the Case file and run the command again. Nothing was sent.',
    });
  }
  return Array.isArray(document) ? document : document.cases;
}

// The Spaces a Case should reach in an Example, always including the speaker's own.
export function expectedSpaces(testCase, example) {
  const wanted = new Set(testCase.reaches[example].filter((word) => word !== 'candidate'));
  wanted.add('personal');
  return SPACE_WORDS.filter((word) => wanted.has(word));
}

export const expectsCandidate = (testCase, example) => testCase.reaches[example].includes('candidate');
