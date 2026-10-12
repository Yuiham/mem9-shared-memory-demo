# Shared-memory demo

A hands-on demo of mem9 shared memory (Space Chains). A small team of Leaders and Developers each talk to their own coding agent (Claude Code or Codex). What matters for the team flows into a shared **Team Shared** space, what only Leaders need goes to a **Leadership Shared** space that Developers cannot read, and personal preferences stay personal.

The repository holds two command-line programs and no dependencies (Node 22 or newer):

- `bin/sharedmem-admin`: the **Administrator** prepares the environment on a mem9 server, checks that the routing rules work, and hands out one Kit per person.
- `bin/sharedmem-participant`: ships inside each Kit. A **Participant** runs it once to connect their own coding agent to their own Chain.

All data in the demo is fictional. The development server may use plain HTTP, so never type anything real.

## Choose your path

| You are | Start here |
| --- | --- |
| The Administrator preparing the demo | [Administrator guide](docs/administrator-guide.md) and the quick start below |
| A Participant who received a Kit | The `README.md` inside your Kit (the [Participant guide](docs/participant-guide.md)) |
| Someone who wants to understand the ideas | [Concepts](docs/concepts.md) |

## Administrator quick start

1. Check `node --version` (22 or newer).
2. Copy `.env.example` to `.env` and put the server address in it. `.env` is ignored by git. The address is never printed or committed.
3. Build the environment:

   ```
   ./bin/sharedmem-admin init          # shows a plan, asks, then builds Spaces, Chains, routing and Seed memories
   ./bin/sharedmem-admin verify        # sends 12 sample sentences through real routing and compares results
   ./bin/sharedmem-admin export        # one Kit per person in out/kits/<name>/, plus out/report.md
   ```

4. Send each person only their own Kit folder (a zip works). A Kit holds that person's chain key, so treat it as a secret.
5. Watch what happens: `./bin/sharedmem-admin memories` counts Memories per space, `memories --as ana` shows what one person sees.

Every command explains what it changes with `--help`, asks before changing anything (or takes `--yes`), and ends with a next step.

### The Approval Example

The default is the **Basic** Example. In the **Approval** Example a Leader's team-wide announcement is not written to Team Shared directly: it becomes a **Candidate** that you approve first.

```
./bin/sharedmem-admin init --example approval
./bin/sharedmem-admin webhook set --url https://receiver.invalid/   # a placeholder is enough to prepare and to simulate
./bin/sharedmem-admin receiver serve                                # leave running in its own terminal
./bin/sharedmem-admin simulate --leader lucia --text "Starting Monday, all production deploys require two reviewers."
./bin/sharedmem-admin candidates                                    # see it
./bin/sharedmem-admin candidates approve c1                         # writes it into Team Shared
```

Receiving real deliveries from the server needs a public HTTPS address (a tunnel to the receiver's port); see the [Administrator guide](docs/administrator-guide.md#receiving-real-deliveries).

## Documentation

- [Administrator guide](docs/administrator-guide.md): every command, the working directory, Examples, the cast, cleaning up.
- [Participant guide](docs/participant-guide.md): what a Participant does with a Kit (also the Kit's `README.md`).
- [Concepts](docs/concepts.md): Spaces, Chains, the two kinds of keys, external space identifiers, Node modes, Examples.
- [Known gaps](docs/known-gaps.md): what the demo does not do or cannot guarantee.
- [Troubleshooting](docs/troubleshooting.md): a lost state file, a rejected webhook address, a Claude Code session started in the wrong directory, and more.

## Tests

```
pnpm test        # node --test "src/**/*.test.mjs"
```

The tests never touch the real server, the real `claude` or `codex` commands, or your home directory. They start the real programs against a fake mem9 server on a local port and against stand-in agent commands, inside a temporary directory. Checking the real plugin installs is done by hand inside an isolated Linux machine, never on a developer's computer.

## Layout

```
bin/        the two launchers
config/     shipped content you can read and edit: cast, Routing prompts, Cases, Seed memories, sample questions
docs/       the guides
src/        administrator, participant, shared (and testing support); tests sit beside the code
state/      created by the Administrator program: every key (git-ignored)
out/        created by export: Kits and the report (git-ignored)
```
