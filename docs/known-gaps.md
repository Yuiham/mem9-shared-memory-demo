# Known gaps

What the demo does not do, or cannot guarantee. Read this before showing it to anyone who will take it for a product.

## Access and security

1. **A webhook endpoint belongs to a Chain, not to one node.** In the Approval Example a Leader Chain's receiver also receives deliveries for facts auto-routed to Leadership Shared, including their text. The receiver acts only on deliveries that were held back (webhook-only).
2. **Node modes govern routing only.** A Chain API key can read, update and delete Memories in every Space its Chain contains. The real boundary is which Spaces a Chain contains, not its Node modes.
3. **Chain management uses the Chain API key**, the same key a person's plugin holds. A person could change the Routing prompts of their own Chain. There is no per-person authorization for Chain management.
4. **Keys live in plain local files.** The state, the Candidates and every Kit are owner-only files with no encryption. This is a demo, not production hardening.
5. **The server address may be plain HTTP**, so only fictional data is used.

## Approval and webhooks

6. **Announcements are silently lost when no webhook is registered** in the Approval Example. `init` warns about it. When the receiver is unreachable the server keeps retrying (up to eight attempts over a little more than two days, and only a 2xx answer counts), so a receiver that comes back in time still gets them; after the last attempt they are gone.
7. **Delivery records omit event content and the node a delivery was for.** Only a receiver sees the content. Without a receiver, `verify` can only check that some delivery was recorded after the write.
8. **The server delivers webhooks only over HTTPS and refuses private destinations**, so real deliveries need a tunnel. A placeholder address registers fine but never delivers. Setting up a tunnel is outside this repository.
9. **A delivery record cannot be attributed to a single Case.** The server's records omit the content, so `verify` counts records that appeared after a Case's write. A late record of one Case can be counted for the next one, so an Approval Case may pass because of its predecessor. Read an Approval result together with the Candidates list.
10. **Two `candidates approve` of the same Candidate at the same time can write the Memory twice.** The program tells when it loses the race; delete the extra Memory with the Memory list of the Space if that happens. One person approving one Candidate at a time is the supported use.
11. **A receiver that was killed (not stopped with Ctrl+C) leaves `state/receiver.json` behind.** The next start checks that the recorded process is alive and replaces the file; if the number was reused by an unrelated process, delete the file by hand.

## Routing and reading

12. **Routing is judged by a language model and can vary between runs.** The Cases are a spot check, not a guarantee.
13. **Transient statements are never stored or routed**: status updates, one-off events and questions. Only durable statements count.
14. **A Chain search can stop at the first node whose best match is confident enough**, so a question that closely matches a person's own Memory may not reach the shared spaces.
15. **Plugin writes are asynchronous.** Routed copies appear after roughly a minute.

## Plugins

16. **A Codex plugin that predates the configurable Agent ID makes every Codex user write under the same Agent ID (`codex`)**, and near-duplicate facts from different people can merge or overwrite each other. Codex plugin 0.2.7 supports the setting (checked on a real install). The Participant program applies it when the installed plugin supports it and otherwise skips that step with a notice.
17. **The Claude Code plugin provisions a new, empty Space by itself when it starts without a key**, so it must be started from the configured project directory.
18. **Installing the Codex plugin changes the person's user-level Codex hook files** and stores the Chain's key in a user-level credentials file (`$MEM9_HOME/.credentials.json`, default `~/.mem9/`). The plugin creates that file readable by other users of the computer, so the Participant program restricts it to its owner. Only the project override is project-local.
19. **The Claude Code settings file holds the Chain key.** `.claude/settings.local.json` in the project is made owner-only, but the program does not touch the project's `.gitignore`. Check that the file is ignored before committing a project that was set up.
20. **The automated tests do not cover real agent sessions or real HTTPS deliveries.** Installing and configuring the real Claude Code and Codex plugins was checked by hand in a disposable Linux environment, not by the test suite. The key reaching a running agent session (for Claude Code through the settings environment) and a delivery through a public tunnel are for you to try with the Try it steps. The terminal paths (pressing arrow keys, answering a prompt) are untested too.

## Server and local state

21. **The server cannot list or delete Spaces.** The local state is the only record, and Spaces remain after `teardown`. Losing the state means the next `init` creates new Spaces and Chains, and the old ones stay on the server unused.
22. **A change may take a few minutes to show on the server.** In one run, right after switching to the Approval Example and registering a webhook, `verify` found no routed-fact delivery for the two announcement Cases for about three minutes; about six minutes after the switch both passed. The cause was not established. If `verify` fails right after `init` or `webhook set`, wait a few minutes and run it again before changing a prompt.
23. **The demo does not change the server or the plugins**, and it does not support Windows, graphical interfaces or languages other than English in its documentation.
