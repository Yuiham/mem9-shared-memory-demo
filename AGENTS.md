# Shared-memory demo

A demo that shows how to configure, use and test mem9 shared memory (a Space Chain) with a small team. Two programs: `sharedmem-admin` sets up and checks a team's Spaces on a mem9 server; `sharedmem-participant` configures one person's Codex or Claude Code. Everything in the repository is English.

## Rules that do not show in the code

- Node 22 or newer, no dependencies, no lockfile. Use pnpm for scripts (`pnpm test`); never npm or yarn.
- Source is ESM `.mjs`. Launchers in `bin/` avoid `require` and `__dirname` and check the Node version before importing anything.
- Module direction is enforced by `src/structure.test.mjs`: `administrator` and `participant` import only themselves and `shared`; `shared` imports only itself; only tests import `testing`.
- Tests sit beside the code they cover (`*.test.mjs`); helpers are `*.support.mjs`. Tests start the real launchers as child processes through `src/testing/harness.support.mjs` against the fake mem9 server and the stand-in `claude` and `codex` commands.
- A test touches nothing outside its own temporary directory and never runs the real `claude` or `codex`. Checks of the real plugin installs run by hand inside the isolated Linux machine, never on the developer's machine.
- The real server address lives only in the gitignored `.env`. Keep it, every key and every person's real name out of the repository, test data, docs and command output. Use fictional data.
- State and person files hold keys: write them owner-only (mode 600) and keep them out of git.
- Every command says what it did and ends with a next step; errors name the next step too. `--help` of each command lists what it changes. Only the commands that make wide changes (`init`, `teardown` and the Participant program) show a plan and ask first, or take `--yes`; without a terminal a missing confirmation or choice is a usage error (exit code 2) naming the flag. The other commands change only what their name says (one webhook, one Candidate, the files in `out/`, the Memories of one `verify` run) and do not ask.
- Documentation is `README.md` plus `docs/`; `docs/participant-guide.md` is also the Kit's README. `src/docs.test.mjs` checks that every guide exists, links resolve, every command has a section in the Administrator guide, and no file holds a real address, home path or key. Update the guide when a command's behavior changes.
