// The runtime file of a running receiver: where it listens. `simulate` and `verify`
// find a running receiver through it. It sits next to the state and is removed when the
// receiver stops; one left behind by a crash is recognized by its dead process.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonOwnerOnly } from '../shared/fsx.mjs';

export const runtimeFile = (workdir) => path.join(workdir, 'state', 'receiver.json');

export function readRuntime(workdir) {
  return readJson(runtimeFile(workdir), { label: 'receiver runtime' });
}

export function writeRuntime(workdir, runtime) {
  writeJsonOwnerOnly(runtimeFile(workdir), runtime);
}

export function removeRuntime(workdir) {
  fs.rmSync(runtimeFile(workdir), { force: true });
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
