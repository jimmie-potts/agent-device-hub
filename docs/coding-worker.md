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
search, build and test tools, the dispatch's turn cap, dollar budget and wall
clock, and an appended instruction never to push, open a PR, change settings
or leave the worktree. The harness returns a structured result (outcome,
summary, checks, findings, limitations); the worker adds the base and head
revisions and changed files it reads from git itself, the harness session
identity, and usage or unknown. A refused repository, a failed worktree, a
harness exit, a timeout, cancellation or unreadable output is reported with
its reason. The worktree stays for the owner's inspection; its path never
enters a message. Pushing or opening a PR is a later explicit approval, not
part of this slice.

## Install once

1. Grant the credential. Add one entry with the `coding-worker` role to the
   installation's private `edge-credentials/1.0` file, bound to the source
   `bunny/parts/coding-worker` with no scopes; the digest is the SHA-256 of a
   token you generate and keep in an owner-only file. The runtime reads the
   credentials file at start and on reload. Any other source, a scope, or a
   robot ID on that role refuses the file.
2. Write the private configuration, mode 600, outside every checkout:

   ```json
   {"schema": "coding-worker/1.0", "edge": "http://127.0.0.1:18788", "tokenFile": "/absolute/private/coding-worker.token",
    "repositories": [{"name": "agent-device-hub", "path": "/absolute/path/to/checkout"}],
    "claude": {"executable": "/opt/homebrew/bin/claude", "permissionMode": "acceptEdits"}}
   ```

   `claude.allowedTools` defaults to `Read`, `Edit`, `Write`, `Glob`, `Grep`
   and `Bash` limited to `npm run`, `npm test`, `npx tsc`, `node --test`,
   `git status`, `git diff` and `git log`; a list that names push, network or
   destructive tools refuses. `claude.model` and `claude.maxTurns` are
   optional. Repository names are lowercase words joined by hyphens, dots or
   underscores and must match what the owner says to B.U.N.N.Y.
3. Start it after sign-in from the reviewed release:

   ```sh
   node /absolute/release/apps/runtime/bin/coding-worker.mjs /absolute/private/coding-worker.json
   ```

   A launchd user agent may run that command after login; the worker exits
   on SIGTERM and declares its endpoint off. It reconnects a lost stream on
   its own, but a lost endpoint ends the running task uncertain and the task
   says so; the worker never resends.

## Use it

On the Conversation page, ask B.U.N.N.Y. to delegate a task, naming the
repository. The model proposes a delegation showing the repository, the brief
and the coding worker revision it is bound to; approve it. The core tracks the
hand-off as one operation that completes when the worker reports it started;
the page then shows the delegated work waiting, with Cancel task asking the
worker to stop. The worker's result arrives as the tool's result and the next
reply reports it. Only one task runs at a time; a second proposal is refused
until the first ends.

Source tests cover the worker over a fake harness and a fake edge; running it
against the installed core with a real `claude` is the installed check the
owner records under the running checklist.
