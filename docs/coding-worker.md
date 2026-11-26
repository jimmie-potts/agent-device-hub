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
does not resend either start. A delayed explicit dispatch keeps its original
connection binding even when the next worker uses the same endpoint name.
The core reads current selection at startup and after a state-stream gap. It
refuses explicit dispatch until that read confirms an available worker.
Unassigned jobs keep their place for the next worker connection.

An uncapped worker reports whether an attempt is waiting for Git setup,
preparing its worktree or ready to run the harness. A waiting report renews
only the wait deadline. Once setup starts, the attempt has its own setup
deadline. A ready worktree starts the harness deadline. A spawn failure
ends that attempt and leaves its siblings running. The worker reports usage
limits only when the harness supplies that evidence.

Open **Details**, then **Coding jobs**, to find active jobs and stop a named
attempt. **Next jobs** reads later jobs without affecting admission.

## Native clients for saved attempts

The worker can offer saved-session continuation to the same account on its host.
Enable only the clients qualified on that host. In the private
`coding-worker/1.2` configuration, `nativeClients` takes an absolute Unix
socket path inside an owner-only directory, `harnesses` with the eligible
terminal harness names, and optional `claudeDesktop: true` on macOS.
The socket must be outside Git. Keep the socket path short enough for the
host's Unix socket limit. The worker reports a fixed diagnostic if it cannot
start this optional listener.

To continue in a terminal, open a foreground terminal on the worker host
under the worker account. Run the helper with the private worker configuration
and attempt ID from the job card, then select **Continue saved session in
terminal** on that same card.

```sh
node apps/runtime/bin/coding-worker.mjs native /absolute/private/coding-worker.json <attempt-id>
```

The eligible Codex CLI 0.163.0 route resumes the exact saved thread in its
dedicated worker profile. It reuses the #2112 writer fence and checkout proof
to copy the checkout into a protected successor. A clean or committed
completion can qualify without receiving a cross-harness continuation token. The worker checks
the new write boundary against the original checkout. A no-turn app-server
resume must return the same thread, the successor as its only workspace root,
the selected permissions and current personal subscription. The terminal uses
that successor with an explicit `--cd` and its own app-server. A Mac host
sandbox also protects the original checkout and its shared Git metadata.
This route reserves the same attempt as **Continue with Claude Code**, which instead
starts a new attempt. Only one can take write control.

The worker prepares the launch privately. The Hub rechecks both the private
read grant and worker brief grant before authorizing that prepared launch.
The terminal helper acknowledges process start and reports client exit. A
plan sent without that acknowledgment leaves the launch unconfirmed. A
detached background writer may outlive the native terminal, so the worker keeps the attempt reserved after
exit. Native messages and progress stay with the native client.

