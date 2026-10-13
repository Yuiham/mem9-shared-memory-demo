# Troubleshooting

Every error the programs print ends with a `next:` line. This page covers the ones that need more than that line. For Participants, the Kit's README (the [Participant guide](participant-guide.md)) has its own short list.

## Administrator

### `SHAREDMEM_API_URL is not set`

There is no `.env` file in the working directory and the variable is not in your shell. Copy `.env.example` to `.env` and set the address of the mem9 server. If you use `--workdir`, the `.env` file must be in that directory (or set the variable in your shell).

### The state belongs to a different server address

The state records the server it was created for, and every command refuses to run against another. Point `SHAREDMEM_API_URL` back at that server, or give each server its own working directory with `--workdir`.

### The server did not accept a key

A Chain or Space key in the state is not known to the server. The usual causes:

- A state file from another server.
- A Chain deleted on the server. Running `init` creates it again on the same Spaces; its key changes, so run `export` again and hand out the new Kits.

### `Cannot reach the mem9 server`

Check the address and your network first. Then:

- A connection cut in the middle (`UND_ERR_SOCKET`, `ECONNRESET`) can also happen on a busy or distant server.
- Reads and deletions are retried twice on their own. A write is never repeated, because the server may have processed it: the command stops and you run it again.
- `verify` removes the test Memories of every Case it started, including the one being written when the connection was cut.
- A slow server is not an error. A few seconds per call is normal on a remote server, and `verify` takes about five minutes for twelve Cases.

### I lost the state file

The server cannot list or delete Spaces, so the state file is the only record of their keys.

1. Look for `state/state.json.bak` next to it: every write keeps the previous version there. Copy it back to `state.json`.
2. If both are gone, run `init` again. It creates new Spaces and Chains. The old ones stay on the server unused, and nothing can reach them without their keys.
3. Run `export` and hand out the new Kits. Kits that were already handed out keep pointing at the old Chains.

A `state` or `candidates` file that is not valid JSON is reported with the same advice. The programs never overwrite a file they cannot read.

### `verify` fails a Case

- **A Case reached too few spaces**: the Routing prompt did not match. Edit the prompt under `config/routing-prompts/`, run `init` to apply it, and verify again.
- **A Case reached too many spaces**: the prompt is too broad.
- **Routing varies between runs**: the model is not deterministic. Run the failing Case again; one flip is noise, a pattern is a prompt problem. A Leadership Case that missed Leadership Shared in one run passed in the next.
- **An Approval Case fails right after `init` or `webhook set`**: the server may take a few minutes to apply the change. Wait, then run `verify` again before editing a prompt.
- **The table shows a server error**: the line below the table names the status and the call.
- **A Case that should be personal never produced a Memory**: the server drops one-off remarks. Use a durable personal statement.

### A rejected webhook address

`webhook set` prints the server's reason.

- The server requires an HTTPS address without credentials, and refuses a literal private IP address such as `127.0.0.1` or `192.168.x.x`. A receiver on your own computer therefore needs a tunnel that gives it a public HTTPS address.
- Until you have one, register `https://receiver.invalid/`: it is accepted and can never deliver, which is enough for `verify` and `simulate`.

### The receiver does not receive anything

Start with `webhook deliveries`: it shows whether the server tried and the last error of each attempt (`pending` with an error means it will retry). Then check:

1. Is it running, in the same working directory? `state/receiver.json` exists while it runs.
2. Is the tunnel forwarding to the port the receiver printed?
3. Is the registered address the tunnel's public HTTPS address, and not the placeholder? Run `webhook set --url <address> --test` and watch the receiver's terminal for a test event.
4. A refusal line in the receiver's terminal names the reason:
   - a signature mismatch: the state does not hold the secret of the endpoint the server uses, so run `webhook set` again in this working directory;
   - a stale timestamp: this computer's clock is more than five minutes off;
   - an unknown Chain: the state belongs to another working directory.
5. The server's delivery attempts are retried for about two days, so a receiver that comes back may still get the announcement.

### `simulate` says the receiver is not running

Start it in another terminal with `receiver serve`, in the same working directory. A `state/receiver.json` left behind by a crashed receiver is recognized (its process is gone) and replaced by the next one.

### `verify` fails the held-back Cases in the Approval Example

- *no routed-fact delivery recorded*: the Routing prompt C did not match the announcement, or the Team Shared node of the Leader Chain is not webhook-only. Run `init --example approval` again.
- *the delivery was recorded but no Candidate arrived*: see the previous section; with a placeholder address the check is skipped on purpose.
- Add `--wait 30` if the server is slow to deliver.

### Port already in use

Pass `--port <number>`, or `--port 0` for any free port. The receiver prints the address it chose.

## Participant

### The agent answers without any shared knowledge

- **A Claude Code session that started outside the configured directory.**
  - The key is a project-local setting, so it reaches the plugin only when Claude Code starts in that project.
  - Started elsewhere, the plugin has no key and provisions a new, empty Space of its own.
  - Close the session, `cd` to the directory the program printed, and start `claude` there.
- Wait a minute after saying the sample sentences: plugin writes are asynchronous.
- Codex: restart it after the plugin was installed, and start it from the configured project directory.

### `claude was not found`, `codex was not found`, `git was not found`, `bash`, `curl`

The named command is not on your PATH. Install it and run the program again. Claude Code needs `claude`, `bash` and `curl`; Codex needs `codex` and `git`.

### `Node 22 or newer is required`

Run `node --version`. Install a current Node and run the program again.

### The settings file is not valid JSON

The program will not overwrite `.claude/settings.local.json` when it cannot read it. Fix or move the file and run the program again.

### A plugin command failed

The program stops with the command, its output and what to do next. Nothing after the failed step has run. Running the program again repeats the steps; it keeps existing settings and never duplicates them.

### Codex: the Agent ID step was skipped

The installed Codex plugin does not support an Agent ID yet, so your writes use the shared Agent ID `codex` (see [Known gaps](known-gaps.md)). Update the plugin and run the program again.
