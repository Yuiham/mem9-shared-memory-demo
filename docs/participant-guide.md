# Shared memory demo: your Kit

This Kit connects your coding agent (Claude Code or Codex) to your own shared-memory Chain, so you can see what your agent shares with your team and what stays private.

**This folder is a secret.** The file `person.json` holds your chain API key. Do not post it, commit it or forward it. Anyone who has it can read and write what your Chain can reach.

## Before you start

1. Run `node --version`. You need Node 22 or newer.
2. Have your coding agent installed:
   - Claude Code: needs `claude`, `bash` and `curl` on your PATH.
   - Codex: needs `codex` and `git` on your PATH.
3. Pick a project directory to try this in. A scratch directory is fine.
   - The demo changes only that directory and, for Codex, your user-level mem9 and Codex folders.
   - The program lists every change before it starts.

All data in this demo is fictional. Do not type anything real.

## Set up

From this folder, run:

```
./bin/sharedmem-participant
```

If that does not start, run `node bin/sharedmem-participant` instead.

The program:

- asks which agent you use (arrow keys and Enter) and which directory to configure;
- shows what it is about to do;
- waits for your yes. Nothing changes before that.

For no questions at all:

```
./bin/sharedmem-participant --agent claude --dir /path/to/project --yes
```

Use `--agent codex` for Codex. Without a terminal the program never asks: it tells you which option to pass.

What it does:

- Claude Code: adds the mem9 marketplace, installs the plugin for that project only, and writes your server address, key and name into `.claude/settings.local.json` in the project (owner-only, merged with any settings already there).
- Codex: makes sure the directory is inside a Git repository (it asks before running `git init`), adds the marketplace and the plugin, saves a named profile with your key, and applies it to the project. Setting up the plugin also repairs your user-level Codex hook files.

It never starts your agent. When it finishes it prints:

- the directory to enter and the command to run (open a new terminal window for that);
- your sample sentences, a sample question and what the answer should contain.

Two things to remember:

- Codex must be restarted after the plugin is installed.
- Always start your agent from the configured directory. If the plugin starts without your key, it creates a new, empty space of its own instead of using your Chain.

## Try it

1. Start your agent in the configured directory.
2. Say your sample sentences, one at a time, in a normal chat.
3. Ask the sample question.
   - Memories are saved in the background, so shared ones appear after about a minute.
   - If the answer is missing, wait a minute and ask again.

What to expect:

- Lasting knowledge you state, such as a team rule, is saved to your Personal space and routed to the shared spaces your Chain reaches.
- Chatter and one-off remarks are ignored.
- Developers cannot read Leadership Shared. A question that needs it finds nothing. That is the point.
- Approval Example (Leaders): an announcement meant for the whole team is only proposed to Team Shared. It appears there after the Administrator approves it.

Your name is your Agent ID, so what you say is recorded as yours.

## Running it again

The program is safe to run again: it repeats the same steps, keeps your other settings and prints this guidance again. Run it again if the Administrator hands you a new Kit.

## If something goes wrong

- `Node 22 or newer is required`: install a current Node.
- `claude was not found` or `codex was not found`: install the agent, then run the program again.
- `... is not valid JSON` for `.claude/settings.local.json`: the program refuses to overwrite a file it cannot read. Fix or move the file, then run it again.
- The agent answers without any shared knowledge: check that you started it from the configured directory, wait a minute after saying the sentences, and ask again.

If it still does not work, send the Administrator the text the program printed. It masks your key and the server address.
