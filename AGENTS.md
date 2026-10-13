# Shared-memory demo

A demo of mem9 shared memory (Space Chains) for a small team. `sharedmem-admin` prepares a mem9 server and hands out one Kit per person; `sharedmem-participant`, shipped inside each Kit, connects one person's Claude Code or Codex. [README.md](README.md) explains the flow. Capitalized terms (Space, Chain, Kit, Case, Example) are defined in [docs/concepts.md](docs/concepts.md). Everything in the repository is English.

## Commands

- `pnpm test` runs the whole suite, which is `node --test "src/**/*.test.mjs"`. `node --test <file>` runs one file. There is nothing to install.
- Running the programs by hand writes `state/` and `out/` in the repository. Pass `--workdir <directory>` (or set `SHAREDMEM_WORKDIR`) to keep scratch runs elsewhere. The server cannot list or delete Spaces, so the state file is the only record of what a run created.

## Secrets

- The server address lives only in the git-ignored `.env`. Keys and the address stay out of output (they are masked), the repository, test data and docs. Use fictional people and data.
- Files that hold keys (`state/`, Kits, person files) are written owner-only (mode 600) and stay out of git.
- `src/docs.test.mjs` scans every file for common real-looking hosts, home-directory paths and key shapes. It catches the usual slips, not every one.

## Architecture

- Node 22 or newer, ESM `.mjs`, no dependencies and no lockfile; `src/structure.test.mjs` enforces both and rejects imports of anything not built into Node. The launchers in `bin/` use no `require` or `__dirname` and check the Node version before they import anything, so an old Node fails with a clear message.
- `administrator` and `participant` import only themselves and `shared`; `shared` imports only itself; `testing` imports only itself; only tests import `testing`. `src/structure.test.mjs` enforces these directions.
- A Kit ships `participant` and the `shared` files it imports, found by reading the imports. Only flat files named with lowercase letters and hyphens (`src/participant/*.mjs`, `src/shared/*.mjs`) can ship, so a subfolder or a digit in a file name breaks `export`.
- Names that several modules must agree on (the event type, the Agent ID prefixes, the placeholder address rule) live in `src/shared/names.mjs`.

## Command-line conventions

- A command describes itself with `renderHelp` (a spec with `changes` and `next`) and fails with `CliError` or `UsageError`, which carry a `next`. Every command ends with a next step and every error names one.
- `init`, `teardown` and the Participant program change a lot at once, so they show a plan and ask first; `--yes` answers yes. Without a terminal, a missing confirmation or choice is a usage error (exit code 2) that names the flag to pass.
- The other commands act on the one thing their name says (`export` rebuilds `out/`, `verify` writes and removes its own test Memories) and do not ask. Their `--help` lists what they change.

## Tests

- Tests sit beside the code (`*.test.mjs`); helpers are `*.support.mjs`.
- Integration tests are hermetic. Each starts the real launchers as child processes (`src/testing/harness.support.mjs`) against a fake mem9 server on a local port and stand-in `claude` and `codex` commands, inside its own temporary directory. No test uses the network, a real `claude` or `codex`, or the home directory. The other tests read files or call modules directly.
- The stand-ins copy behavior observed with the real plugins. When a real plugin behaves differently, change the stand-in to match, add the test, fix the program, and record what you observed in the commit message.
- The fake server routes by regular expressions that mirror the sentences of the shipped Cases (`SHIPPED_ROUTING` in the harness). Change a Case and its expression together.

## Docs

- Keep the docs in step with behavior. A new guide goes in `GUIDES` in `src/docs.test.mjs` and gets a link in the README; `TODO`-style markers fail that test.
- `docs/participant-guide.md` doubles as every Kit's README, so it uses no relative links.
