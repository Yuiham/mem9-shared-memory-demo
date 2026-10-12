// Finding and running the commands the recipes need.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared/cli.mjs';

export function findOnPath(name, env) {
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

// What a missing command means for the Participant: a name and what to do about it.
export function requireTools(env, tools, { agentName }) {
  const missing = tools.filter((tool) => !findOnPath(tool.command, env));
  if (missing.length === 0) return;
  const lines = missing.map((tool) => `- ${tool.problem}`);
  throw new CliError(`${agentName} cannot be set up yet, because something it needs is missing:\n${lines.join('\n')}`, {
    next: `${missing.map((tool) => tool.fix).join(' ')} Then open a new terminal and run this program again.`,
  });
}

// Runs a command and collects its output. The command is spawned by name, found through
// the search path in env, and never through a shell.
export function runTool({ command, args, cwd, env }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: 127, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const tail = (text) => text.trim().split('\n').slice(-6).join('\n');

// Runs a command that must succeed; a failure names the command and shows its output.
export async function mustRun({ display, command, args, cwd, env }) {
  const result = await runTool({ command, args, cwd, env });
  if (result.code !== 0) {
    const detail = tail(result.stderr || result.stdout);
    throw new CliError(`The command \`${display}\` failed (exit code ${result.code}).${detail ? `\n${detail}` : ''}`, {
      next: 'Fix the problem shown above and run this program again. It is safe to repeat.',
    });
  }
  return result;
}
