# Administrator guide

The Administrator prepares the environment on a mem9 server, checks the routing, hands out Kits and, in the Approval Example, approves announcements. Everything is done with `bin/sharedmem-admin <command>`.

- Run `bin/sharedmem-admin` with no arguments to list the commands.
- Run `<command> --help` to see what a command changes, its options and examples.
- New to the vocabulary (Space, Chain, Node mode, Example)? Read [Concepts](concepts.md) first.

## Before you start

- **Node 22 or newer** (`node --version`). No dependencies, nothing to install.
- **The server address.** Copy `.env.example` to `.env` and set `SHAREDMEM_API_URL` to the mem9 server's address.
  - A variable already set in your shell wins over the file.
  - The address is masked in all output. Besides `.env`, it is stored in `state/state.json` and in each Kit's `person.json`.
  - If it starts with `http://`, the programs warn once per run: traffic is not encrypted, so use fictional data only.
- **The state file.** `state/state.json` (created by `init`) records every key. Treat it as a secret and do not lose it (see [Troubleshooting](troubleshooting.md#i-lost-the-state-file)).

## A typical rehearsal

1. `init`, then `verify`; tune the prompts until the Cases pass.
2. `export`; run a Kit yourself in a scratch directory to see what a Participant sees.
3. Say the sample sentences to your agent, wait about a minute, ask the sample question; `memories --as <name>` shows what the server holds.
4. Approval: `init --example approval`, `webhook set`, `receiver serve`, `simulate`, `candidates approve`.
5. When done: `teardown`.

## The working directory

The `.env` file, `state/` and `out/` all live in one working directory.

- It defaults to the repository.
- Redirect it with `--workdir <directory>` or the `SHAREDMEM_WORKDIR` variable, for example to rehearse without touching real data.
- The shipped content under `config/` is only read, never written.

| Path | What it holds |
| --- | --- |
| `state/state.json` (+ `.bak`) | Every Space, Chain and webhook, with their keys; the active Example |
| `state/candidates.json` (+ `.bak`) | Announcements waiting for approval, and the delivery ids already handled |
| `state/receiver.json` | Where a running receiver listens (removed when it stops) |
| `out/kits/<name>/`, `out/report.md` | What `export` builds; rebuilt from scratch every time |

All of these are owner-only files and are ignored by git.

## The cast

By default the demo has two Leaders (`lucia`, `marco`) and four Developers (`ana`, `bruno`, `carla`, `diego`), listed in `config/cast.json`. To use another cast, either edit that file or pass a file of the same shape to `init`:

```
./bin/sharedmem-admin init --cast my-cast.json
```

```json
{ "participants": [ { "name": "lucia", "role": "leader" }, { "name": "ana", "role": "developer" } ] }
```

A file passed with `--cast` is not remembered, so pass it on every `init`; a plain `init` reads `config/cast.json` again.

The rules:

- A name uses lowercase letters, digits and hyphens, at most 100 characters, and is unique.
- A name cannot be `seed`, `team-shared` or `leadership-shared`, and cannot start with `verify-`.
- A cast needs at least one Leader and one Developer. Beyond that any size works.
- A name becomes the person's Agent ID, their Chain name suffix and their Kit folder.
- A cast that drops someone who already has a Chain is refused until you run `teardown`.

## Commands

| Command | Use it to | What it changes |
| --- | --- | --- |
| `init` | Build or update the environment | Server: Spaces, Chains, routing, Seed memories. Local: `state/state.json` |
| `verify` | Check the routing | Server: test Memories, removed afterwards. Local: test Candidates, only if a receiver is running |
| `memories` | See where Memories landed | Nothing |
| `export` | Build one Kit per person | Local: `out/kits/` and `out/report.md` |
| `webhook set` | Register the Approval Example's endpoints | Server: webhook endpoints. Local: signing secrets in `state/state.json` |
| `webhook deliveries` | See what the server tried to deliver | Nothing |
| `receiver serve` | Receive the server's deliveries | Local: `state/candidates.json` and `state/receiver.json` |
| `candidates` | List, approve or reject announcements | `list`: nothing. `approve`: a pinned Memory in Team Shared, and `state/candidates.json`. `reject`: `state/candidates.json` |
| `simulate` | Show approval without a public address | Local: the receiver stores a simulated Candidate in `state/candidates.json` |
| `teardown` | Delete the Chains | Server: the Chains. Local: removes them from `state/state.json` |

### `init`

Creates or reuses the whole environment:

- one Personal space per person, plus Team Shared and Leadership Shared;
- one Chain per person;
- the routing rules for the chosen Example;
- the Seed memories.

Before any server call it validates the cast, the Example and the length of every Routing prompt. Then it shows its plan and asks. `--yes` skips the question; without a terminal and without `--yes` it fails and says so.

- `--example basic|approval` chooses the Example. The first run defaults to Basic; a re-run without the flag keeps the recorded one.
- Safe to re-run: what exists is reused. A Chain whose nodes already match keeps them, and only routing rules that differ are updated. A Chain the server no longer knows is created again on the same Spaces; its key changes, so export the Kits again.
- The server does not show which Space a node points at, so `init` records the node ids and the mem9 API keys it wrote in `state/state.json` and compares against that record. A node replaced on the server by another tool, or a Space provisioned again under the same name, makes `init` set that Chain's nodes again. A state written by an earlier version has no record: the first `init` sets every Chain's nodes once and keeps the routing rules, and the run after that changes nothing.
- Switching Examples changes one routing rule in place. Chains and keys stay the same, so Kits already handed out keep connecting. Run `export` again to refresh the Example label inside them.
- It warns when you apply Approval with no webhook registered, because announcements would be lost.

### `verify`

Sends every Case (a sample sentence with where it should land) through the real routing path, one at a time. It prints a table of expected against actual with PASS, FAIL or SKIP. The exit code is 1 when a Case fails.

How it checks a Case:

- It writes the Case through the Chain of the first person with the speaker's role, under its own Agent ID `verify-<run>-<case>`, using the server's synchronous write.
- It reads back the speaker's Personal space, Team Shared and Leadership Shared.
- Afterwards it removes everything it wrote, of every Memory type.

A routing step that fails on the server still lets the write succeed, so a missing copy is reported as a failure.

In the Approval Example:

- A Case that should become a Candidate passes when nothing reached Team Shared and the server recorded a new routed-fact delivery for the Chain.
- If the receiver is running and the webhook address is a real one, the matching Candidate must also arrive. It is a test Candidate, hidden from the default `candidates` listing.
- Without a registered webhook these Cases are skipped with a notice.

Options:

- `--wait <seconds>` (default 15) sets how long the Approval Example waits for the delivery record and the Candidate.
- `--cases <file>` replaces the shipped Cases, for a spot check with fresh sentences. The file has the same fields as `config/cases.json` and is validated completely before anything is sent.

Routing is judged by a language model and can vary between runs. A pass is a spot check, not a guarantee. If a Case fails, run `verify` once more, then [tune the Routing prompts](routing-prompts.md#change-a-prompt) and verify again.

### `memories`

Shows where Memories landed.

- No options: every space with its Memory counts.
- `--space <name>` (`team-shared`, `leadership-shared`, or a person's name for their Personal space): that space's Memories with their Agent IDs.
- `--as <person>`: the merged view through that person's Chain, with the space each Memory came from.
- Only long-term Memories (pinned and insight) are listed. `--all-types` adds session Memories, the raw conversation.

### `export`

Builds `out/kits/<name>/` for every person and `out/report.md` (who gets which Kit and which Example is active, with no secrets). Everything is rebuilt from scratch: the previous Kits and report are removed first, other files in `out/` stay.

A Kit contains:

- the Participant program and the code it needs;
- `person.json` (owner-only): the person's name, role, server address, own chain key, Agent ID, sample sentences, sample question with what it should find, and the Example at export time;
- `README.md`: the [Participant guide](participant-guide.md).

A Kit never contains tests, administrator code or anyone else's key. **A Kit is a secret.** Send each person only their own, for example as a zip.

### `webhook set --url <address> [--test]`

Used in the Approval Example.

- Registers one webhook endpoint on every Leader Chain, subscribed only to routed-fact events.
- Records each signing secret in the state. The server shows a secret once, and it is never printed here.
- Running it again updates the address and keeps the secret.

Address rules:

- The server requires an HTTPS address without credentials and refuses a literal private IP address such as `127.0.0.1`. It resolves host names only when it delivers. The program leaves the judgment to the server and explains a rejection.
- With no public address yet, register the placeholder `https://receiver.invalid/`: it is accepted and can never deliver. That is enough for `verify` and `simulate`. Do not combine it with `--test`.
- `--test` asks the server to send a test event to each endpoint; watch the receiver's terminal for it.

### `webhook deliveries [--leader <name>]`

Lists the server's delivery records for every Leader Chain (or one with `--leader`), newest first. Each record shows:

- the status: `pending`, `delivered` or `failed`;
- the number of attempts;
- the last HTTP status and the last error.

Use it to see whether the server tried to deliver and what went wrong. Records carry no event content and do not say which node a delivery was for.

### `receiver serve [--port <number>]`

Runs the local receiver in the foreground until Ctrl+C. It listens on `127.0.0.1` only (default port 8787; `--port 0` picks a free one), accepts deliveries on any path, and prints where it listens.

For each delivery it:

- checks the signature with the secret recorded for the delivery's Chain;
- refuses timestamps more than five minutes from this computer's clock;
- ignores duplicates, also after a restart;
- acknowledges but ignores deliveries that were not held back;
- turns each source fact of a held-back announcement into one Candidate, attributed to the Leader whose Chain produced the delivery.

It answers within milliseconds with a 2xx status, which is the only answer the server counts as delivered.

### `candidates [list | approve <id> | reject <id>]`

- `candidates` (or `list`) shows the Candidates. Test Candidates (caused by `verify`) are hidden unless you add `--include-test`; simulated ones are marked.
- `candidates approve <id>` writes the text word for word into Team Shared as a pinned Memory attributed to the Leader who announced it, and only then records the approval. If the write fails, the Candidate stays pending.
- `candidates reject <id>` marks it rejected; nothing is written.
- Only a pending Candidate can be approved or rejected.

### `simulate --leader <name> --text <announcement>`

Posts a correctly signed delivery to the running receiver, as if the server had held an announcement back, so you can demonstrate approval without a public address. The Candidate is marked simulated. It needs:

- the receiver running in the same working directory;
- a registered endpoint for the Leader (the placeholder is enough).

### `teardown`

Deletes the Chains this demo created, after listing them and asking (`--yes` skips the question). Spaces and their Memories remain, because the server cannot delete Spaces. The state keeps their keys, so a later `init` reuses them.

## Receiving real deliveries

The server delivers webhooks only over HTTPS and refuses private destinations, so real deliveries need a public HTTPS address that forwards to the receiver:

1. `./bin/sharedmem-admin receiver serve` (note the port).
2. Start any tunnel tool that gives a public HTTPS address and forwards to that local port.
3. `./bin/sharedmem-admin webhook set --url <the tunnel's address> --test`.
4. Run `./bin/sharedmem-admin verify`: with a real address and the receiver running, the held-back Cases also check that the Candidate arrives.

If the receiver is down, the server keeps retrying for a little over two days; after the last attempt the announcement is gone. Setting up the tunnel is up to you and is outside this repository.

## Shipped content you can edit

Everything shipped is a plain file under `config/`:

| File | What it is |
| --- | --- |
| `cast.json` | The default cast |
| `routing-prompts/*.txt` | The three Routing prompts: what reaches Team Shared, what reaches Leadership Shared, and what is proposed to Team Shared in the Approval Example. See [Routing prompts](routing-prompts.md) |
| `cases.json` | The 12 Cases `verify` runs and the sample sentences handed to people |
| `seed-memories.json` | The pinned starting Memories in Team Shared and Leadership Shared |
| `sample-questions.json` | The question each person is asked to try, with what it should find |

- After editing a Routing prompt, run `init` to apply it and `verify` to check it ([how](routing-prompts.md#change-a-prompt)).
- Sample sentences are assigned by role and position, and wrap around for larger casts:
  - a Developer in position `i` gets the Cases `T` number `(i mod 4) + 1` and `N` number `(i mod 2) + 1`;
  - a Leader in position `j` gets the two `L` Cases starting at number `(2j mod 4) + 1` and `W` number `(j mod 2) + 1`.
