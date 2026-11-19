# Qualifying the local Mac Codex hook

The Mac hook reports supported local Codex Desktop and CLI activity to the
core on the same Mac. Both clients share user hook settings and their hook
payloads do not identify the client surface. Use the shared Codex client
`local`; label the feed Mac Codex. Do not label these events Desktop or CLI
based on process ancestry, environment guesses or transcript files.

Cloud-orchestrated work is outside this connector, including work whose tools
execute on the Mac. See the [Codex hooks guide](https://learn.chatgpt.com/docs/hooks)
and [environment modes](https://learn.chatgpt.com/docs/environments/modes).
The [runtime guide](../apps/runtime/README.md) owns lifecycle publication and
the [manual container guide](bunny-container.md) owns core operation.
GitHub [#1183](https://github.com/jimmie-potts/agent-device-hub/issues/1183) owns
delivery and installed acceptance.

## Input and publication

Run the source wrapper with Node 24 and one private producer file:

```sh
node /absolute/release/apps/runtime/bin/mac-codex-hook.mjs /absolute/private/producer.json
```

Resolve Node and both paths explicitly in the installed hook command. Keep the
producer bearer out of the command, shell history, diagnostics and evidence.

| Hook input | Existing lifecycle event | Additional condition |
| --- | --- | --- |
| SessionStart | session.started | source is startup, resume, clear or fork |
| UserPromptSubmit | turn.started | valid turn_id |
| PermissionRequest | attention.approval | valid turn_id |
| Stop | turn.ended | valid turn_id |
| Interrupt | turn.interrupted | valid turn_id |
| SessionEnd | runtime.ended | session identity is sufficient |
| SubagentStart | session.started for the child | valid agent_id other than session_id |
| SubagentStop | turn.ended for the child | valid agent_id other than session_id |

Every selected event needs a valid session_id. If turn_id is present on a root
event it must also be valid. A root event containing agent_id is dropped whole,
including null or empty values. A subagent event's session_id is the parent's
and its agent_id names the child, which becomes its own session under that
parent with an unknown turn. Any other input containing agent_id, including a
child's PermissionRequest, is dropped whole. Compaction and tool events are
excluded. SessionEnd reflects the client's emitted evidence; switching away
from a Desktop chat does not establish that the client emitted it.

A Codex approval carries no request ID. The core forgets it at its turn's Stop,
when a newer turn retires its turn, at the session's end or by operator
recovery, and never correlates it otherwise. The hook makes no permission
decision: Codex shows its normal approval prompt once the hook exits. The
[provider qualification record](provider-qualification.md#mac-codex-approvals-and-subagents)
lists what is documented, implemented and observed for these events.

The sanitizer forwards only hook_event_name, session_id and optional turn_id
for a root event, and only hook_event_name, session_id and agent_id for a
subagent event, to the existing runtime hook. The normalizer adds the configured source and
observation time, then the SDK publishes one existing lifecycle message.
Prompt/reply text, tool input, agent types and paths arrive transiently on
client stdin but are never forwarded, logged or saved. No supplied path or transcript is opened.

A producer without `lifecycleVersion` publishes activity without title lookup.
To show available session titles, explicitly select `lifecycleVersion: "1.1"`
or `"1.2"` in the private producer and its matching installed receipt. The hook
then uses the existing bounded Codex reader over `session_index.jsonl` in its
process's `CODEX_HOME`, or `~/.codex` when unset. It takes the latest matching
`thread_name`, validates it before truncating to 160 Unicode scalars, and omits
the title on a missing, unreadable or rejected entry. The reader retains its
1 MiB tail, line bounds and 100 ms budget within the hook's 2.9-second deadline.
The sanitizer still strips `cwd` and `transcript_path`, so this adds no project,
transcript, prompt or response collection. Explicit labels keep precedence.
Only later hook events refresh a title; renaming an idle session alone sends
nothing. A subagent gets no title. Desktop read/archive evidence remains separate and Desktop-only.

The runtime verifies the private producer and any required receipt before
consuming input. Keep the existing source identity:

```json
{"provider":"codex","client":"local","hostId":"mac-mini","sourceId":"codex-local-hooks"}
```

Derive the credential identity with the existing producer helper. Do not reuse
a credential derived from a different client value. The core admits exactly
the configured ingest source with its one ingest-only credential; it grants no
read, command or administrative access. The bearer stays in the private
producer; the core stores its digest.

Input is capped at the runtime's 8 MiB limit and requires valid UTF-8 and JSON.
There is one publication attempt within the existing 2.9-second process budget.
Missing configuration, invalid input and unavailable receivers are silent and
fail open. No hook output changes permissions. Nothing queues or retries a lost
observation, and missing events do not establish completion.

## Installed qualification

Read-only inspection on 2026-10-22 found matching embedded event schemas and
enabled hooks in Codex Desktop 26.1016.51333 (bundled CLI 0.163.0-alpha.11) and
standalone CLI 0.163.0. This establishes available mechanisms, not successful
invocation. Recheck versions and supported hook settings when qualifying an
installation. PermissionRequest, SubagentStart and SubagentStop were added in
source by [#1867](https://github.com/jimmie-potts/agent-device-hub/issues/1867);
installing them and observing an actual client emit them belong to
[#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869).

After the integrated source passes its checks and review:

1. Follow the owning runtime procedure for the selected manual container
   installation. Preserve its state/config/secrets volumes, localhost binding,
   empty modules, disabled MCP and device control, and browser admission.
   Review the source update and stopped-backup plan before changing the core.
2. Derive the source with `producerSource` from the reviewed release's runtime
   hook package, using the source configuration above. In a separate copy of
   the selected Compose file, pin the reviewed image and add
   `BUNNY_INGEST_SOURCE: <derived-source>` under `services.core.environment`.
   The derived value is `bunny/parts/<producerCredentialId(configuration)>`.
   Use that exact value for both the environment setting and the credential's
   `source`; its `id` is the helper-derived credential ID and its only scope
   is `ingest`. No bearer belongs in Compose. Omitting the environment setting
   deliberately retains the zero-credential browser-only profile.
3. Stop the selected existing container and verify PID zero, then complete a
   fresh stopped backup. Update only its private credential file after checking
   the expected prior state. Recreate that selected stopped service from the
   new image/Compose while retaining exactly its existing state, config and
   secrets volumes and dedicated network. Never run the fresh-provisioning
   helper on these volumes. Verify the effective source setting, matching sole
   ingest credential, preserved mounts and localhost binding before startup.
   Use the existing private producer format and owner-only regular files.
   For an activity-only producer omit lifecycleVersion. For title lookup select
   lifecycleVersion 1.1 or 1.2 and match that choice in any installed receipt;
   preserve the existing qualified endpoint and transport. Confirm that the
   hook process resolves the intended Mac Codex home. Keep the bearer and
   actual session titles out of evidence published to GitHub.
4. Preserve existing Codex config.toml and its computer-use notify command.
   Merge only the hook definitions for the events selected above into user
   hooks.json after checking for concurrent edits. Set each command handler's timeout to three
   seconds and use absolute Node, release and producer paths. Use supported hook
   settings and normal trust review. Do not modify trust databases or suppress
   trust checks.
5. Run ordinary local Desktop work and ordinary CLI work. Observe both in the
   local dashboard under the shared identity. Record client versions, event
   kinds, elapsed failure behavior and source revision; keep personal session
   identifiers and runtime state private.
6. Verify that the existing Computer Use configuration and notify command are
   preserved and that supported browser Computer Use operation and the dashboard flow
   still work. The configured `turn-ended` helper has no supported internal
   delivery acknowledgment established by this qualification. Record that limit;
   do not claim internal delivery or invoke the helper with invented inputs.
   Verify that an unavailable local receiver does not interrupt agent work.
   Keep installed-client results separate from synthetic subprocess tests.

For a manual pause, remove only this connector's hook definitions through the
supported settings flow. Preserve other hooks and notify. Revoking its
ingest credential stops admission; it does not erase core state. Do not restore
an old database as a connector rollback.

## Source checks

The sanitizer and process checks run with:

```sh
node --test apps/runtime/tests/mac-codex-hook.test.mjs
```

Run the owning runtime hook tests after building the integrated source. The
shared contract tests cover the new client value and existing identities.
Receiver tests use disposable loopback services and synthetic credentials;
they do not qualify installed Desktop or CLI invocation. Build, JavaScript
lint and applicable CI remain part of delivery.
