// Stand-in `claude` and `codex` commands, plus thin wrappers for the few real system
// tools the Participant program needs, so a test controls exactly what is on the path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSystemTool } from './run-cli.support.mjs';

const SETUP_SOURCE = fileURLToPath(new URL('./fake-codex-setup.script.mjs', import.meta.url));
const CLAUDE_INSTALL_SOURCE = fileURLToPath(new URL('./fake-claude-install.script.mjs', import.meta.url));

// The stand-in runs the install effect with this Node, by absolute path: the search
// path of a test holds only the stand-ins and thin tool wrappers.
const claudeStandin = (installScript) => `#!/bin/sh
# Stand-in for the Claude Code command. It accepts exactly the commands the plugin
# contract notes list and fails for anything else. The local-scope install enables the
# plugin in .claude/settings.local.json, as the real one does.
printf 'claude %s (cwd=%s)\\n' "$*" "$PWD" >> "\${STANDIN_LOG:-/dev/null}"
if [ -n "$STANDIN_FAIL_CLAUDE" ]; then echo "claude: simulated failure" >&2; exit 1; fi
case "$*" in
  "plugin marketplace add mem9-ai/mem9") exit 0 ;;
  "plugin install mem9@mem9 --scope local") exec '${process.execPath}' '${installScript}' mem9@mem9 ;;
  *) echo "claude: unsupported arguments: $*" >&2; exit 2 ;;
esac
`;

const CODEX = `#!/bin/sh
# Stand-in for the Codex command. On "plugin add" it creates a fake plugin cache that
# contains the fake setup script, in one directory per name in STANDIN_CODEX_VERSIONS.
printf 'codex %s (cwd=%s)\\n' "$*" "$PWD" >> "\${STANDIN_LOG:-/dev/null}"
if [ -n "$STANDIN_FAIL_CODEX" ]; then echo "codex: simulated failure" >&2; exit 1; fi
case "$*" in
  "plugin marketplace add mem9-ai/mem9") exit 0 ;;
  "plugin add mem9@mem9-ai")
    for version in \${STANDIN_CODEX_VERSIONS:-0.2.6}; do
      dir="$CODEX_HOME/plugins/cache/mem9-ai/mem9/$version/skills/setup/scripts"
      /bin/mkdir -p "$dir" && /bin/cp "$STANDIN_SETUP_SOURCE" "$dir/setup.mjs" || exit 1
    done
    exit 0 ;;
  *) echo "codex: unsupported arguments: $*" >&2; exit 2 ;;
esac
`;

function writeExecutable(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

// Creates <root>/standins (claude, codex, the fake setup script) and <root>/tools
// (wrappers for bash, curl and git that exec the real tool by absolute path).
export function installStandins(root) {
  const standinDir = path.join(root, 'standins');
  const toolsDir = path.join(root, 'tools');
  fs.mkdirSync(standinDir, { recursive: true });
  const claudeInstall = path.join(standinDir, 'fake-claude-install.mjs');
  fs.copyFileSync(CLAUDE_INSTALL_SOURCE, claudeInstall);
  writeExecutable(path.join(standinDir, 'claude'), claudeStandin(claudeInstall));
  writeExecutable(path.join(standinDir, 'codex'), CODEX);
  fs.copyFileSync(SETUP_SOURCE, path.join(standinDir, 'fake-setup.mjs'));
  for (const tool of ['bash', 'curl', 'git']) {
    writeExecutable(path.join(toolsDir, tool), `#!/bin/sh\nexec ${findSystemTool(tool)} "$@"\n`);
  }
  return { standinDir, toolsDir, setupSource: path.join(standinDir, 'fake-setup.mjs') };
}

// omitStandins / omitTools build the search path of a missing-tool scenario by
// copying only the wanted wrappers into a separate directory.
export function searchPathFor({ root, standinDir, toolsDir, omit = [] }) {
  const scenarioDir = path.join(root, `path-${omit.join('-') || 'full'}`);
  fs.mkdirSync(scenarioDir, { recursive: true });
  for (const [dir, names] of [[standinDir, ['claude', 'codex']], [toolsDir, ['bash', 'curl', 'git']]]) {
    for (const name of names) {
      if (omit.includes(name)) continue;
      const target = path.join(scenarioDir, name);
      if (!fs.existsSync(target)) fs.symlinkSync(path.join(dir, name), target);
    }
  }
  return scenarioDir;
}
