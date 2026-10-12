// The commands of the Administrator program, in the order the overview lists them.
// Each entry: { summary, run(argv, { io, env, program }) -> exit code }.
import * as candidates from './candidates.mjs';
import * as exportKits from './export.mjs';
import * as init from './init.mjs';
import * as memories from './memories.mjs';
import * as receiver from './receiver.mjs';
import * as simulate from './simulate.mjs';
import * as teardown from './teardown.mjs';
import * as verify from './verify.mjs';
import * as webhook from './webhook.mjs';

export const COMMANDS = {
  init,
  memories,
  verify,
  export: exportKits,
  webhook,
  receiver,
  candidates,
  simulate,
  teardown,
};
