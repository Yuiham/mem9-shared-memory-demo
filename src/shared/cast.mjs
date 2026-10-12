// The cast: who takes part and in which role.
import fs from 'node:fs';
import { CliError } from './cli.mjs';

export const RESERVED_NAMES = ['seed', 'team-shared', 'leadership-shared'];
export const ROLES = ['leader', 'developer'];
export const NAME_LIMIT = 100;

export function validateCast(cast) {
  const problems = [];
  const participants = cast?.participants;
  if (!Array.isArray(participants) || participants.length === 0) {
    return ['The cast needs a "participants" list with at least one Leader and one Developer.'];
  }
  const seen = new Set();
  for (const [index, participant] of participants.entries()) {
    const label = `Participant ${index + 1}`;
    const name = participant?.name;
    if (typeof name !== 'string' || name === '') {
      problems.push(`${label} has no name.`);
      continue;
    }
    if (!/^[a-z0-9-]+$/.test(name)) problems.push(`Name "${name}" may only use lowercase letters, digits and hyphens.`);
    if (name.length > NAME_LIMIT) problems.push(`Name "${name.slice(0, 20)}..." is longer than ${NAME_LIMIT} characters.`);
    if (RESERVED_NAMES.includes(name) || name.startsWith('verify-')) {
      problems.push(`Name "${name}" is reserved for the demo's own identifiers.`);
    }
    if (seen.has(name)) problems.push(`Name "${name}" appears more than once.`);
    seen.add(name);
    if (!ROLES.includes(participant.role)) problems.push(`Participant "${name}" needs the role "leader" or "developer".`);
  }
  const roles = participants.map((participant) => participant?.role);
  if (!roles.includes('leader')) problems.push('The cast needs at least one Leader.');
  if (!roles.includes('developer')) problems.push('The cast needs at least one Developer.');
  return problems;
}

export function loadCast(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CliError('The cast file does not exist.', { next: 'Check the path given with --cast.' });
    }
    throw error;
  }
  let cast;
  try {
    cast = JSON.parse(text);
  } catch {
    throw new CliError('The cast file is not valid JSON.', { next: 'Fix the file and run the command again.' });
  }
  const problems = validateCast(cast);
  if (problems.length > 0) {
    throw new CliError(`The cast is not valid:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`, {
      next: 'Edit the cast file and run the command again.',
    });
  }
  return cast;
}

// Position of each participant within their role, counting from zero in cast order.
export function withPositions(cast) {
  const counters = { leader: 0, developer: 0 };
  return cast.participants.map((participant) => ({ ...participant, position: counters[participant.role]++ }));
}
