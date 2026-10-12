// Starts the real launchers as child processes under a constructed environment, and
// refuses to run when the environment could reach anything outside the test.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const children = new Set();

export function killAllChildren() {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
}

// Runs a program to completion. Asynchronous on purpose: the fake server lives in the
// test's own process and cannot answer while a blocking call waits.
export function runCli({ launcher, args = [], env, cwd, input = '', timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, stdout, stderr, timedOut, output: stdout + stderr });
    });
  });
}

// Starts a long-running program (the receiver) and waits until a line matches.
export function startProgram({ launcher, args = [], env, cwd, readyPattern, timeoutMs = 20000 }) {
  const child = spawn(process.execPath, [launcher, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on('close', (code) => { children.delete(child); resolve(code); }));
  const ready = new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (readyPattern.test(stdout)) { clearInterval(poll); resolve(); }
      else if (Date.now() - started > timeoutMs) { clearInterval(poll); reject(new Error(`program did not become ready: ${stdout}${stderr}`)); }
    }, 25);
    exited.then(() => { clearInterval(poll); reject(new Error(`program exited early: ${stdout}${stderr}`)); });
  });
  return {
    ready,
    exited,
    output: () => stdout + stderr,
    stdout: () => stdout,
    async stop() {
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(killer);
    },
  };
}

function resolveOnPath(name, searchPath) {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export const SYSTEM_PATH = ['/usr/bin', '/bin'].join(path.delimiter);

// Finds a real system tool once, so wrappers can exec it by absolute path.
export function findSystemTool(name) {
  const found = resolveOnPath(name, [...SYSTEM_PATH.split(path.delimiter), '/usr/local/bin', '/opt/homebrew/bin'].join(path.delimiter));
  if (!found) throw new Error(`the test host has no ${name}`);
  return found;
}

// Builds the child environment from an allow-list; nothing is inherited.
export function makeEnv({ root, serverUrl, workdir, searchPath, extra = {} }) {
  const home = path.join(root, 'home');
  const temporary = path.join(root, 'tmp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temporary, { recursive: true });
  const env = {
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    CODEX_HOME: path.join(home, '.codex'),
    MEM9_HOME: path.join(home, '.mem9'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude-config'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    PATH: searchPath,
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
  if (serverUrl) env.SHAREDMEM_API_URL = serverUrl;
  if (workdir) env.SHAREDMEM_WORKDIR = workdir;
  return env;
}

// Checks that the environment cannot touch anything outside the test.
export function preflight(env, { root, standinDir, scenario = 'standins' }) {
  const problems = [];
  if (env.SHAREDMEM_API_URL) {
    const host = new URL(env.SHAREDMEM_API_URL).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') problems.push('the server address does not point at the local machine');
  }
  for (const tool of ['claude', 'codex']) {
    const found = resolveOnPath(tool, env.PATH);
    if (scenario === `missing-${tool}`) {
      if (found) problems.push(`${tool} resolves although this scenario removes it`);
    } else if (!found || !fs.realpathSync(found).startsWith(fs.realpathSync(standinDir))) {
      problems.push(`${tool} does not resolve to the stand-in`);
    }
  }
  const inside = (value) => typeof value === 'string' && path.resolve(value).startsWith(path.resolve(root) + path.sep);
  for (const name of ['HOME', 'TMPDIR', 'CODEX_HOME', 'MEM9_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME']) {
    if (!inside(env[name])) problems.push(`${name} points outside the test's temporary directory`);
  }
  const homedir = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], { env }).stdout?.toString();
  if (homedir !== env.HOME) problems.push('os.homedir() disagrees with HOME in the constructed environment');
  if (problems.length > 0) throw new Error(`unsafe test environment:\n  - ${problems.join('\n  - ')}`);
}

export function makeTempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharedmem-test-')));
}
