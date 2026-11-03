// The local state: the only record of the Spaces, Chains and webhooks the demo created.
// It is saved right after every call that creates something.
import path from 'node:path';
import { CliError } from '../shared/cli.mjs';
import { readJson, writeJsonWithBackup } from '../shared/fsx.mjs';

// Version 2 records two keys for each Chain: the management key the Administrator keeps
// and the memory key a Kit carries.
export const STATE_VERSION = 2;

export class StateStore {
  constructor({ workdir, serverUrl, io }) {
    this.workdir = workdir;
    this.serverUrl = serverUrl;
    this.io = io;
    this.file = path.join(workdir, 'state', 'state.json');
    this.state = null;
  }

  // Loads the state when there is one and checks that it belongs to this server.
  load() {
    const state = readJson(this.file, { label: 'state' });
    if (!state) return null;
    if (state.version === 1) {
      throw new CliError(`The state in this working directory was written by an earlier version of this demo (state version 1; this version reads version ${STATE_VERSION}).`, {
        next: 'Move the state folder out of the repository, or delete it, before you run this version; do not rename it inside the repository, because git would pick up the keys in it. The Chains and Spaces the earlier version created are not deleted: they stay on the server.',
      });
    }
    if (state.version !== STATE_VERSION) {
      throw new CliError(`The state file has version ${state.version}, but this program writes version ${STATE_VERSION}.`, {
        next: 'Use the version of the demo that created the state, or move the state folder out of the repository (or delete it) to start again.',
      });
    }
    if (state.serverUrl !== this.serverUrl) {
      throw new CliError('The state in this working directory belongs to a different server address.', {
        next: 'Point SHAREDMEM_API_URL at the server the state was created for, or give each server its own working directory with --workdir.',
      });
    }
    this.state = state;
    this.#register();
    return state;
  }

  create({ example }) {
    this.state = { version: STATE_VERSION, serverUrl: this.serverUrl, example, participants: [], spaces: {}, chains: {}, webhooks: {} };
    return this.state;
  }

  save() {
    writeJsonWithBackup(this.file, this.state);
    this.#register();
  }

  // Everything secret in the state is masked in all later output.
  #register() {
    const { redactor } = this.io;
    for (const space of Object.values(this.state.spaces)) redactor.addSecret(space.key);
    for (const chain of Object.values(this.state.chains)) {
      redactor.addSecret(chain.managementKey);
      redactor.addSecret(chain.memoryKey);
    }
    for (const webhook of Object.values(this.state.webhooks)) redactor.addSecret(webhook.secret);
  }
}
