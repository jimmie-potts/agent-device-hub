# Run the coding worker on the Mac

The coding worker (Hub #502) is one Node process on the owner's computer that
lets B.U.N.N.Y. hand a bounded coding task to Claude Code or Codex and get a
reviewable result back. It holds a `coding-worker` credential, opens one endpoint on the
core's loopback gateway, and starts the selected adapter in a fresh worktree
of an allowlisted repository when the companions module hands it owner-approved
work. The container gets no CLI and no repository; the worker gets no state,
device or dashboard authority. Its credential role grants exactly three
families on its endpoint: it answers `coding-work`, publishes `coding-progress`
and declares `coding-endpoint`.

Workers configured with `coding-worker/1.2` declare uncapped admission.
Companions can submit independent jobs regardless of which companion already
has work running. The worker uses a fresh worktree for each attempt and
serializes conflicting Git setup on the same underlying repository, including
linked worktrees. A cancelled attempt waiting for that lock skips setup when
its turn comes. Finite worker declarations keep their original slot behavior.

Approved uncapped jobs wait durably until their start can be delivered. The Hub
paces the tracked dispatch and the worker's acknowledgement as one exchange.
Acknowledgement frees the next delivery while the earlier job keeps running.
When a worker disconnects or is disabled, the Hub drops starts assigned to
that connection. A start the Hub had not sent ends with a definite failure.
If the start may have reached the worker, the outcome stays uncertain. The Hub
does not resend either start. Unassigned jobs keep their place for the next
worker connection.

An uncapped worker reports whether an attempt is waiting for Git setup,
preparing its worktree or ready to run the harness. A waiting report renews
only the wait deadline. Once setup starts, the attempt has its own setup
deadline. A ready worktree starts the harness deadline. A spawn failure
ends that attempt and leaves its siblings running. The worker reports usage
limits only when the harness supplies that evidence.

Open **Details**, then **Coding jobs**, to find active jobs and stop a named
attempt. **Next jobs** reads later jobs without affecting admission.

## Claude Code delegation

For each run the worker creates `.local/worktrees/bunny-<task>-<random>` under the
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
  is an ordinary failure. The run's own later stop wins: a budget stop after a
  limit event is `budget`, and a turn-cap stop is an ordinary failure, not a
  limit. Nothing is retried at the reset.
- `waiting-for-owner`: the run stopped at a choice the brief left open. It
  completes with that outcome and the question first among the findings.

The `usage-limit` path is tested against streams constructed from the event
shapes the tool documents, not against a recording of a real limit, which
cannot be provoked on purpose. When a real limit stream first occurs, record
it privately, scrub it as the other recordings were, and replace the
constructed fixture with it.

### Subscription sign-in only

Workers use the owner's subscription sign-in; provider API keys are for the
supervisor only. Three checks hold that line.

**The harness environment is an allowlist.** The harness and its readiness
probes inherit only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`,
`LANG`, `LANGUAGE`, `LC_*`, `TERM`, `TZ` and `CLAUDE_CODE_OAUTH_TOKEN`, plus
any names the private configuration lists in `claude.environment`.
`CLAUDE_CODE_OAUTH_TOKEN` is kept because it is a subscription sign-in (the
long-lived token `claude setup-token` makes, for a host without a keychain
sign-in), not an API key. A denylist then removes, even from configured names:

- every `ANTHROPIC_` variable: API keys, auth tokens, base URLs, custom
  headers and provider settings, and also the model names such as
  `ANTHROPIC_MODEL`, which are not credentials but which the worker
  configuration's `claude.model` sets instead;
- the `CLAUDE_CODE_USE_` provider switches (Bedrock, Vertex, Foundry and the
  others);
- `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` and `CLAUDE_CODE_OAUTH_SCOPES`, which only
  an interactive login reads;
- `CLAUDE_CODE_API_KEY_*`, `CLAUDE_CODE_CLIENT_*`, `CLAUDE_CODE_CERT_STORE`,
  `CLAUDE_CODE_SKIP_*`, `CLAUDE_CODE_PROVIDER_*` (the host-managed provider
  switch) and `CLAUDE_CONFIG_DIR`, which selects another account's
  configuration;
- cloud credentials (`AWS_*`, `GOOGLE_*`, `GCLOUD_*`, `CLOUDSDK_*`,
  `CLOUD_ML_REGION`, `VERTEX_REGION_*`, `AZURE_*`);
- proxies and certificates (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`,
  `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_*`, `SSL_CERT_*`) and
  `NODE_OPTIONS`;
- the worker's own `BUNNY_` variables.

A configuration whose `claude.environment` lists any of these refuses to load,
and the harness filter applies the same rule:

