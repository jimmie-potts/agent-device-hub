# Reversible shared monitoring setup

This is the Linux/WSL source deliverable for [Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8). It supplies local SDK operations for a named installation owner. Running these operations against personal files, starting clients or services, moving live state, and operating devices require a separate explicit request. Source checks use disposable private directories and never start a physical worker.

## Supported evidence

Use Node 24 on Linux, including Linux inside WSL. The package includes `setup`, `setup-authority`, `setup-consumer`, `monitor-hook`, and the existing supervised migration APIs. No native Windows service installer is supplied. Python 3.12 and 3.14 remain the shared contract CI versions.

The [provider inventory](../../docs/provider-qualification.md) recorded Codex CLI 0.153.4 and Claude Code 2.1.236 artifacts on WSL on September 8, 2026. These are historical artifact observations, not installed-hook qualification. Codex Desktop's version and hook path remain unknown. No actual client version is newly qualified by this delivery. Synthetic Codex and Claude JSON inputs prove normalization, privacy and bounded failure behavior only. A future installation owner must record the actual version, execution path, trust review, event coverage and missing-signal behavior before setting `qualified: true`. Otherwise keep it false.

Codex configuration follows the [official hook reference](https://learn.chatgpt.com/docs/hooks). Claude configuration follows its [official reference](https://code.claude.com/docs/en/hooks). The generated commands produce no permission decisions or model context. Preserve managed-only hooks policies and the client's normal trust review. An ignored or untrusted hook is absent evidence, never permission to weaken policy. Missing events leave state uncertain.

## Inspect, plan, apply and remove

Choose exactly one source identity and one active receipt directory for that source. The installation owner inventories existing managed producers across client configuration layers before proceeding. This SDK operates on explicit files; it does not discover or take over other installers' entries. A receipt belongs to one state-owner installation. Retain removed receipts for audit and use a new directory for a later installation.

All receipt directories and immediate configuration parent directories must be owned by the current Linux user with mode 0700. Files must be regular, unlinked, owner-only mode 0600, outside Git and `/mnt`. The target client JSON must already exist, with `{}` permitted. Do not copy secrets into a checkout. The receipt and backup contain private configuration and tokens; never display them in frontend status or commit them. The review plan contains the client's full before/after configuration and is for private owner review only.

Compose these exports in the process that owns the exact running host:

```js
import {planSetup, applySetup, inspectSetup, planRemoval, removeSetup}
  from '@jimmie-potts/hub/setup';
import {hubSetupAuthority} from '@jimmie-potts/hub/setup-authority';

// input contains explicit private paths, source identity and qualification.
// hub is the startHub result; hostConfiguration is its private persisted JSON.
const authority = hubSetupAuthority(hub, hostConfiguration);
const plan = await planSetup(input);
// Privately review plan.before, plan.after, additions and removals.
await applySetup(input, plan.digest, authority);
const status = await inspectSetup(input.directory);
const removal = await planRemoval(input.directory);
// Review the current removal diff separately before executing it.
await removeSetup(input.directory, removal.digest, authority);
```

`input` has `directory`, `target`, `source`, `endpoint`, `node`, `hook`, `owner`, and `qualified`. `source` is the shared provider configuration with neutral `provider`, `client`, `hostId`, `sourceId` and initial `hook: 'SessionStart'`. `endpoint` is the chosen owner's numeric IPv4 loopback URL ending `/api/monitor/v1/events`. `node` is the absolute Linux Node 24 executable; `hook` is the installed package's `bin/monitor-hook.mjs`. `owner` is a neutral installation-owner label. Set `target` to the explicitly selected Codex hooks.json or Claude settings.json. Never infer it from a working directory.

The SDK installs one `producer.json` and event-specific commands referring to it. Its absolute private path is the ownership marker; each recorded entry must occur exactly once. Events are SessionStart, UserPromptSubmit, PermissionRequest, Stop, SessionEnd, SubagentStart and SubagentStop, with Interrupt for Codex. Raw hook metadata passes through the shared allowlist normalizer. Tokens travel only in the authenticated local request. Prompts, transcripts, tool content and private paths are dropped. A colocated setup receipt must match the producer and be installed before emission, including after interrupted writes. The hook enforces a 2.9-second process deadline, a bounded stdin and a single bounded HTTP request. Invalid, disabled or offline input returns silently with success. The selected executable itself must exist and work; a missing runtime cannot be repaired by a hook that never starts.

`planSetup` and `planRemoval` do not write. Their digests bind the operation to the current settings and receipt. Apply writes durable intent, a disabled producer and the original private backup, confirms a persisted credential grant, edits the reviewed target, then enables only a qualified source. Repeat apply validates existing ownership. Removal disables emission, confirms revocation, and removes exact owned entries from the latest settings. Unrelated additions, removals and trust settings survive. An edited, missing or duplicated owned entry is a conflict, not permission to overwrite it. The backup is evidence, never a whole-file restore instruction.

`inspectSetup` returns only the receipt state, neutral owner/source IDs, qualification and local enabled flag. It makes no network call and does not prove the client executed a hook. `inspectNanoleaf` calls only the owning CLI's read-only `shared-status` and projects source/configured/connection. Neither operation starts devices. Read authenticated hub health separately; `admission: 'fenced'` means mutations remain refused even during consumer readiness checks.

## Credentials and Windows invocation

The standalone adapter grants one source-derived principal with ingest scope, persists it in the host configuration, replaces the running credential set and verifies authority. Removal deletes that exact principal and verifies HTTP 401. Other credentials remain intact. Use separate read credentials for consumers and separate control/admin credentials for migration. Never reuse a device token as a producer token.

For an embedded Pixoo owner, first compute `producerPrincipal(input)` and explicitly provision that ID through Pixoo's owning monitor CLI, `node <monitor-cli.js> add-control <data-directory> <principal>`. Capture the returned bearer privately in a mode-0600 `credentialFile`; do not print it in receipts or logs. Pass that absolute file in the setup input and compose `pixooSetupAuthority({dataDirectory, endpoint, node, managementEntrypoint})`. Its endpoint ends `/api/monitor/v1`. Pixoo's released CLI uses read/control credentials for events. This adapter verifies the digest/scopes and live access; it does not invent an ingest-only Pixoo scope. Removal invokes that same owning CLI's `revoke`, checks its persisted disabled state and verifies HTTP 401. Keep the owning service available until revocation is confirmed.

A Windows Codex client may use the explicit `windowsDistribution` option to generate `commandWindows` with `wsl.exe --distribution ... --exec ...`. All executable/config paths refer to Linux files in that distribution. The producer contacts Linux loopback from Linux; no Windows-to-Linux TCP forwarding is assumed. Construction tests reject Windows expansion/metacharacters. Actual Windows execution, distribution startup latency and trust remain unqualified. Claude's source path here runs inside WSL; do not supply `windowsDistribution` for Claude. Preserve existing Windows hooks and never change firewall, router or host placement implicitly.

## Cutover and rollback

Before an owner move, stop configuration edits, inspect every producer and consumer, and confirm identical owner IDs and consumer policies. Nanoleaf's released shared input requires `{id:'nanoleaf', clearOnNewTurn:true}`. If the current state has a different consumer list or policy, stop for an explicit policy migration owned by that service. Never edit an export or database to make import pass.

1. While the embedded owner still runs, review/remove the old setup and verify revocation. Retain its receipt and backup. This temporarily pauses monitoring and prevents duplicate ingestion.
2. Follow [supervised migration](README.md#supervised-state-owner-migration) to quiesce, export and verify source-process exit. Import into a fresh fenced standalone store. Preserve owner ID, source identities, revision, notices, labels and acknowledgments.
3. In a new private receipt directory, apply a reviewed setup against the fenced destination using its exact live host/configuration. Then `stageProducer` its producer file with the same newly granted endpoint/token. It disables emission while retaining the intended qualified enablement. Never retarget a setup receipt to a different credential or owner behind its back.
4. Stage Pixoo's selected-source file and restart the same supervised simulator or separately authorized installed app. Keep its media, scenes and presentation preferences with its owner. Call `hub.prepareConsumers()` to expose a running read projection while all mutation admission remains fenced.
5. Compose `prepareNanoleaf(command, config, endpoint, ownerId)` with the owning Linux Python CLI and explicit environment. It calls `shared-configure --config`, `shared-preflight`, then `shared-select shared`. Its private config includes version 1, ownerId, consumerId `nanoleaf`, endpoint, tokenFile, clearOnNewTurn true, qualifiedSources and explicit bindings. The owning preflight validates credentials, policy, feed and bindings. Shared selection can start Nanoleaf's designated physical worker, so this step needs installation/device authority. Do not run it during source delivery. Legacy hooks remain installed; the owning bridge suppresses their duplicate ingestion while shared input is selected.
6. Activate with the Pixoo route/managed-owner capability and `{id:'nanoleaf', nanoleaf}` from prepareNanoleaf. Activation rechecks current revision/identities and consumer configuration before opening writes. Release completed route locks. Verify one identified event in both actual consumer projections, then collect separately authorized visible-device receipts.

For legacy Nanoleaf rollback, call `rollbackNanoleaf(command)`. It selects and verifies `legacy` through the owning CLI, preserving the latest legacy configuration. It does not restore a backup hook file or resurrect entries the user removed. Before a state-owner rollback, remove the current setup while its owner can confirm revocation, stop its facade, export the **latest** state, verify that owner's exit, and import into another empty host store. Install a fresh receipt and repeat consumer readiness/activation. The original occupied embedded store is never restarted as an automatic fallback. Pixoo remains a remote facade of the selected fresh host, and Nanoleaf's explicit legacy path is restored when requested.

## Failure recovery and evidence

An apply failure retains an `applying` receipt and disabled producer. Re-plan and retry with the same input/authority after resolving the reported conflict. A removal failure retains `removing` intent; retry after restoring access to the owning service and inspecting the latest removal diff. Never remove the receipt to bypass revocation. If the process died holding `setup.lock`, the named owner must establish that the setup coordinator is gone and no other setup runs, inspect the receipt and affected files, then remove only that empty lock directory before retrying. Unknown owned-entry edits need explicit reconciliation; automatic whole-file recovery is refused.

A failed consumer preflight leaves the old selected path in place. A failure after shared selection requires explicit legacy rollback or completion of the fenced handoff. Failed activation cannot be retried on the same destination capability. Follow the host's staged recovery/export procedure into a fresh store. Keep producer emission disabled or mutation admission fenced throughout recovery. Do not clear a database fence, open a controller database from Hub, or start a second physical writer.

Source evidence consists of setup conflict/recovery tests, silent-hook tests, credential rejection checks, reproducible offline packaging, and `scripts/check-hub-shared-consumers.mjs` against pinned Pixoo/Nanoleaf sources. The latter replaces only physical worker launch with a no-op and uses real owning configuration/preflight/status logic. It verifies the identified event, both projections, revocation, legacy selection and latest-state host rollback. The existing Pixoo host check additionally covers labels/notices/acknowledgment and renderer behavior. These do not establish personal installation, real-client event completeness, integrated performance budgets or optical accuracy. Record each future receipt with its named owner and exact versions; Pixoo #34 and Nanoleaf #30 retain device acceptance.

Credential adapters also retain a private source-principal ownership record in the state owner's directory. Grant and revoke require the same receipt directory and token digest. A second receipt cannot adopt an active source, even with a copy of its token. Confirmed revocation leaves a tombstone; a later reviewed installation may claim that source again. A crash may retain `setup-authority.lock` in the state owner directory or `<target>.setup.lock` beside a client target. These locks serialize credential changes and SDK edits across sources. Recover it under the same dead-coordinator/no-concurrent-writer procedure as `setup.lock`, without deleting the ownership record.
