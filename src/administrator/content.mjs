// Shipped content: the cast, Routing prompts and Seed memories live in plain files under
// config/. They are read from the program's own location and never written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../shared/cli.mjs';
import { loadCast } from '../shared/cast.mjs';

export const CONFIG_DIR = fileURLToPath(new URL('../../config/', import.meta.url));
export const PROMPT_LIMIT = 1200;
export const DEFAULT_CAST_FILE = path.join(CONFIG_DIR, 'cast.json');

const PROMPT_FILES = {
  teamAuto: 'team-shared-auto',
  leadershipAuto: 'leadership-shared-auto',
  teamApproval: 'team-shared-approval',
};

export function readJsonConfig(name) {
  const file = path.join(CONFIG_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CliError(`The shipped file config/${name} cannot be read (${error.code ?? 'invalid JSON'}).`, {
      next: 'Restore the file from the repository.',
    });
  }
}

// Returns the three Routing prompts, each checked against the server's length limit
// before anything is sent.
export function loadPrompts() {
  const prompts = {};
  for (const [key, name] of Object.entries(PROMPT_FILES)) {
    const file = path.join(CONFIG_DIR, 'routing-prompts', `${name}.txt`);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8').trim();
    } catch {
      throw new CliError(`The Routing prompt file config/routing-prompts/${name}.txt cannot be read.`, { next: 'Restore the file from the repository.' });
    }
    const length = [...text].length;
    if (length === 0) {
      throw new CliError(`The Routing prompt "${name}" is empty.`, { next: `Write the prompt in config/routing-prompts/${name}.txt and run the command again.` });
    }
    if (length > PROMPT_LIMIT) {
      throw new CliError(`The Routing prompt "${name}" is ${length.toLocaleString('en-US')} characters; the server accepts at most ${PROMPT_LIMIT.toLocaleString('en-US')}.`, {
        next: `Shorten config/routing-prompts/${name}.txt and run the command again.`,
      });
    }
    prompts[key] = text;
  }
  return prompts;
}

export function loadSeeds() {
  const seeds = readJsonConfig('seed-memories.json').memories;
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new CliError('config/seed-memories.json has no memories.', { next: 'Restore the file from the repository.' });
  }
  return seeds;
}

export function loadDemoCast(castFlag) {
  return loadCast(castFlag ? path.resolve(castFlag) : DEFAULT_CAST_FILE);
}