- a denied name;
- a name with the whole word key, token, secret, password, credential, base
  URL, `PAT`, private key, `APIKEY` or auth;
- the SSH agent socket or the SSH and git askpass, ssh and config helper
  variables;
- a dynamic-loader variable.

The list is written by the owner. The name rule guards against mistakes; it is
not a security boundary. It cannot recognize a name that has none of those
words, such as `OPENAI_KEY` or `MY_PASSPHRASE`.

**Project settings are checked before the tool starts.** The run loads the
worktree's project settings (`.claude/settings.json`, and
`.claude/settings.local.json` if one is present). Their `env` block or a
credential helper could undo the environment above. The worker reads them as
data and executes nothing in them. It refuses the run, as failed with reason
`refused` and the setting's name in the summary, before the tool starts and
before anything is spent, when they:

- set a credential helper (`apiKeyHelper`, `awsAuthRefresh`,
  `awsCredentialExport` or `gcpAuthRefresh`);
- set in `env` a denied variable or one named like a key, token, secret,
  password, credential or base URL;
- are not a JSON object.

The run also passes `--settings`, which the tool ranks above project
settings, with the `CLAUDE_CODE_USE_` provider switches set empty. The tool's
documentation counts an empty value as unset for provider selection.

**The first event names the credential.** The stream's first event reports
the tool's API key source. Anything but `none` stops the run at that event,
as failed with reason `refused`. The tool writes that event at about the
moment it sends its first request, so the request already in flight may be
spent on the key; nothing after it is. The check fails closed. The run is
stopped in the same way when an assistant or result event arrives before any
readable key source. That happens when the first event was over the line
bound, malformed, or named its source as something other than a string. A
result whose per-model usage names a provider other than `firstParty` gets a
limitation saying so.

