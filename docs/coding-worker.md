# Run the coding worker on the Mac

The coding worker (Hub #502) is one Node process on the owner's computer that
lets B.U.N.N.Y. hand a bounded coding task to Claude Code and get a reviewable
result back. It holds a `coding-worker` credential, opens one endpoint on the
core's loopback gateway, and runs `claude -p` in a fresh worktree of an
allowlisted repository when the companions module hands it owner-approved
work. The container gets no CLI and no repository; the worker gets no state,
device or dashboard authority. Its credential role grants exactly three
families on its endpoint: it answers `coding-work`, publishes `coding-progress`
and declares `coding-endpoint`.

## What a delegated task may do

The worker creates `.local/worktrees/bunny-<task>-<random>` under the
repository from `origin/main` (after a best-effort `git fetch`), runs the
harness there with `--permission-mode acceptEdits`, a tool allowlist of file,
search, build and test tools, the dispatch's turn cap (a private `maxTurns`
can only lower it), dollar budget and wall clock, and an appended instruction
never to push, open a PR, change settings or leave the worktree. The brief is
the harness's standard input, never an argument. Every run also carries a
fixed deny list the harness enforces over any allow, including the owner's
own Claude Code settings: `git push`, `git -C`, `git --git-dir`,
`git --work-tree`, `git remote`, `git worktree`, `git config`, `gh`, a nested
`claude`, `curl`, `wget`, `ssh`, `scp`, `sudo`,
edits under `.claude/` or `~/.claude/`, `WebFetch` and `WebSearch`. Only the
repository's own settings load (`--setting-sources project`) and no MCP
server (`--strict-mcp-config`). A refusal the harness makes is not seen by
the worker; it surfaces only if the model lists it under findings, so the
deny list is what makes those actions impossible rather than reported.
Edits stay in the worktree by the harness's own working-directory rule for
`acceptEdits`, which the installed check observes with a real run. The
harness returns a structured result (outcome,
summary, checks, findings, limitations); the worker adds the base and head
revisions and changed files it reads from git itself, the harness session
identity, and usage or unknown. A refused repository, a failed worktree, a
harness exit, a timeout, cancellation or unreadable output is reported with
its reason. The worktree stays for the owner's inspection; its path never
enters a message. Pushing or opening a PR is a later explicit approval, not
part of this slice.

