// Scans source files for imports and reports violations of the module rules:
// - administrator and participant import only themselves and the shared module;
// - shared imports only itself;
// - the testing module imports only itself;
// - product code never imports the testing module;
// - no file imports a package that is not built into Node.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const PATTERNS = [
  /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bexport\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function importsOf(text) {
  const found = new Set();
  for (const pattern of PATTERNS) for (const match of text.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

export function moduleOf(relativePath) {
  const parts = relativePath.split(path.sep).join('/').split('/');
  return parts[0] === 'src' && parts.length > 2 ? parts[1] : null;
}

// file and its imports are relative to the repository root; text is the file's source.
export function violationsIn(file, text) {
  const problems = [];
  const own = moduleOf(file);
  const isTest = file.endsWith('.test.mjs');
  for (const specifier of importsOf(text)) {
    if (specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      if (!builtinModules.includes(specifier)) problems.push(`${file}: imports the package "${specifier}", which is not built into Node`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.split(path.sep).join('/')), specifier));
    const targetModule = moduleOf(target);
    if (targetModule === null) continue;
    if (own === null) continue;
    if (isTest) {
      if (!['testing', own, 'shared'].includes(targetModule)) problems.push(`${file}: a test imports the ${targetModule} module`);
      continue;
    }
    if (targetModule === 'testing' && own !== 'testing') problems.push(`${file}: product code imports the testing module`);
    else if (own === 'testing' && targetModule !== 'testing') problems.push(`${file}: the testing module imports ${targetModule}`);
    else if (own === 'shared' && targetModule !== 'shared') problems.push(`${file}: the shared module imports ${targetModule}`);
    else if ((own === 'administrator' || own === 'participant') && targetModule !== own && targetModule !== 'shared') {
      problems.push(`${file}: the ${own} module imports ${targetModule}`);
    }
  }
  return problems;
}

export function sourceFiles(repoRoot) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mjs')) files.push(path.relative(repoRoot, full));
    }
  };
  walk(path.join(repoRoot, 'src'));
  for (const name of fs.readdirSync(path.join(repoRoot, 'bin'))) files.push(path.join('bin', name));
  return files;
}
