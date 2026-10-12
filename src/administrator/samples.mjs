// What each Participant is asked to say and ask: Sample sentences come from the Cases and
// the Sample question from the shipped question list. Both are picked by the person's
// position within their role (counting from zero, in cast order) and wrap around, so a
// cast of any size gets something.
import { CliError } from '../shared/cli.mjs';
import { displayName } from './layout.mjs';

// The Cases of one group, such as T1..T4, in number order.
function group(cases, prefix) {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  return cases
    .map((entry) => ({ entry, number: Number(pattern.exec(entry.id)?.[1]) }))
    .filter(({ number }) => Number.isInteger(number))
    .sort((a, b) => a.number - b.number)
    .map(({ entry }) => entry);
}

const pick = (list, index) => (list.length === 0 ? [] : [list[index % list.length].sentence]);

// A Developer at position i says T number (i mod 4) + 1 and N number (i mod 2) + 1; a
// Leader at position j says the two L Cases starting at number (2j mod 4) + 1 and W
// number (j mod 2) + 1. The group sizes come from the Cases, so these are the formulas
// for the shipped four T, two N, four L and two W Cases.
function sentencesFor(role, position, cases) {
  if (role === 'developer') return [...pick(group(cases, 'T'), position), ...pick(group(cases, 'N'), position)];
  const leaderCases = group(cases, 'L');
  return [...pick(leaderCases, position * 2), ...pick(leaderCases, position * 2 + 1), ...pick(group(cases, 'W'), position)]
    .filter((sentence, index, all) => all.indexOf(sentence) === index);
}

function questionFor(role, position, { questions, seeds }) {
  const list = questions[role];
  if (!Array.isArray(list) || list.length === 0) {
    throw new CliError(`config/sample-questions.json has no questions for the role "${role}".`, { next: 'Restore the file from the repository.' });
  }
  const entry = list[position % list.length];
  if (entry.finds?.seed) {
    const seed = seeds.find((candidate) => candidate.id === entry.finds.seed);
    if (!seed) {
      throw new CliError(`config/sample-questions.json names the Seed memory "${entry.finds.seed}", which config/seed-memories.json does not have.`, {
        next: 'Fix one of the two files and run the command again.',
      });
    }
    return { question: entry.question, shouldFind: `"${seed.text}" (a Seed memory in ${displayName(seed.space)})` };
  }
  return { question: entry.question, shouldFind: entry.finds?.nothing ?? '' };
}

// Returns a Map from each participant's name to { sampleSentences, sampleQuestion }.
export function assignSamples(participants, { cases, questions, seeds }) {
  const positions = { developer: 0, leader: 0 };
  const samples = new Map();
  for (const person of participants) {
    const position = positions[person.role]++;
    samples.set(person.name, {
      sampleSentences: sentencesFor(person.role, position, cases),
      sampleQuestion: questionFor(person.role, position, { questions, seeds }),
    });
  }
  return samples;
}
