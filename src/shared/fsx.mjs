// File helpers: owner-only files, atomic writes and a backup copy on every write.
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './cli.mjs';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// Writes through a temporary file in the same folder and renames it into place, so a
// reader never sees a half-written file.
export function writeFileAtomic(file, data, mode = 0o600) {
  ensureDir(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, data, { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

// Keeps the previous version as `<file>.bak` (the new one when there is no previous
// version), both readable only by the owner, then replaces the file atomically.
export function writeJsonWithBackup(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const backup = `${file}.bak`;
  if (fs.existsSync(file)) {
    writeFileAtomic(backup, fs.readFileSync(file));
  } else {
    writeFileAtomic(backup, text);
  }
  writeFileAtomic(file, text);
}

export function readJson(file, { label = path.basename(file) } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`The ${label} file is not valid JSON.`, {
      next: `Restore it from ${path.basename(file)}.bak next to it, or remove it to start again.`,
    });
  }
}

export function writeJsonOwnerOnly(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}
