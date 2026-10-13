import assert from 'node:assert/strict';
import test from 'node:test';
import { CliError, reportError, UsageError } from './cli.mjs';

function capture() {
  const lines = [];
  return { lines, io: { err: (text) => lines.push(text) } };
}

test('an error with a next step prints both and returns its own exit code', () => {
  const { io, lines } = capture();
  assert.equal(reportError(io, new CliError('Something failed.', { next: 'Do this.' })), 1);
  assert.deepEqual(lines, ['error: Something failed.', 'next: Do this.']);
});

test('a usage error returns exit code 2', () => {
  const { io, lines } = capture();
  assert.equal(reportError(io, new UsageError('Wrong option.', { next: 'Run --help.' })), 2);
  assert.deepEqual(lines, ['error: Wrong option.', 'next: Run --help.']);
});

test('an unexpected failure also names a next step', () => {
  const { io, lines } = capture();
  assert.equal(reportError(io, new TypeError('boom')), 1);
  assert.equal(lines[0], 'error: unexpected failure: boom');
  assert.match(lines[1], /^next: .*troubleshooting/);
});

test('an unexpected failure points at the help the program names, because a Kit has no docs folder', () => {
  const lines = [];
  const io = { err: (text) => lines.push(text), help: 'the README of your Kit' };
  assert.equal(reportError(io, new TypeError('boom')), 1);
  assert.equal(lines[1], 'next: Run the command again. If it keeps failing, see the README of your Kit.');
});
