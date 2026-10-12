// The commands of the Administrator program, in the order the overview lists them.
// Each entry: { summary, run(argv, { io, env, program }) -> exit code }.
import * as init from './init.mjs';
import * as memories from './memories.mjs';
import * as teardown from './teardown.mjs';
import * as verify from './verify.mjs';

export const COMMANDS = {
  init,
  memories,
  verify,
  teardown,
};
