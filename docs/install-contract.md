# Installed runtime contract

This contract defines release identity, private operation receipts and the behavior
that each runtime's own installer must implement. Contracts 1.2.0 adds
`install-receipt/1.0`; controller APIs 1.0/1.1 and lifecycle schemas are unchanged.
[The schema](../packages/contracts/schemas/install-receipt-v1.schema.json) and
[shared cases](../packages/contracts/fixtures/install-receipt-v1.json) are normative
for receipt shape. This document defines operational evidence; passing a schema
cannot prove that a process restarted or that data survived.

Consumers pin this document with an immutable source-commit link and pin the
published archive and its receipt. Each repository owns its command and procedure.
There is no shared installer library, automatic deployment, host migration or
permission to run an installer in this source delivery.

## 1. Release identity

Every new release comes from a clean, merged full 40-character lowercase Git SHA.
Record the trusted repository/source receipt, source SHA, package version, archive
SHA-256 and manifest SHA-256. Version strings are informational: two builds can
share a version. Verify every shipped file and dependency against the manifest,
reject unlisted executable content and unsafe archive paths/links, and verify the
archive against its trusted receipt. A manifest supplied by an untrusted archive
alone does not establish source provenance.

Build the exact revision in an isolated clean checkout, with pinned toolchains and
lockfiles. Do not stamp a moving checkout's HEAD onto different bytes. Stage beside
the running release in a unique directory. Existing `releases/<sha>/` is immutable:
reuse only verified identical bytes; refuse a different archive at the same SHA.

### First-adoption recovery exception

If the existing build has no provable full SHA, retain its verified bytes as
`legacy/<legacyId>/` outside `releases/`. Its identity is
`{kind:"legacy", legacyId, sourceRevision:"unknown", contentSha256, manifestSha256}`.
The content digest covers a deterministic, documented inventory of names, file
bytes, modes and link targets; the manifest and verification evidence establish
what was copied. Preserve original bytes and required dependency closure. Neither
hash belongs in a Git revision field. This exception applies only to the build
already installed when first adoption begins, never to a newly built target.

Prove compatibility and recovery before migration. When legacy health lacks build
metadata, combine executable resolution, process identity/start time after the
restart and served-artifact hashes or equivalent runtime evidence. A file digest
alone does not prove the process is running. Failure to prove recovery blocks
migration. Interrupted adoption requires owner inspection; it is not retried
blindly and does not discard originals or history.

## 2. Layout and shared ownership

These symbols name logical private locations, not values to publish in health:

- `N`: Nanoleaf state root, conventionally `~/.local/share/codex-nanoleaf`.
- `H`: Hub release/receipt root, `~/.local/share/agent-device-hub/hub`.
- `P`: Pixoo release/receipt root, `~/.local/share/pixoo-playlist-controller-runtime`.

The installation plan resolves actual paths and verifies their owner, link chain,
filesystem and configuration. No updater treats `N/runtime` as a release root.

