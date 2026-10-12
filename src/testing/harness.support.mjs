// One test's whole world: a temporary directory, a fake mem9 server, a constructed
// environment and helpers that start the real launchers against them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeMem9 } from './fake-mem9.support.mjs';
import { installStandins, searchPathFor } from './standins.support.mjs';
import { killAllChildren, makeEnv, makeTempRoot, preflight, runCli, startProgram } from './run-cli.support.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ADMIN_LAUNCHER = path.join(REPO_ROOT, 'bin', 'sharedmem-admin');
export const PARTICIPANT_LAUNCHER_NAME = path.join('bin', 'sharedmem-participant');

export async function createHarness({ fake = true, fakeOptions } = {}) {
  const root = makeTempRoot();
  const workdir = path.join(root, 'work');
  fs.mkdirSync(workdir, { recursive: true });
  const server = fake ? await new FakeMem9(fakeOptions).start() : null;
  const standins = installStandins(root);
  const logFile = path.join(root, 'standins.log');
  const harness = {
    root,
    workdir,
    fake: server,
    standins,
    logFile,
    cleaned: false,
    env(overrides = {}, { omit = [], scenario = 'standins' } = {}) {
      // The search path is one directory holding only the stand-ins and thin wrappers for
      // bash, curl and git, so a scenario can leave any of them out.
      const searchPath = searchPathFor({ root, ...standins, omit });
      const extra = {
        STANDIN_LOG: logFile,
        STANDIN_SETUP_SOURCE: standins.setupSource,
        ...overrides.extra,
      };
      const env = makeEnv({ root, serverUrl: server?.url, workdir, searchPath, extra });
      const merged = { ...env, ...Object.fromEntries(Object.entries(overrides).filter(([name]) => name !== 'extra')) };
      for (const [name, value] of Object.entries(merged)) if (value === undefined) delete merged[name];
      preflight(merged, { root, standinDir: standins.standinDir, scenario });
      return merged;
    },
    async admin(args, { env, input, timeoutMs, launcher } = {}) {
      return runCli({ launcher: launcher ?? ADMIN_LAUNCHER, args, env: env ?? harness.env(), cwd: workdir, input, timeoutMs });
    },
    // Copies the programs and their shipped content into the temporary directory, so a
    // test can change shipped content without touching the repository. Returns the
    // copy's Administrator launcher.
    copyProgram() {
      const target = path.join(root, 'program-copy');
      for (const name of ['bin', 'src', 'config']) fs.cpSync(path.join(REPO_ROOT, name), path.join(target, name), { recursive: true });
      return { dir: target, launcher: path.join(target, 'bin', 'sharedmem-admin') };
    },
    // Counts the requests the fake server received for a method and an exact path
    // (a string) or a pattern.
    count(method, where) {
      const matches = (requestPath) => (where instanceof RegExp ? where.test(requestPath) : requestPath === where);
      return server.requests.filter((request) => request.method === method && matches(request.path)).length;
    },
    // Runs a program from an exported Kit, never from the source tree.
    async participant(kitDir, args, { env, input, cwd, timeoutMs } = {}) {
      return runCli({ launcher: path.join(kitDir, PARTICIPANT_LAUNCHER_NAME), args, env: env ?? harness.env(), cwd: cwd ?? kitDir, input, timeoutMs });
    },
    startAdmin(args, { env, readyPattern }) {
      return startProgram({ launcher: ADMIN_LAUNCHER, args, env: env ?? harness.env(), cwd: workdir, readyPattern });
    },
    writeCast(participants, name = 'cast.json') {
      const file = path.join(root, name);
      fs.writeFileSync(file, JSON.stringify({ participants }, null, 2));
      return file;
    },
    readState() {
      return JSON.parse(fs.readFileSync(path.join(workdir, 'state', 'state.json'), 'utf8'));
    },
    standinLog() {
      return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
    },
    async cleanup() {
      if (harness.cleaned) return;
      harness.cleaned = true;
      killAllChildren();
      if (server) await server.stop();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return harness;
}

// Registers cleanup with a node:test context so it also runs when a test fails.
export async function withHarness(t, options) {
  const harness = await createHarness(options);
  t.after(() => harness.cleanup());
  return harness;
}

export const SMALL_CAST = [
  { name: 'lucia', role: 'leader' },
  { name: 'ana', role: 'developer' },
];

export const SHIPPED_ROUTING = {
  rules: [
    { match: /database migrations|idempotent|outage|feature flag/i, targets: ['team-shared'] },
    { match: /budget|hire two|performance review|pause the new marketplace/i, targets: ['leadership-shared'] },
    { match: /two reviewers|release freeze/i, targets: ['team-shared'] },
  ],
  drop: null,
};
