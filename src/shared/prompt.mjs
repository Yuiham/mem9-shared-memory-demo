// Prompts. Nothing here ever asks anything without a terminal: callers get an error
// that names the flag to pass instead.
import readline from 'node:readline';
import { CliError } from './cli.mjs';

export async function confirm(io, question, { yes = false } = {}) {
  if (yes) return true;
  if (!io.isTTY) {
    throw new CliError(`${question} This needs your confirmation, but there is no terminal to ask.`, {
      next: 'Run the command again with --yes to confirm in advance.',
    });
  }
  const answer = await ask(io, `${question} [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

export async function askText(io, question, defaultValue) {
  const answer = await ask(io, `${question} [${defaultValue}] `);
  return answer.trim() || defaultValue;
}

function ask(io, prompt) {
  const rl = readline.createInterface({ input: io.stdin, output: io.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// choices: [{ value, label }]. Arrow keys and Enter on a terminal.
export async function select(io, title, choices, { flag }) {
  if (!io.isTTY) {
    throw new CliError(`No choice was made for: ${title}.`, { next: `Pass ${flag} to choose without a prompt.` });
  }
  readline.emitKeypressEvents(io.stdin);
  const wasRaw = io.stdin.isRaw;
  io.stdin.setRawMode(true);
  io.stdin.resume();
  let index = 0;
  let drawn = false;
  const draw = () => {
    if (drawn) io.stdout.write(`\x1b[${choices.length}A`);
    drawn = true;
    choices.forEach((choice, position) => {
      io.stdout.write(`\x1b[2K${position === index ? '> ' : '  '}${choice.label}\n`);
    });
  };
  io.stdout.write(`${title} (use the arrow keys, then Enter)\n`);
  draw();
  return new Promise((resolve, reject) => {
    const finish = (fn) => {
      io.stdin.off('keypress', onKey);
      io.stdin.setRawMode(Boolean(wasRaw));
      io.stdin.pause();
      fn();
    };
    const onKey = (_text, key) => {
      if (!key) return;
      if (key.name === 'up') index = (index + choices.length - 1) % choices.length;
      else if (key.name === 'down') index = (index + 1) % choices.length;
      else if (key.name === 'return') return finish(() => resolve(choices[index].value));
      else if (key.ctrl && key.name === 'c') return finish(() => reject(new CliError('Cancelled.')));
      draw();
    };
    io.stdin.on('keypress', onKey);
  });
}