| Path or boundary | Owner and writer | Release behavior |
| --- | --- | --- |
| `H/releases/<sha>/`, `H/current`, `H/legacy/` | Hub updater | Current points to one immutable Hub release or verified legacy recovery copy |
| `N/runtime/hub-gh30` | Hub stable entrypoint | First adoption replaces only this component with a forwarding link to `H/current`; routine switch touches only `H/current` |
| `N/shared-monitor` and configured Hub durable stores | Hub state owner | Mutable state, `host.json`, socket and runtime files stay outside releases; updater backs up named durable files only after owner exit |
| `H/receipts/`, `H/backups/`, `H/install.lock` | Hub updater | Durable history, consistent backups and exclusive operation lock; never included in pruning |
| `N/releases/<sha>/`, `N/current`, `N/legacy/` | Nanoleaf updater | Current is the Nanoleaf-only anchor; payload contains `bridge/`, `mcp/`, `vendor/` and its declared dependency closure |
| `N/runtime/bridge`, `N/runtime/mcp`, `N/runtime/vendor` | Nanoleaf stable entrypoints | Each forwards through the same `N/current` anchor; no component gets its own independently switched current link |
| `N/.venv/bin/python` | Nanoleaf executable/dependency owner | Preserve the service path. A shared environment must satisfy both releases and remain unchanged during routine switching; a per-release environment must be reached through this stable path and the same anchor. Consumer qualification chooses and measures the environment strategy before adoption |
| Nanoleaf databases, settings, credentials, worker locks under `N` | Nanoleaf state/device owners | Never moved into a release; all applicable worker admission and exits must be controlled before copying mutable files |
| `N/receipts/`, `N/backups/`, `N/install.lock` | Nanoleaf updater | Its private operation evidence and lock; unrelated root children are not owned merely because they are under `N` |
| `N/runtime` | Shared container | Neither updater replaces, moves, links or prunes this parent |
| `N/runtime/node/bin/node` and its distribution | Shared prerequisite used by Hub and Nanoleaf MCP | Both routine updaters preserve bytes, path and executable resolution. Node changes need separately named scope, both owners and recovery qualification |
| `N/runtime/codex-gh30`, hooks, launchers and units | Existing installation/setup owners | No routine edits; preserve stable paths and client configuration |
| `N/runtime/*.prev-*`, `bridge-before-*`, other historical copies and `N/install-backups/` | Historical installation records | Preserve, even when they contain another project's old files |
| `P/releases/<sha>/`, `P/current`, `P/legacy/` | Pixoo updater | Separate release anchor; previous SHA-named copies remain history during first adoption |
| Pixoo Node executable, environment file and configured library/state | Existing Pixoo owners | Stable external dependencies and mutable state; archive originals/renditions remain outside release pruning |
| `P/receipts/`, `P/backups/`, `P/install.lock` | Pixoo updater | Private operation records and lock; never adopt/delete the historical backups under `N` |

The current service paths are `N/runtime/hub-gh30/dist/cli.js`,
`N/runtime/bridge/bridge.py`, `N/runtime/mcp/dist/main.js` and
`N/.venv/bin/python`. Hub and Nanoleaf MCP both execute `N/runtime/node/bin/node`.
Nanoleaf's copied bridge vendor directory and sibling runtime vendor directory
must resolve inside the same selected release. Consumer packaging tests must
check real module/link resolution, including Python imports and MCP dependencies.
Mutable caches must use owner-controlled state/cache paths, not immutable payloads.

A Hub upgrade controls only `codex-nanoleaf-monitor.service`. Nanoleaf controls its
wall, controller and MCP units plus every hook-launched or long-lived device
worker. Pixoo controls its own service. Each command acquires only its own install
lock; that does not authorize changing shared prerequisites. Unknown paths or
ownership cause refusal. Verify excluded path hashes/link resolution under the
lock before outage and after recovery.

### Both adoption orders

Each row is a contract walkthrough, not a claim that a live migration ran. Consumer
implementations must repeat these sequences in isolated directories with fake
service control, marker files for the other owner and shared executable hashes.

| Sequence | Owning transitions | Required invariant |
| --- | --- | --- |
| Hub first | Verify Hub recovery copy; fence/stop Hub; preserve original; introduce `hub-gh30 → H/current`; restart and verify. Upgrade `H/current` to H2; fail health and recover H1/legacy; re-upgrade H2 | Nanoleaf bridge/MCP/vendor/Python paths and shared Node resolve to identical bytes throughout |
| Nanoleaf after Hub | Fence worker admission; stop units/workers and verify exit; retain only Nanoleaf originals; introduce stable component links through `N/current`; upgrade N2, recover N1/legacy and re-upgrade | `N/runtime` remains a directory; `hub-gh30 → H/current` and shared Node never move; Hub keeps resolving its selected release |
| Nanoleaf first | Perform the same Nanoleaf transitions while `hub-gh30` is still a legacy directory | Legacy Hub and Node remain byte-identical; no recursive copy, swap or prune of `N/runtime` |
| Hub after Nanoleaf | Perform the same Hub transitions while Nanoleaf's component links already traverse `N/current` | Nanoleaf links and dependency resolution remain unchanged; neither updater follows the other owner's links when pruning |
| Interrupted first adoption in either order | Stop after each rename/link boundary in the fake sequence, then inspect | Retained originals and intent identify the incomplete transition; refusal prevents a second automatic migration or starting mixed Nanoleaf components |

