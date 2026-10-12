// The person file: everything a Kit knows about its Participant. It sits at the root of
// the Kit and holds the Participant's chain API key, so it is a secret.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CliError } from '../shared/cli.mjs';

export const PERSON_FILE = fileURLToPath(new URL('../../person.json', import.meta.url));

const STRING_FIELDS = ['name', 'agentId', 'serverUrl', 'chainKey'];

export function loadPerson(file = PERSON_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CliError('This Kit has no person file.', { next: 'Ask the Administrator for a new Kit and run the program from it.' });
    }
    throw error;
  }
  let person;
  try {
    person = JSON.parse(text);
  } catch {
    throw new CliError('The person file in this Kit is not valid JSON.', { next: 'Ask the Administrator for a new Kit.' });
  }
  const problems = [];
  for (const field of STRING_FIELDS) if (typeof person?.[field] !== 'string' || person[field] === '') problems.push(field);
  if (!['leader', 'developer'].includes(person?.role)) problems.push('role');
  if (!['basic', 'approval'].includes(person?.example)) problems.push('example');
  if (!Array.isArray(person?.sampleSentences)) problems.push('sampleSentences');
  if (typeof person?.sampleQuestion?.question !== 'string') problems.push('sampleQuestion');
  if (person?.version !== 1 || problems.length > 0) {
    throw new CliError(`The person file in this Kit is incomplete or from another version (${problems.join(', ') || 'version'}).`, {
      next: 'Ask the Administrator for a new Kit.',
    });
  }
  return person;
}
