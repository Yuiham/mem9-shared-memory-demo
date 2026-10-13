# Concepts

The ideas behind the demo, in the order you meet them.

## Space

A **Space** is a place on the mem9 server where Memories are stored.

- Each person has a **Personal space**.
- The demo adds two **Shared spaces**: **Team Shared** and **Leadership Shared**.
- The default cast therefore has eight Spaces: six Personal and two Shared.

The server issues each Space a **mem9 API key** when it is created. That key reads and writes that one Space. The server cannot list or delete Spaces, so the demo's local state file is the only record of them.

## Memory types

- **Pinned**: stored word for word, such as the Seed memories and approved announcements.
- **Insight**: a durable fact the server extracted from a conversation.
- **Session**: the raw conversation. The demo hides these unless asked.

Passing remarks, status updates and questions are never stored. Durable statements are (for example "I prefer short answers" or "we always run migrations before deploying").

## Chain

A **Chain** (a Space Chain) is an ordered list of Spaces seen as one.

- Position 0 is the **owner**. Writes through the Chain land there first, and the owner's Personal space is what the person owns.
- The other nodes are shared Spaces. The Chain can **read** them and, depending on the **Node mode**, receive routed copies of the person's facts.

Every person has their own Chain, named `sharedmem-demo-<name>`:

- A Developer's Chain: Personal space, then Team Shared.
- A Leader's Chain: Personal space, then Leadership Shared, then Team Shared.

Reading through a Chain merges what its Spaces hold, so a Developer sees their own Memories and the team's, while a Leader also sees Leadership Shared. Developers' Chains do not contain Leadership Shared, so they cannot read it.

## Two kinds of keys

| Key | Looks like | What it can do |
| --- | --- | --- |
| mem9 API key | a long hex string | Read and write one Space |
| Chain API key | starts with `chain_` | Read and write through every Space in the Chain, and manage the Chain (nodes, routing rules, webhooks, deletion) |

A person's Kit holds only their Chain API key. The Administrator holds every key in the state file. Keep both private.

## External space identifier

- Each shared node in a Chain has a fixed **external space identifier**: `team-shared` and `leadership-shared`.
- Routing refers to a node by that identifier. A node without one is ignored by routing.
- A node also has a display name (Team Shared, Leadership Shared), which the routing model sees next to the Routing prompt.

## Routing prompts and Node modes

After a person says something:

1. The server extracts durable facts into their Personal space.
2. For each other node of their Chain, a language model decides whether the fact belongs there. It reads the node's **Routing prompt**, a short instruction such as "send lasting engineering knowledge the whole team should follow", and judges by meaning, in English, Spanish or Portuguese.
3. What happens next depends on the node's **Node mode**, which the server stores as its routing rule:

| Node mode | Routing rule | What happens |
| --- | --- | --- |
| Auto | enabled, with a Routing prompt | Matching facts are copied into the node's Space |
| Approval | enabled, with a Routing prompt, **webhook-only** | Matching facts are not copied; the server sends a webhook delivery instead |
| Read-only | disabled | Nothing is routed into the node, but the Chain still reads it |

The demo uses three Routing prompts:

- **A**: Team Shared, auto.
- **B**: Leadership Shared, auto.
- **C**: Team Shared, approval.

Approval is a general Node mode and could apply to any node; the demo shows it only on the Team Shared node of Leader Chains.

Node modes govern routing only. A Chain API key can read, update and delete Memories in every Space of its Chain, so the real boundary is which Spaces a Chain contains (see [Known gaps](known-gaps.md)).

## Examples

The demo has one environment and two **Examples**. They differ in a single routing rule on the Leader Chains' Team Shared node:

- **Basic**: that node is read-only. Leaders read Team Shared, and nothing a Leader says reaches it automatically. Developers' facts reach Team Shared through their auto node.
- **Approval**: that node is approval (webhook-only). A Leader's team-wide announcement becomes a **Candidate** instead of a Memory.

You switch Examples by running `init` again with the other `--example`. Chains and keys do not change, so Kits already handed out keep working.

## Candidates, webhooks and the receiver

In the Approval Example, each fact the server holds back goes through three steps:

1. The server sends a **webhook delivery**: an HTTPS call signed with a per-endpoint secret.
2. A **receiver** (`receiver serve`) checks the signature and the timestamp, ignores duplicates, and stores the fact as a **Candidate**, attributed to the Leader whose Chain produced it.
3. The Administrator **approves** the Candidate, which writes its text word for word into Team Shared as a pinned Memory from that Leader, or **rejects** it.

`simulate` sends a correctly signed delivery to the local receiver, so the flow can be shown without a public address.

## Agent ID

Two different things name "who wrote this":

- The **Agent ID** (the `agent_id` field of a write) names the **person**. The demo uses the person's name. mem9 reconciles Memories within an Agent ID, which is why each person has their own.
- The request header `X-Mnemo-Agent-Id` names the **tool** (`codex`, `claude-code`). The server records it on the Memories it extracts, but nothing in the demo identifies a person by it.

## Seed memories, Cases and Samples

- **Seed memories** are a few pinned facts placed in Team Shared and Leadership Shared at `init`, so the sample questions have something to find.
- **Cases** are 12 sample sentences with where each should land in each Example. `verify` runs them against the real server to check the Routing prompts.
- **Sample sentences and a sample question** are what each person is asked to try. They are written into the person's Kit and printed by the Participant program.