One-time conversion of several Nanoleaf component paths occurs while its units
and workers are stopped and admission is fenced. Only the subsequent `N/current`
switch is the single atomic publication point. A partial conversion is never
presented as atomic or successful. Per-release Python adoption, if selected,
must include its forwarding path in this same fenced conversion.

## 3. Commands and approval

Each runtime exposes `plan`, `upgrade <sha>`, `rollback [<sha>]` and `status`.
Only plan and status are read-only and require no operation approval. They must
not stop/start services, alter durable install records or send device commands.

Plan resolves a requested branch to a full merged SHA, then names installed and
running identities separately, the complete included commits and PRs when
available, changed components, exact configuration/state requirements, named units,
expected outage, backup scope, recovery procedure and rollback eligibility.
Unavailable comparisons remain unknown, never an empty change list. The
coordinating installer reviews the exact plan, target, baseline, configuration
and recovery sequence against the owner’s applicable authority. Existing scoped
standing authority satisfies the authorization checkpoint without a new human
approval; otherwise obtain authority for the named operation.
Canonical plan bytes and their SHA-256 bind all these inputs. Recheck them under
the lock; any changed input requires a new plan and authority assessment. Inputs
within standing scope need no renewed human approval; effects outside it need
additional authority. Plan must be run before an agent plans, performs or checks
an install/upgrade/rollback.

Status reports the installed link, running build, service state and merged main
separately. An inactive service has no current running-build claim. A failed
remote lookup means comparison unknown. Neither read implies installation success.
An explicit rollback selects a verified available compatible target; the default
selects the last successful recoverable release, not simply a directory by age.

## 4. Operation and recovery

1. Build and verify the exact target and dependency closure beside the running
   installation. Prove that the previous release can reopen everything the
   candidate can durably write: notices, acknowledgments, rules, settings,
   deduplication/event history and each owner's other state. Use format contracts
   and an isolated write/reopen recovery test. Format evidence compares the code
   and schemas that encode, decode or accept stored bytes, not whole packages;
   an unclassified file counts as durable. Unknown/incompatible rollback
   refuses before outage. There is no force flag; incompatible migrations require
   a separately reviewed procedure.
2. Acquire the installation lock; reject another active operation or unresolved
   intent. Recheck the approved baseline, configuration hashes, target and shared
   path map. Keep this lock through finalization and eligible pruning.
3. Atomically persist and fsync a schema-valid in-progress receipt before stopping
   anything. Quiesce every named writer, fence new admission where needed, stop
   units/workers and verify exit. The installation lock alone does not quiesce a
   database writer. For Nanoleaf, stop workers before acquiring their device locks.
4. Take a consistent backup of all named durable state and configuration, excluding
   sockets and transient runtime objects. Record its reference and verified hash.
   Never expose credentials in the receipt, logs or public evidence. If stop or
   backup fails, do not switch; report the observed service state and recovery work.
5. Atomically rename the staged current link on the same filesystem, fsync its
   parent, restart only the named units, and poll health within explicit attempt
   and elapsed-time bounds. Verify the process's target identity as well as
   operational health. A service-manager active flag alone is insufficient.
6. On candidate failure, stop it and verify exit, switch to the already-proved
   compatible previous release and restart. Reopen the latest durable state; never
   silently restore an earlier database. Verify recovery identity, health and state
   preservation before reporting `failed-rolled-back`. The original operation still
   failed. A failed or unverifiable recovery is `rollback-failed` or `interrupted`.