**What the settings check does not cover.** It checks the project settings
once, before the start. After the run, the worker reads the two settings files
again and compares them with what it read before. A file the run created,
changed or removed gets a limitation, without quoting it. This covers files
the repository ignores. Git's changed paths add a limitation for anything else
under `.claude/`. That covers either side of a rename, quoted paths and any
letter case, since a case-insensitive volume treats `.CLAUDE/` as the same
directory. The check does not look at
hooks, the telemetry headers helper (`otelHeadersHelper`), status-line
commands or enabled plugins. None of these can change who is billed.
Repository hooks have been able to run commands with the owner's rights since
the worker was first built (#502); this change leaves that as it was.

**Not yet seen on a real host.** No host signed in only by
`CLAUDE_CODE_OAUTH_TOKEN` exists yet. Until one does, two things are
unverified. The first is whether its status reports `authMethod` `claude.ai`
with `firstParty`; if it does not, readiness reads `unknown` while runs still
work. The second is whether its first event reports the key source `none`; if
it does not, every run there is refused at its first event. The installed
acceptance should also confirm that the checks the repository documents still
run under the narrowed environment: a variable a check needs beyond the
allowlist must be listed in `claude.environment`, and proxy variables cannot
be listed.

## Readiness

Workers declare each configured adapter through `coding-endpoint/2.4`
with `coding-worker/1.2`, or through `coding-endpoint/2.3` with
`coding-worker/1.1`. The core includes those declarations and active
session IDs in coding state. The existing readiness field still describes Claude
Code.

Before it connects, the worker asks its tool what it is, without starting a
task or a session and without spending: `claude --version` and
`claude auth status --json`. Each runs with no input, the harness's
environment, the first allowlisted repository as its working directory and a
ten-second deadline, after which the probe is killed outright. Its
declaration (`coding-endpoint/2.2`, which also declares its slots) carries the
record, and the companions module publishes it in the coding state
(`coding-state/2.2`, which also lists every active run and the hand-offs waiting
for a slot):

| Field | Value |
| --- | --- |
| `installed` | `yes`, `no` when the executable is missing, `unknown` otherwise |
| `version` | the version the tool printed, or null |
| `signedIn` | `yes` only for the subscription sign-in (`authMethod` `claude.ai` and `apiProvider` `firstParty`); `no` when the tool says it is signed out; `unknown` for any other sign-in or no answer |
| `plan` | the tool's subscription type when `signedIn` is `yes`, or null |
| `limits` | the windows (such as `five-hour`, `seven-day`) the latest run reported, with status, reset time and use, or null before any run |

Only the sign-in state, the sign-in method, the provider and the plan are read
from the status; the account, organization, e-mail address and directories
are not. One difference from the run remains: the status command takes no
setting-source option, so it loads the owner's user settings, while the run
loads only the worktree's project settings. A provider chosen in user settings
therefore shows as `unknown`, and the run itself is still held to the checks
above. The tool reports limit
windows only during a run, so after a run that reported them the worker
probes again and sends one more enable from its endpoint with the new record.
That enable is a report: if it is refused or lost, nothing is sent again. A
disabled or lost endpoint clears the record.

## Codex delegation

Use the Codex worker on your own unmanaged Mac with a personal ChatGPT
workspace. Managed Macs and organization-managed workspaces are unsupported.
Disable the Codex worker if either becomes managed, pending review of the
new setup. This is a setup decision. Jobs can run without asking again.
The worker checks the reported sign-in and settings before sending a brief.

Use `coding-worker/1.2` and add a `codex` object with absolute `executable`
and `home` paths and, optionally, a `model` name. Select the local CLI in
the worker configuration and give it a separate mode-700 directory outside
every checkout. Standalone Codex 0.163.0 supports the app-server checks in
a signed-out profile. Use a CLI that confirms the required effective settings,
account mode and thread scope. Upgrade the core first so it accepts
`coding-endpoint/2.4`. Existing Claude-only configuration and requests without
a harness selection continue to use Claude Code.

As the worker's host user, create that directory and sign in to ChatGPT in
the dedicated profile. Use the same absolute directory for `codex.home`
and preserve it for the native sessions it stores.

```sh
worker_codex_home="$HOME/.local/share/bunny/coding-worker/codex"
install -d -m 700 "$worker_codex_home"
CODEX_HOME="$worker_codex_home" HOME="$worker_codex_home" /ABSOLUTE/REVIEWED/codex \
  -c 'cli_auth_credentials_store="file"' -c 'forced_login_method="chatgpt"' login
```

Keep this profile free of `config.toml` and a nested `.codex` directory.
Use the dedicated ChatGPT login and keep personal credentials in their own profile.
The worker launches the private stdio app-server from that directory with
both `HOME` and `CODEX_HOME` set to it. It pins the SQLite files and logs to
the profile's `sqlite` and `log` directories in the launch arguments.
The process can open its local stores during startup. The worker checks the
effective configuration before reading the account or opening a thread.
A reported path or route override, enabled telemetry, configured MCP servers
or plugins, enabled hooks, apps, shell snapshots or login shells, or unavailable
settings evidence prevents a brief from being sent. The worker checks
the personal ChatGPT account before opening a thread and again before sending
a turn. An organization plan reported by the account or quota snapshot,
or a report of a different backend, also refuses the run. Each run reads the
current quota snapshot after checking the account and waits up to two seconds.
Quota can be unavailable.
After the adapter observes an organization quota, it requires a fresh personal
account and matching quota plan before another run. An older probe cannot
release that refusal. The effective settings and account checks do not attest
that a host or workspace is unmanaged.
Sign-in, plan and limit responses contribute only the declared readiness
fields. The child receives no worker credential or provider API key. Codex
owns its file-backed sign-in in the dedicated profile. The worker reads no
authentication token.

The run uses a fresh worktree, no interactive approvals and a profile with
writes restricted to the worktree and disabled shell network access. The shared wall-clock
deadline stops the process. Codex sends one model turn and supplies no
per-turn dollar cap or subscription cost. Only declared subscription-plan
exhaustion is a usage limit. Provider slowdown is an ordinary failure, and
loss after dispatch is uncertain. There is no automatic retry.

| Worker capability | Claude Code | Codex |
| --- | --- | --- |
| Subscription evidence | Preflight rejects contrary evidence. Stream init names the credential source. | Account must identify a ChatGPT sign-in before the turn. |
| Usage limits | Windows observed during a run, or unknown | Account windows when reported, or unknown |
| Cancellation | The worker terminates the child | The worker terminates the app-server process group |
| Native identity | First validated session ID in the stream | Validated thread ID before the turn |
| Review a named revision | Yes | Yes |
| Live steering or resume through this worker | Unsupported | Unsupported |

Claude Code's first-event check observes the credential after the CLI starts.
Installed qualification in #2115 still owns evidence of real sign-in,
billing, sandbox behavior and opening the reported session in a native client.

## Install once

Upgrade the core before the worker. A worker from Hub #1743 on declares with
`coding-endpoint/2.1` and reports `coding-progress/2.1`, and a worker from Hub
#2028 on declares with `coding-endpoint/2.2`; an older core refuses them, so
such a worker cannot declare until the core knows them. Its first start ends
with `coding-worker-enable-refused: unsupported-version`. A core from #2028 on
works with an older worker as one slot for every companion (see
[the runtime upgrade procedure](../apps/runtime/UPGRADE.md)).

For the established worker, #2115 owns the compatible release and installed
verification. Upgrade the core and then the worker executable before changing
the existing private configuration's `schema` to `coding-worker/1.2`. Preserve
its allowlisted repositories, token file and harness settings. A configuration
using the older worker contract keeps finite admission. No host cap field is
needed in the current contract.

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
   {"schema": "coding-worker/1.2", "edge": "http://127.0.0.1:18788", "tokenFile": "/absolute/private/coding-worker.token",
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
   optional. `claude.environment` optionally lists up to 32 more variable
   names the harness may inherit, for a launch setup that needs one. The
   configuration refuses to load when it lists a name the rule in
   [Subscription sign-in only](#subscription-sign-in-only) covers: a denied
   name, a credential word (whole words, so `GITHUB_TOKEN`, `GITHUB_PAT` and
   `OPENAI_API_KEY` refuse, and `MAX_THINKING_TOKENS` and `AUTHOR_NAME` do not),
   the SSH agent socket or a git helper, or a dynamic-loader variable
   (`DYLD_*`, `LD_*`). `CLAUDE_CODE_OAUTH_TOKEN` is the one exception and is
   allowlisted anyway. The rule guards against mistakes in a list you write
   yourself; it is not a security boundary.
   Repository names are lowercase words joined by hyphens, dots or
   underscores and must match what the owner says to B.U.N.N.Y.
4. Start it after sign-in from the reviewed release:

   ```sh
   node /absolute/release/apps/runtime/bin/coding-worker.mjs /absolute/private/coding-worker.json
   ```

   A launchd user agent may run that command after login, with `KeepAlive`
   so a crash or a sign-out restarts it; the worker exits on SIGTERM and
   declares its endpoint off. After a lost stream it reconnects on its own
   and declares a fresh endpoint, trying again with backoff while the core
   still names the old one, which the core then shows as the new worker; each
   task that was running is ended uncertain and its task says so, and the
   worker never resends. The worker stops those runs, which keep their slots
   until they end, and declares the fresh endpoint once they have, or after
   fifteen seconds (ten until the forced kill, and five more). A run that
   still has not ended then, such as one whose output a leftover process holds
   open, keeps only its own companion's slot busy: that companion's next start
   is refused with `capacity` until it ends, and the other companions' starts
   are taken. The core does not know that slot is still busy, so that
   companion's next hand-off is not held to wait: it fails with `capacity`,
   and its task is told so. A stopped run's report is not sent on the fresh
   endpoint.

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
and the bound coding worker revision. After approval, Conversation shows the
saved Hub job ID. The core tracks the hand-off as an operation that completes
when the worker reports it started. Conversation remains available and the
worker's result links to the job receipt in its original exchange.

Each companion has its own slot. If that slot is busy, the approved job waits
and sends once when the slot frees. A restart preserves unsent jobs and
reports ambiguous starts as uncertain without repeating their dispatch.
**Cancel task** ends the Conversation turn. A named job stop targets one
worker attempt and remains unconfirmed until there is terminal evidence.
Conversation details show occupied slots and the reported plan usage windows.
The per-run caps are twenty minutes, sixty turns and five dollars.

A worker that stays connected but never reports again has each of its runs
given up as uncertain about 34 minutes after the run's start report: the
twenty-minute wall clock, a two-minute grace, and twelve minutes for git
setup. The worker reports a start before its fetch and worktree setup, which
takes turns per repository, so a run may wait for two other runs' setup
(240 seconds each at most) before its own. A lost worker is different: the
gateway reports its endpoint lost and its runs end uncertain at once.

Source tests cover the worker over a fake harness and a fake edge, and its real
entry point as a child process over the SDK's edge with a fake core. They also
replay recordings of real headless runs and status commands through the real
parsing code (`apps/runtime/tests/fixtures/claude-stream/recorded-*`), recorded
with synthetic prompts in an empty directory. Session, event, tool-use,
message and request identifiers, paths, account values, the plan, the limit
windows' figures, the timing origin and the overage reason were replaced with
synthetic values; the token counts and costs of those synthetic runs were
kept. A guard test fails on a home or temporary path, an e-mail address, a
token-like string, an account or organization member, or an identifier that
is not synthetic. A real usage limit cannot be provoked, so the
`constructed-*` limit fixtures follow the event shapes the tool documents and
are not recordings. Running it
against the installed core with a real `claude` is the installed check the
owner records under the running checklist. The handoff between two supervised
workers, and the interval launchd actually takes, is an installed check on
[#508](https://github.com/jimmie-potts/agent-device-hub/issues/508).