Claude terminal and Desktop use the original checkout of a saved session.
Both require independent evidence that the previous writer and its descendants
released that checkout. The existing Claude worker cannot supply that evidence.
The exact Desktop form is `claude --desktop --resume <session-id>`. Its
acknowledgement names the requested session, and Desktop activity and writer
release remain unobserved. [Claude Desktop reference](https://code.claude.com/docs/en/desktop#coming-from-the-cli)

Live Claude attachment applies to background sessions. Claude background mode
rejects the print mode used for the worker's private stdin brief, authenticated
stream, structured result and turn and spending caps. A fresh, untrusted
worktree also needs native trust confirmation. The existing worker keeps
its bounded headless mode. The read-only `claude logs` command reads recent
terminal output for managed background sessions. It can't inspect the headless
worker's saved UUID. An interactive `--resume` can send another turn and
change session history, even when local file editing is limited. Jobs therefore
offers no passive Claude CLI viewer for this worker.
[Claude agent view](https://code.claude.com/docs/en/agent-view#dispatch-an-agent-from-your-shell)
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference)

The worker's live app-server stream cannot be opened by the standalone terminal. The Codex
app workspace launcher cannot confirm an exact job thread in the dedicated
worker profile. Both of those actions stay unavailable.
[Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
[Codex 0.163.0 resume cwd selection](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/session_resume.rs)

## Harness choice and continuation

For a new coding job, Auto prefers Claude Code when its subscription is
eligible and selects Codex if Claude Code has a confirmed quota rejection or
unavailable subscription. The job shows the selection reason. A named choice
uses only that subscription. An unknown quota remains unknown. The Hub can
resolve Auto again while a job is still local and queued. After dispatch,
slowdown or uncertainty stays with the selected attempt.

A partially completed attempt can continue on the other harness on a Mac
when the first process group has stopped and its native sandbox denies writes
to the successor path. Claude Code uses a macOS process sandbox inherited by
its subprocesses. Codex uses its verified native permissions profile. The
worker checks the boundary offline, then creates a
distinct checkout and Git store at the accepted revision. It verifies the
source directory, Git directory, staged index and tracked file contents.
A staged new source file can travel with the partial work. Git-visible
unstaged new files, symlinks and aliased files block continuation. Ignored
build artifacts stay with the previous attempt.

Each attempt keeps its own native session, outcome and checks. The worker
pairs the exact approved brief with bounded Git and check facts at launch.
Continuation is unavailable when the worker cannot verify the source sandbox.
Losing the connection, restarting the worker or changing the source checkout
invalidates the old proof.

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

## Enrolled worker declarations

A worker enrolled for destination routing uses private configuration
`coding-worker/1.3`. Its `source` must match its coding-worker credential.
The established Mac source is `bunny/parts/coding-worker`, the PC source is
`bunny/parts/coding-worker-pc`, and each cloud enrollment uses
`bunny/parts/coding-worker-cloud-<slug>`. The owner assigns a separate credential
with zero ordinary scopes to each source. Only the enrolled non-Mac workers can
use the worker SDK endpoint calls through the authenticated private proxy.
The credential has no state read, dashboard, device, terminal sign-in or
installation authority.

On startup and every 45 seconds, the worker sends the Hub its operating system,
configured `toolchains` names, the exact local `origin/main` commit for each
available allowlisted repository and the harness readiness it can establish.
On the Mac and in WSL on the PC, the worker samples one-minute load and the
free test slots from the documented host profile. It reads process and local
Docker status without creating a container or reserving a slot. The Hub uses
the aggregate observation to choose a destination. The worker's normal test
commands apply the host's admission checks again before starting anything.
An unreadable count leaves the slot estimate unknown.
The declaration includes repository names and revisions. Token and worktree
paths stay on the worker. A revision-pinned start requires the exact declared
commit and creates the worktree at that commit without fetching a newer one.

Existing Mac configurations and credential paths continue to work. An enrolled
PC needs the local WSL2 Codex check below. Cloud workers have a separate
qualification procedure.

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
ten-second deadline, after which the probe is killed outright. The legacy
finite declaration `coding-endpoint/2.2` carries this record and the number of
slots. The companions module publishes the record in coding state along with
visible active runs and waiting hand-offs.

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
Fresh app-server threads and saved terminal launches pin the built-in OpenAI
provider to the ChatGPT subscription model endpoint at
`https://chatgpt.com/backend-api/codex`. The worker checks that effective setting
alongside the ChatGPT backend used for the account.
For repository checks the worker selects the Node 24 distribution that runs it,
that distribution's npm, and Git from Apple Command Line Tools. It prepares a
private directory with links to those three tools and checks that each runs in
the same worktree sandbox before sending a brief or releasing a saved terminal
plan. The sandbox reads only the selected tool paths, the npm package and the
required macOS OpenSSL config for this toolchain. Git uses no user or system
configuration and skips optional index locks. npm runs offline with its update
notifier and user and global configuration disabled.
For a linked worktree, `git status` reads the actual files and index.
`git diff` shows unstaged edits against the detached HEAD when the index has
no staged changes. If an outside process stages a change, status still reports
it and diff refuses. The sandbox denies shared Git metadata except the exact
read-only index and HEAD files. A private shallow copy supplies the detached
HEAD's objects. The worker removes this copy after confirming the Codex writer
has stopped. A later attempt uses a new copy. A saved terminal successor uses
its own read-only Git directory, with the earlier checkout and its common Git
directory denied.
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
| Cancellation | The worker terminates the child | Once the turn is acknowledged, the worker requests its interruption, waits up to four seconds for the acknowledgement and matching terminal event, then verifies the process group has exited. A missing proof leaves the stop uncertain. |
| Native identity | First validated session ID in the stream | Validated thread ID before the turn |
| Review a named revision | Yes | Yes |
| Message a running job | Unsupported | The worker sends the message to the named thread and active turn. A matching turn receipt confirms acceptance. |
| Resume the same stopped turn through the worker | Unsupported | Unsupported |

Claude Code's first-event check observes the credential after the CLI starts.
Installed qualification in #2115 still owns evidence of real sign-in,
billing, sandbox behavior and opening the reported session in a native client.

## Run the PC worker in WSL2

The Mac still owns Hub state, devices and installation. The PC worker uses its
existing private HTTPS route to the Mac and holds only its own coding-worker
credential. Use the supported release after the installation coordinator
confirms the selected Mac batch. [Private HTTPS route](../apps/runtime/PRIVATE-ACCESS.md)

1. In Windows, use `wsl --list --verbose` to confirm the selected distro runs
   WSL version 2. In that distro, run the worker as the ordinary owner account.
   Keep the source, worktrees, worker configuration, token and Codex profile
   on the distro's Linux filesystem.
2. Use Node 24 with the npm installation beside it, distro Git at
   `/usr/bin/git`, and bubblewrap at `/usr/bin/bwrap`. Install the standalone
   Codex 0.163.0 Linux release binary for the architecture shown by `uname -m`.
   Use the canonical path to the native binary in the configuration.
   Verify the binary against its published release asset digest.
   [Codex 0.163.0 release](https://github.com/openai/codex/releases/tag/rust-v0.163.0)
3. Build the pinned Hub source with `npm ci` and `npm run build`. Prepare a new
   owner-only Codex profile directory and an allowlisted checkout with the
   requested commit at its local `origin/main`. Use a disposable checkout for
   the first trial.
4. Write an owner-only `coding-worker/1.3` JSON configuration. Use the existing
   private HTTPS origin for `edge` and a private Linux path for `tokenFile`.
   Set `source` to `bunny/parts/coding-worker-pc`, `toolchains` to
   `["node24", "wsl2"]`, and `repositories` to the selected repository name
   and checkout path. Set `codex.executable` to the canonical binary and
   `codex.home` to the separate profile. The PC uses Codex alone, so omit
   `claude` and `nativeClients`.
5. From the pinned source directory, run the signed-out preflight.

   ```sh
   node apps/runtime/bin/coding-worker.mjs verify-wsl /absolute/private/coding-worker.json
   ```

   Expect `coding-worker: WSL2 Codex sandbox and toolchain verified without an account or a model turn`.
   The preflight checks each configured checkout, its actual Git metadata
   and its `.local/worktrees` path before testing in a disposable checkout.
   Keep the checkout and Git metadata on the distro's root filesystem, with
   no symlink in either worktree-parent component. It uses an empty child
   profile and requires a real checkout write, tests an outside file and a private
   loopback listener, and checks Node, npm and Git in the same Codex profile.
   The preflight opens no worker token and sends no model request.
   A namespace or toolchain refusal leaves the worker unqualified. Keep the
   existing kernel protections. [Codex Linux sandbox](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/linux-sandbox/README.md)
6. After the installation coordinator confirms enrollment and the pinned Hub
   release, sign in on the PC under its dedicated Codex profile. Use the personal
   ChatGPT sign-in with file-based storage. The owner can use the device-code
   flow if the distro cannot open the browser callback.
   [Codex CLI authentication](https://developers.openai.com/codex/auth)
7. Verify that the owner grants the approved repository, brief and needed
   input fields to `coding-worker:pc`. The Mac's worker grant does not apply
   to PC jobs. Keep the owner-issued PC bearer token in the private
   `tokenFile`. From the
   pinned runtime source, start one worker with this configuration.

   ```sh
   node apps/runtime/bin/coding-worker.mjs /absolute/private/coding-worker.json
   ```

   Keep the foreground shell open. To stop the worker, interrupt that process
   and wait for it to exit. Before any replacement, confirm the old endpoint
   has gone and reconcile attempts whose delivery or writer release is unclear.
   Keep token, account and checkout paths out of the receipt.

Read back **PC** and **Codex** in Jobs after approving a bounded synthetic job.
Confirm the exact pinned revision and checkout marker, then compare the
named check result. For the PC Docker test profile, follow the measured WSL
test settings and set `BUNNY_TEST_HOST=pc` when invoking a test command that
uses it. [Test work on the PC](development.md#test-work-on-the-pc)

The WSL worker accepts named live messages and stop requests through Jobs when
the exact attempt is running. The headless CLI has no attachable terminal.
Saved terminal continuation requires a stopped writer and a successor checkout.
The Mac also applies an outer write fence to the whole interactive Codex CLI,
separate from the sandbox used for its model commands. The PC does not yet have
qualified evidence for that outer fence, so Jobs offers no terminal or Desktop
launch for PC attempts. Keep the native attempt unopened until that route has its
own qualification.

### Try the signed-out preflight before enrollment

From the built candidate source on the PC, set `CODEX_EXECUTABLE` to the
verified standalone Linux binary. This example uses a fresh local repository,
an empty profile and an example HTTPS origin. It leaves the token path absent.

```sh
(
  set -eu
  umask 077
  probe="$(mktemp -d "$HOME/bunny-wsl-probe.XXXXXXXX")"
  trap 'rm -rf -- "$probe"' EXIT
  mkdir -m 700 "$probe/profile" "$probe/repository"
  git -C "$probe/repository" init --quiet --initial-branch=main --template=
  git -C "$probe/repository" -c core.hooksPath=/dev/null \
    -c user.name='Synthetic fixture' -c user.email='fixture@example.invalid' \
    commit --quiet --allow-empty -m 'Signed-out preflight fixture'
  git -C "$probe/repository" update-ref refs/remotes/origin/main HEAD
  node - "$probe" "$CODEX_EXECUTABLE" <<'NODE'
const {writeFileSync, realpathSync} = require('node:fs');
const {join} = require('node:path');
const [, , root, executable] = process.argv;
const config = {
  schema: 'coding-worker/1.3',
  source: 'bunny/parts/coding-worker-pc',
  edge: 'https://example.invalid',
  tokenFile: join(root, 'unused-token'),
  repositories: [{name: 'fixture', path: join(root, 'repository')}],
  toolchains: ['node24', 'wsl2'],
  codex: {executable: realpathSync(executable), home: join(root, 'profile')},
};
writeFileSync(join(root, 'worker.json'), JSON.stringify(config), {mode: 0o600, flag: 'wx'});
NODE
  env -u CODEX_HOME node apps/runtime/bin/coding-worker.mjs verify-wsl "$probe/worker.json"
)
```

Share the success line or fixed refusal and the tool versions. Keep host
paths and account information private. The signed-out result qualifies the
local sandbox and toolchain only.

## Install once

Upgrade the core before the worker. A worker from Hub #1743 on declares with
`coding-endpoint/2.1` and reports `coding-progress/2.1`, and a worker from Hub
#2028 on declares with `coding-endpoint/2.2`; an older core refuses them, so
such a worker cannot declare until the core knows them. Its first start ends
with `coding-worker-enable-refused: unsupported-version`. A core from #2028 on
can use an older worker with a single shared slot. A finite worker that
declares three slots has one per companion. See the
[runtime upgrade procedure](../apps/runtime/UPGRADE.md).

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
   credentials file at start and on reload. An unrecognized coding-worker source, a scope, or a
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
   worker never resends. The worker stops those runs and declares the fresh
   endpoint once they end or after fifteen seconds. That allows ten seconds
   before the forced kill and five seconds after it. A finite worker still
   counts any surviving run against its companion's slot. Its next hand-off
   for that companion fails with `capacity` until the run ends. The worker
   can accept starts for other companions. A stopped run's report stays on
   its original endpoint.

## One credential, one endpoint

Run one worker per enrolled source. The core selects one endpoint for that source
and refuses another while its endpoint is selected, so stop the old worker
before you start its replacement. That includes handing over to launchd: stop a worker you
started by hand before loading the agent.

A second worker using the same credential while the first is still declared connects, opens its
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

With uncapped admission, approved jobs wait for the Hub to deliver their
starts. A finite worker that declares three slots has one per companion. Its
approved job waits until that companion's slot frees. A restart preserves
unsent jobs and reports ambiguous starts as uncertain without repeating their
dispatch. **Cancel task** ends the Conversation turn. A named job stop targets
one worker attempt and remains unconfirmed until there is terminal evidence.
Conversation details show active runs and the reported plan usage windows.
The per-run caps are twenty minutes, sixty turns and five dollars.

For a finite worker that stays connected and stops reporting, the Hub records
a run as uncertain about 34 minutes after its start report. That includes the
twenty-minute wall clock, a two-minute grace period and twelve minutes for Git
setup. Uncapped workers use the separate wait, setup and harness deadlines
described above. When the gateway reports a lost endpoint, the Hub records the
runs as uncertain at once.

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