7. Atomically persist/fsync the final receipt, including parent-directory durability,
   before returning success or pruning. A final-write failure returns failure and
   emits the attempted `receipt-finalization-failed` document to an explicitly named
   diagnostic channel if possible. The on-disk receipt may still be in-progress;
   do not pretend it contains the failed write. Inspect actual link, processes and
   state before any owner-approved recovery. Never blindly repeat the operation.

Backup restoration is a distinct owner-reviewed recovery procedure; it must
account for newer writes and potential data loss. It is not automatic rollback.
Recovery cannot claim that state was preserved from a backup hash alone.

### Consumer acceptance matrix

| Boundary | Required fake/source evidence | Required installed evidence |
| --- | --- | --- |
| Provenance and staging | Dirty/unknown source, tampered archive/manifest/dependency, traversal/link escapes and conflicting same-SHA bytes refuse | Exact approved source/archive and installed manifest |
| Compatibility | Target writes all supported durable record kinds; previous reopens them; unknown/incompatible refuses with zero stops | Qualified formats and actual recovery retaining newer records |
| Approval/lock | Baseline/config/link drift, concurrent invocation and retained interrupted intent refuse before outage | Exact owner, plan hash, named units and unchanged protected paths |
| Backup and switch | Stop timeout, backup failure, every migration boundary and switch failure leave truthful receipts | Verified writer exits and consistent durable backup |
| Health/recovery | Bounded timeout, wrong running identity, failed restart and failed rollback produce distinct failures | Running identity, operational checks and preserved state; legacy process/artifact proof where needed |
| Finalization/retention | Disk failure after healthy restart returns failure with no prune/replay; current plus three previous successful owned releases retained; referenced/legacy/history protected | Durable schema-valid receipt, readback and owned retention only |

Hub health includes expected state owner, collector running, admission open,
launch socket ready and served dashboard assets. Nanoleaf checks every bridge
process's start time/identity, wall `/` and `/api/state`, and controller identity.
Pixoo checks build/health and device reconnect through its existing controller;
startup restore can change the display, so its live checkpoint needs device
permission. Fake service tests establish no physical accuracy.

## 5. Retention

Keep the current release plus the previous three successful releases. Prune only
owned, unreferenced release directories after verified upgrade success and a
durable final receipt. A recovery target referenced by an unresolved operation,
current link or approved recovery plan is not eligible. Never prune legacy copies,
receipts, backups, historical installation directories or another runtime. Refuse
rollback to a missing or incompatible target; do not fetch/guess a replacement.

## 6. Receipt fields and outcomes

Store one private JSON document per operation at `<project state>/receipts/`.
All fields below are required; explicit null means evidence not established at
that phase. Unknown properties are rejected. UTC times use second precision
`YYYY-MM-DDTHH:mm:ssZ`; updated time cannot precede start, and a terminal completed
time equals updated time. Validators also reject invalid calendar dates.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `install-receipt/1.0` |
| `operationId`, `operation` | Unique safe identifier and `upgrade`, `rollback` or first-adoption `migrate` |
| `runtime`, `installationId` | `hub`, `nanoleaf` or `pixoo`, plus a neutral configured installation ID |
| `startedAt`, `updatedAt`, `completedAt` | Operation times; null completion for intent/interrupted/unfinalized outcomes |
| `requestedTarget` | Original request, retained even if it cannot be resolved |
| `previous`, `target` | Verified release or legacy identity, or null while unverified; upgrade/migrate targets cannot be legacy |
| `approval` | Plan, installed-baseline inventory and configuration SHA-256 hashes; the private plan holds full approval context |
| `compatibility` | `compatible`, `incompatible` or `unknown` plus evidence reference; compatible needs evidence |
| `backup` | Consistent backup reference and SHA-256, or null before it exists |
| `running` | Observed identity, verification method (`build-health` or `legacy-process-artifacts`) and evidence reference, or null |
| `health` | `not-checked`, `healthy`, `unhealthy` or `unknown`, with evidence for checked results |
| `failure` | Failure phase, bounded safe code and optional evidence reference; null only for intent/success |
| `rollback` | Recovery status `not-attempted`, `succeeded`, `failed` or `unknown`, plus evidence |
| `statePreservation` | Strategy `latest-durable-state` and evidence; never a pre-upgrade snapshot restore |
| `outcome` | One of the mutually distinguished outcomes below |