The worker reads the run as a stream (`--output-format stream-json
--verbose`) as it arrives, so it sees the tool's limit events as well as the
final result (Hub #1743). Two outcomes come from that:

- `usage-limit`: the tool reported that a usage limit stopped the run, either
  as a `rate_limit_event` with status `rejected` or as a message typed
  `usage_limit_reached`, and the run did not end with a structured result.
  The task ends failed with reason `usage-limit` and the limit's window and
  reset time, or `unknown` where the tool gave none. A generic rate-limit error
  is an ordinary failure. Nothing is retried at the reset.
- `waiting-for-owner`: the run stopped at a choice the brief left open. It
  completes with that outcome and the question first among the findings.

The harness and the readiness probes below start without provider
credentials or provider switches: every `ANTHROPIC_` variable (including
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`), the
`CLAUDE_CODE_USE_` switches (Bedrock, Vertex, Foundry and the others),
`CLAUDE_CODE_OAUTH_` tokens, `CLAUDE_CODE_API_KEY_` helpers and
`AWS_BEARER_TOKEN_BEDROCK`, besides the worker's own `BUNNY_` variables. The
owner's subscription sign-in is what the tool then uses. A repository setting
can still name an API key helper; if the tool reports an API key source, the
result says so under limitations.

## Readiness

Before it connects, the worker asks its tool what it is, without starting a
task or a session and without spending: `claude --version` and
`claude auth status --json`, each with no input, the harness's environment and
a ten-second deadline. Its declaration (`coding-endpoint/2.1`) carries the
record, and the companions module publishes it in the coding state
(`coding-state/2.1`):

| Field | Value |
| --- | --- |
| `installed` | `yes`, `no` when the executable is missing, `unknown` otherwise |
| `version` | the version the tool printed, or null |
| `signedIn` | `yes` or `no` from the tool's status, `unknown` when it did not say |
| `plan` | the tool's subscription type while signed in, or null |
| `limits` | the windows (such as `five-hour`, `seven-day`) the latest run reported, with status, reset time and use, or null before any run |

Only the sign-in state and plan are read from the status; the account,
organization, e-mail address and directories are not. The tool reports limit
windows only during a run, so after a run that reported them the worker
probes again and sends one more enable from its endpoint with the new record.
That enable is a report: if it is refused or lost, nothing is sent again. A
disabled or lost endpoint clears the record.

## Install once

1. Grant the credential. Add one entry with the `coding-worker` role to the
   installation's private `edge-credentials/1.0` file, bound to the source
   `bunny/parts/coding-worker` with no scopes; the digest is the SHA-256 of a
   token you generate and keep in an owner-only file. The runtime reads the
   credentials file at start and on reload. Any other source, a scope, or a
   robot ID on that role refuses the file. The Mac container admits this role
   on its private-proxy and production profiles; its host-local profile, and
   images from before Hub #1350, refuse the whole file, so grant it only on an
   image that admits it. On the running Mac core, follow
   [Grant a credential to the running core](bunny-container.md#grant-a-credential-to-the-running-core),
   which checks the file before it is reloaded.
2. List `delegate_coding` in the companions section's `assistant.tools` of the
   private `runtime.json` (see the [module guide](../modules/companions/README.md)):
   the model is offered only the listed tools, so without it nothing is ever
   proposed. This is a configuration change the stopped-window procedure writes.
3. Write the private configuration, mode 600, outside every checkout:

   ```json
   {"schema": "coding-worker/1.0", "edge": "http://127.0.0.1:18788", "tokenFile": "/absolute/private/coding-worker.token",
    "repositories": [{"name": "agent-device-hub", "path": "/absolute/path/to/checkout"}],
    "claude": {"executable": "/opt/homebrew/bin/claude", "permissionMode": "acceptEdits"}}
   ```

   The token file follows the runtime's private-file rules (owner-only, one
   link, no link along its path, outside every checkout); on macOS the check
   that the opened file is the named one uses the path's directory chain and
   the file's device and inode, since there is no procfs (Hub #1355).

   `claude.allowedTools` defaults to `Read`, `Edit`, `Write`, `Glob`, `Grep`
   and `Bash` limited to `npm run`, `npm test`, `npx tsc`, `node --test`,
   `git status`, `git diff` and `git log`; a list that names push, network or
   destructive tools refuses. `claude.model` and `claude.maxTurns` are
   optional. Repository names are lowercase words joined by hyphens, dots or
   underscores and must match what the owner says to B.U.N.N.Y.
4. Start it after sign-in from the reviewed release:

   ```sh
   node /absolute/release/apps/runtime/bin/coding-worker.mjs /absolute/private/coding-worker.json
   ```

   A launchd user agent may run that command after login, with `KeepAlive`
   so a crash or a sign-out restarts it; the worker exits on SIGTERM and
   declares its endpoint off. After a lost stream it reconnects on its own
   and declares a fresh endpoint, trying again with backoff while the core
   still names the old one, which the core then shows as the new worker; the
   task that was running is ended uncertain and the task says so, and the
   worker never resends.

## One credential, one endpoint

Run one worker at a time. The core selects one worker endpoint and refuses
another while that endpoint is selected, so stop the old worker before you
start a new one. That includes handing over to launchd: stop a worker you
started by hand before loading the agent.

A second worker started while the first is still declared connects, opens its
own endpoint and has its `enable` refused with `invalid-state`. It closes that
endpoint and its connection, writes the line below to standard error and exits
with status 1, at once when refused and within about eleven seconds if the core
stops answering. The worker that holds the endpoint keeps it and keeps running
its task. The refused process does not ask again; only a fresh process declares.
Under launchd, `KeepAlive` starts that fresh process at launchd's own restart
interval, so until the old owner has released the endpoint each new process is
refused and exits the same way. The first start after the release declares.
Without a supervisor, start it again by hand.

The old owner releases the endpoint when it stops on SIGTERM, which declares it
off, or when it dies and the gateway reports its connection lost.

| First start ends with | What it means | Effect at the core |
| --- | --- | --- |
| `coding-worker-enable-refused: <code> trace <id> request <id>` | The core refused the declaration; `invalid-state` means another endpoint is selected | None |
| `coding-worker-enable-uncertain: uncertain-result trace <id> request <id>` | No answer arrived: the core went silent or the stream was lost | The core may have selected this endpoint; the worker's closed connection releases it |
| `coding-worker-endpoint-refused: <code>` | The endpoint could not be registered, as when the connection has no endpoint grant | None; no declaration was sent |
| `coding-worker failed: SdkError` | The worker never connected: the core could not be reached or refused the token | None |

Each of these exits with status 1. The trace and request IDs name the
declaration's command, so you can find it in the runtime's diagnostic records.
The trace ID is there only when the command was sent: if the worker's own
endpoint closed before it could send the declaration, the uncertain line names
the request alone.
Losing the stream after the first declaration is different: the running worker
keeps its process, reconnects and declares again with backoff, as above.

## Use it

On the Conversation page, ask B.U.N.N.Y. to delegate a task, naming the
repository. The model proposes a delegation showing the repository, the brief
and the coding worker revision it is bound to; approve it. The core tracks the
hand-off as one operation that completes when the worker reports it started;
the page then shows the delegated work waiting, with Cancel task asking the
worker to stop. The worker's result arrives as the tool's later word (the
model reads it as text naming the call) and the next reply reports it. Only
one task runs at a time; a second proposal is refused
until the first ends.

Source tests cover the worker over a fake harness and a fake edge, and its real
entry point as a child process over the SDK's edge with a fake core. They also
replay recordings of real headless runs and status commands through the real
parsing code (`apps/runtime/tests/fixtures/claude-stream/recorded-*`), recorded
with synthetic prompts in an empty directory and scrubbed of identifiers,
paths and account values. A real usage limit cannot be provoked, so the
`constructed-*` limit fixtures follow the event shapes the tool documents and
are not recordings. Running it
against the installed core with a real `claude` is the installed check the
owner records under the running checklist. The handoff between two supervised
workers, and the interval launchd actually takes, is an installed check on
[#508](https://github.com/jimmie-potts/agent-device-hub/issues/508).
