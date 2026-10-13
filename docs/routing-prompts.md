# Routing prompts

How routing works in short:

1. A person says something lasting, and mem9 saves the fact in their Personal space.
2. For each shared space in their Chain, a language model answers one question: does this fact belong there? The **routing prompt** of that space is the question.
3. In this demo the prompts are three plain-text files, so changing what reaches Team Shared or Leadership Shared means editing one of them.

A prompt only decides what is copied into a shared space. Who can read a space is decided by the Chain: a Developer's Chain has no Leadership Shared, so no prompt can send a Developer anything from it. The idea behind Node modes and routing is in [Concepts](concepts.md#routing-prompts-and-node-modes).

## The three prompts

| File | Applies to | What it does |
| --- | --- | --- |
| `config/routing-prompts/team-shared-auto.txt` | The Team Shared node of every Developer's Chain | A matching fact is copied into Team Shared |
| `config/routing-prompts/leadership-shared-auto.txt` | The Leadership Shared node of every Leader's Chain | A matching fact is copied into Leadership Shared |
| `config/routing-prompts/team-shared-approval.txt` | The Team Shared node of every Leader's Chain, in the Approval Example only | A matching fact is held back and announced to the receiver as a Candidate for the Administrator to approve |

In the Basic Example the Team Shared node of a Leader's Chain is read-only and uses no prompt, so nothing a Leader says reaches Team Shared by itself.

## Change a prompt

1. Edit the file. A prompt is plain text of at most 1,200 characters. `init` checks all three files before it sends anything and refuses an empty file or a longer one.
2. Run `./bin/sharedmem-admin init`. It compares each node on the server with the files and sends only what differs. Chains, keys and Kits stay the same, so Kits already handed out keep working.
3. Run `./bin/sharedmem-admin verify` and read the table of expected against actual.
4. Repeat until the Cases pass.

Good to know:

- A new prompt applies to what people say from then on. Memories already saved stay where they are.
- A change can take a few minutes to show on the server (see [Known gaps](known-gaps.md)).

## Write a good prompt

The shipped prompts are about 400 characters each. They follow a pattern worth keeping:

- Say what belongs, by kinds of fact: "durable engineering knowledge the whole team should keep: coding or ops conventions, how-to steps for shared systems, and lessons from incidents".
- Say what stays out, and name the topics of the neighboring space. The Team Shared prompt leaves out budget, hiring, reviews and strategy; the Leadership Shared prompt leaves out engineering conventions and announcements for everyone. Each prompt excludes what the other one takes.
- Ask the model to judge by meaning, not by wording. The shipped prompts do, so a sentence in another language is routed the same way; Spanish and Portuguese worked in a spot check, and `verify --cases <file>` tries your own.
- Name what is not durable. The shipped prompts exclude personal preferences and one-off status, so a passing remark is not copied into a shared space.

## How `verify` checks a prompt

`config/cases.json` holds 12 Cases. Each has a sentence, the role of the speaker and where it should land in each Example. They fall into four groups:

- **T**: team knowledge a Developer states. It belongs in Team Shared.
- **L**: private matters a Leader states. They belong in Leadership Shared.
- **W**: team-wide announcements a Leader makes. Basic keeps them in the Leader's Personal space; Approval proposes them to Team Shared.
- **N**: personal preferences. They stay in the Personal space.

`export` also hands these sentences to people: the Cases whose ids are a letter and a number (T1, L2, W1, N1) are picked by role and position. To try your own sentences once, run `verify --cases <file>` with a file of the same shape. The file is checked completely before anything is sent.

A language model makes the decision, so one run can differ from the next:

- When a Case fails, run `verify` once more before you change a prompt.
- The Cases are a spot check, not a guarantee.