A release identity includes `kind:"release"`, `sourceRevision`, `version`,
`archiveSha256` and `manifestSha256`. A legacy identity uses the shape in section 1.
Verified does not mean self-asserted: the command must retain the supporting
provenance, hashes and inspection evidence outside public Git.

| Outcome | Required meaning |
| --- | --- |
| `in-progress` | Durable intent, verified target/previous, approval and compatibility; no completion or success claim |
| `succeeded` | Healthy running target, backup, compatibility and state evidence; no failure or automatic rollback |
| `refused` | Preflight/staging/intent refusal, no switch, backup or target-health claim; target may be null |
| `failed-before-switch` | Stop/backup/proven-unswitched failure; no automatic rollback claim; service state needs inspection |
| `failed-rolled-back` | Candidate failed; previous identity is now observed healthy with recovery and state evidence |
| `rollback-failed` | Recovery failed or could not be verified; no healthy completion claim |
| `interrupted` | Incomplete operation/recovery requiring inspection; no terminal completion time |
| `receipt-finalization-failed` | Attempted final write failed; diagnostic receipt is not proof that the durable file changed |

For an explicit `rollback`, the selected older release is `target`, the release
being left is `previous`, and ordinary success is `succeeded` with automatic
`rollback.status:"not-attempted"`. If that attempt fails and safely returns to the
release being left, it is `failed-rolled-back` like any other failed switch.

`validateInstallReceipt(value)` and Python `validate_install_receipt(value)` check
schema shape, calendar/order constraints and identity equality: success must match
target; recovered failure must match previous. JSON Schema alone cannot compare
arbitrary fields, so consumers must use the full validator or equivalent checked
semantics. No validator checks a host, token, filesystem, service or device.
Receipt evidence references remain private; never embed raw credentials or tokens.

## 7. Running build

Health exposes `build: {sourceRevision, version}` without paths, host details or
secrets. Load it once from the process's own release at startup. Missing, malformed
or untrusted provenance gives `sourceRevision:"unknown"`; unavailable version is
`"unknown"`. A later file/current-link change cannot relabel the old process.
Preserve existing health failures and read authorization. The diagnostic mapping
is `service.version` and optional `bunny.build.revision`; omit the latter for unknown.
This is distinct from agent-state's state `sourceRevision`.

## 8. Authority

Every mutating command needs applicable owner authority: a scoped standing
authorization, checkpoint approval or an explicit request naming the operation.
The procedure does not grant that authority itself. Under standing authority, the
coordinating installer completes the checkpoint without requesting approval again.
The checkpoint identifies the installation owner, exact target and complete change bundle, baseline/configuration, outage, migration,
recovery and any startup device effects. Changed inputs require replanning.
Commands send no device commands and do not change credentials, hooks, `host.json`,
shared Node, host services or boot settings outside named scope. Routine upgrades
leave units and stable paths unchanged. Pixoo's separately scoped first adoption
can repoint its unit once, verify it and reload the user daemon.

## 9. Declaration for agents

Each consumer adds this template, with concrete local commands and one procedure
pointer, to its root AGENTS.md runtime-boundaries section when its command is
delivered. This contract does not add a pointer to a command that does not yet exist.

