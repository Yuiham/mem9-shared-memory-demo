// What the Participant reads after setup: where to go, what to say, what to ask and
// what to expect. Printing it again is always safe.
const ROLE_LABEL = { leader: 'Leader', developer: 'Developer' };

function expectation(person) {
  if (person.role === 'developer') {
    return 'Lasting engineering knowledge is shared with the team, and personal preferences stay in your own Personal space. Chatter and one-off remarks are ignored.';
  }
  const lines = ['Leadership matters go to Leadership Shared, which only Leaders can read.'];
  lines.push(person.example === 'approval'
    ? 'Approval Example: a team-wide announcement is proposed to Team Shared and appears there only after the Administrator approves it. Until then it stays in your Personal space.'
    : 'Basic Example: your announcements stay in your Personal space; nothing reaches Team Shared on its own.');
  return lines.join(' ');
}

// `afterStart` holds what the person must do once the agent is running, as lines: the
// first one is the text of step 4 and the others continue it.
export function printGuidance(io, { person, agentLabel, dir, command, notes, afterStart = [] }) {
  io.out('');
  io.out(`Done: ${agentLabel} is set up for ${person.name} (${ROLE_LABEL[person.role]}) in ${dir}.`);
  io.out('');
  io.out('Next steps');
  io.out('  1. Open a new terminal window. Keep this one: it is your record of what was set up.');
  io.out(`  2. cd ${dir}`);
  io.out(`  3. Start ${agentLabel}:`);
  io.out(`       ${command}`);
  if (afterStart.length > 0) {
    io.out(`  4. ${afterStart[0]}`);
    for (const line of afterStart.slice(1)) io.out(`     ${line}`);
  }
  io.out('');
  io.out('Try it');
  io.out('  Say these to your agent, one at a time:');
  for (const sentence of person.sampleSentences) io.out(`    - ${sentence}`);
  io.out('  Then ask:');
  io.out(`    ${person.sampleQuestion.question}`);
  if (person.sampleQuestion.shouldFind) io.out(`  You should find: ${person.sampleQuestion.shouldFind}`);
  io.out('  The plugin saves in the background, so shared Memories appear after about a minute.');
  io.out(`  What to expect: ${expectation(person)}`);
  if (notes.length > 0) {
    io.out('');
    io.out('Good to know');
    for (const note of notes) io.out(`  - ${note}`);
  }
  io.out('');
  io.out('You can run this program again at any time to see this guidance again.');
}
