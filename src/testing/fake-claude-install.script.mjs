// Stand-in for what the real `claude plugin install <plugin> --scope local` does to the
// project: it merges `enabledPlugins` into .claude/settings.local.json (keeping every
// other setting and the file's mode). Observed with the real Claude Code in a
// disposable Linux environment; a program that rewrites the file from settings it read
// before the install loses this entry and leaves the plugin disabled.
import fs from 'node:fs';
import path from 'node:path';

const plugin = process.argv[2];
const file = path.join(process.cwd(), '.claude', 'settings.local.json');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [plugin]: true };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