```text
Installation: a merged change to <installed runtime source> is complete only
after <upgrade command> installs it on the owner's installation and its receipt
passes, unless the issue marks the change source-only with a reason and links
the install issue that batches it; report overall delivery as installation pending.
After merge and post-merge CI, review the exact plan and execute under the owner’s
applicable authority. Existing scoped standing installation authority needs no
renewed approval. Verify running identity, health, state preservation and durable
receipt; a schema-valid receipt alone is insufficient. Before planning, running
or checking an install, upgrade or rollback, read <procedure doc>#<section>
and run <plan command> first.
```

Keep completion and authority inline at the root. CLAUDE.md imports `@AGENTS.md`.
Do not put install rules only in nested instructions: root-launched tasks must
find them. Put operational detail in one local procedure; docs/sdlc.md links to it
without restating it. That procedure pins this contract's commit. Command tests
must enforce clean source, hash checks, lock, compatibility and recovery; prose
alone does not enforce them.

Instruction review covers ordinary runtime delivery (review and execute the plan
after merge and CI under existing scope), source-only delivery (retain the batching
link and pending installation), direct installation (read procedure and plan before
mutation), and rollback (same exact-plan and authority check).
Source checks do not claim fresh Codex/Claude host loading or live acceptance.

## Historical receipt mapping

The inspected gh417 and gh355 receipt structures predate this schema. This table
maps every source field without publishing private values or converting old
records into invented valid successes. Preserve the originals unchanged.

| Historical fields | Destination or limitation |
| --- | --- |
| `installedAt` (both) | Evidence for observation time, not proof of start/completion boundaries |
| `issues` (both), `pullRequest` (gh355), `alsoInstalledSince0_3_8` (gh417) | Private approved plan's complete-change/provenance evidence; not operation identity |
| `hubSource`, `hubVersion`, `hubArchiveSha256` (both) | Candidate `target.sourceRevision`, `version`, `archiveSha256`; full trusted SHA and manifest digest must still be verified |
| `previousHub.version`, `.source` (both) | Partial previous identity; no invented missing SHA/hash |
| `previousHub.backup` (both), `.alsoKeptAt` (gh355) | Recovery references; not proof of consistent backup, digest or compatible reopening |
| `configChange` (both), `hostJsonUnchanged` (gh417), `hostJsonSha256` (both) | Configuration evidence in the plan; a single file hash alone is not the full approved configuration/baseline |
| `checks.release` (both), `dashboardBundleSha256` (gh355) | Archive/served-artifact evidence; not proof of a restarted running identity |
| `checks.before.revision`, `.sessions`, `.panelsIntegration`, `.panelsError` (gh417) | Before-state/health evidence, kept private |
| `checks.after.revision`, `.sessions`, `.panelsIntegration`, `.panelsConfiguration`, `.panelsNamedScenes`, `.wallIntegration`, `.wallConfiguration` (gh417) | After-state/health evidence; each configuration object contains `settings.set`, `elements.assign`, `task.assign`, `project.color`; these do not establish all current-state preservation |
| `checks.dashboard` (gh417), `checks.after`, `checks.browser` (gh355) | Health/UI evidence; no assumed target process identity |
| `credentials` (gh417) | Historical hygiene statement only; never copy credentials into a receipt |
| `procedure`, `pending` (gh355), `rollback` (both) | Procedure, limitations and recovery instructions, not observed rollback success |
| Missing in both | Schema/operation/installation identity, complete timestamps, manifest hashes, approval/baseline binding, tested compatibility, consistent backup hash, verified running identity, typed failure/outcome and observed rollback/state-preservation proof |

## Packaging and adoption

Run the shared checks in [development](development.md#controller-contract-checks).
The archive ships this document, schema, shared fixtures and both validators.
Record the merged source SHA, archive/manifest hashes and release asset identity
outside the source commit. Publish only after the owner confirms receipt fields,
shared ownership map and declaration, and after independent review and applicable
PR/merged-main CI. Download the published asset and verify its hash and manifest
before recording it for downstream pinning. Publication changes no installation.
