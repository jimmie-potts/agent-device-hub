# Optional packaged maintenance design

## Scope decision — 2026-10-28

The owner narrowed [#1167](https://github.com/jimmie-potts/agent-device-hub/issues/1167)
to the accepted manual Mac setup. Use the [container operator guide](bunny-container.md)
for normal operation: stop and confirm, back up, replace the reviewed image and
matching scripts, then start and check. Preserve private data and the existing
writer-exclusion checks. The operator must keep competing maintenance and restart
actors out of the window and inspect an interrupted operation before continuing.

Installation without a checkout, generalized update commands, the persistent
maintenance gate, prepared-release binding and further Windows/AMD64 installation
qualification are optional future work. They are not completion requirements for
the personal Mac setup. Existing AMD64 code and evidence remain retained.

The design below is historical reference, not a selected implementation plan or
an operating procedure. Its mandatory wording describes the proposed guarantees
only if that design is selected again. The manual profile does not promise a
durable crash-surviving maintenance gate or refusal of every stale release start.
Reassess a concrete maintenance problem before selecting additional machinery.
Backup/restore and cross-host migration retain their separately selected scope;
closing #1167 does not claim those outcomes.

## Retained design — 2026-10-21

Previously selected design for #1167 and #1168. This replaces the earlier container
startup proposal's descriptor transfer and completion handshake. The persistent
pending gate and prepared-release binding below remain deferred design work.
They are not the protocol used by the delivered reduced container operator, and
this document supplies no commands to run against an installed system.

Use the [container operator guide](bunny-container.md) for the accepted Mac-local
profile and the separate [upgrade procedure](../apps/runtime/UPGRADE.md) for the
established WSL installation. The delivered operator already provides manual
start/stop/status, stopped-volume backup and separate empty-target restore. Its
current restrictions and qualified evidence remain authoritative. Do not require
the deferred machinery below merely to operate that accepted profile, or treat
its bounded acceptance as completion of the broader lifecycle design.

If this optional work is selected, update the owning spec and pass focused
safety review/tests. GitHub owns delivery status and the remaining acceptance.

## Scope and tradeoff

One operator maintains one selected installation during an explicit downtime
window: stop, back up, replace, start and check. Follow
[ADR 0008](decisions/0008-runtime-hosting.md): the Mac Mini running Linux ARM64
on Docker Desktop is primary and must operate with the PC off. Windows Docker
Desktop is a separately qualified Linux AMD64 alternate, not an intermediate
production release. Preserve the selected two-architecture image family and
both-host obligations without adding an engine matrix. Support for each operation
requires its actual locking, storage, shutdown and restore evidence; source
checks or a successful browser slice do not qualify every host capability.

No seamless upgrade, automatic rollback, automatic maintenance resumption,
permanent supervisor, new native descriptor-transfer shim or cross-container
startup acknowledgement protocol. The cost is downtime and operator inspection
after an interruption. Source work does not authorize a live maintenance window,
new credential, host configuration, migration or device handoff.

## Two protections with different jobs

The existing runtime writer lease protects state. Every supported startup must
acquire it in the runtime process before opening/migrating stores, writing traces,
listening or starting module/device activity. Hold it until all writers stop or
the process exits. Core/module teardown cannot release it while another writer
is still running; a timeout is not proof of shutdown. No lease transfer between
processes is needed. Stopped-state tools use the same lease.

A private persistent **maintenance pending** record blocks new startups across
operator steps and process/host crashes. It identifies the installation, operation,
selected release and current maintenance phase. Short maintenance commands take
the existing installation lock, validate the record and durably write their
transition before releasing that lock. The record remains between commands;
there is no requirement to keep one flock description alive across replacement.
A competing operation cannot adopt or overwrite it. Runtime startup acquires the
writer lease, then checks the record before any mutable startup work; pending,
malformed or ambiguous maintenance refuses startup. Under that same lease, it
compares its actual release/config/state identity with the durable prepared
selection. Missing or mismatched selection refuses startup, including an old
container started after replacement. First installation must prepare this binding
explicitly; absence is never a compatibility bypass.

The maintenance record is installation metadata, outside the state snapshot being
restored. Restore cannot erase it or replace the installation lock inode. State
and installation identity must match; another copied volume is a different
installation, not a way to take over the live device writer.

This is a planned startup gate, not a claim about current source behavior.
`requireUpgradeLock` checks descriptor identity; a helper must still acquire the
actual flock. The runtime data lease is a separate SQLite lock. Keep both checks
in their owning implementation rather than inventing a second lock service.

## Operator sequence

1. **Prepare.** Identify the exact installation, current container/process and
   release, target image digest/architecture, private configuration and volume.
   Validate compatibility and the supported host. Exclude source/previews and
   automatic restart/update actors for this maintenance window. No live device
   ownership transfer is implied. Take the installation lock and persist the
   pending record before issuing a stop; another operation now refuses.
2. **Stop.** Ask the host manager to stop only that pinned runtime. Confirm the
   process and its writers have exited; then a maintenance helper acquires the
   data lease. Do not infer exit from a timeout, inactive label or lost response.
   Pending maintenance prevents a new ordinary start from reaching state even
   during the gap between host stop and lease acquisition.
3. **Back up.** With both locks held for this command, copy the complete selected
   stopped-state inventory: module databases and required sidecars, private
   assets/media and configuration, including retained inactive data. Verify the
   private backup before changing the selected release. Explicitly record
   external credential/path dependencies; do not copy secrets or source folders
   implicitly. #1168 owns exact inventory and restore compatibility. Partial
   export never counts as a backup. Leave originals intact on failure.
4. **Replace.** Under the locks and the same pending record, select only the
   verified release. Record the prepared release/config/state identity. The
   application stays stopped. No state conversion by an unqualified older reader;
   unknown recovery eligibility does not bar an otherwise valid forward update.
5. **End maintenance.** In an explicit command, reacquire both locks, confirm the
   prepared identities and all prior host requests have known terminal outcomes,
   and synchronize/read back the prepared record. Clear the pending gate durably
   while still holding the data lease, then release the locks. A subsequent
   startup can acquire the data lease; none can write while the helper owns it.
   Gate removal only permits a start. It never records that startup succeeded.
6. **Start and check.** Operator starts the exact selected release. It acquires
   the data lease, checks maintenance and validates its actual release/config/state
   against the prepared selection before mutable work. Use existing
   authenticated build identity and `/api/runtime/v1/health`, including required
   module status, to verify this instance. Optional sources report unavailable
   or stale independently. Record observed success, failure or uncertainty; no
   completion signal to a helper or special gateway bypass is needed.

All maintenance helpers access the same qualified local Linux filesystem and
lock domain. A Mac host-side lock does not substitute for a lock inside the Linux
volume. The implementation chooses a short-lived helper/host command adapter for
the selected engine, without mounting a Docker socket in the application or
broadening privileges. Pin engine/container identity before every engine action.
Automatic restart stays disabled for the initial packaged candidate; the existing
installed service policy is unchanged. Adding automatic restart later must retain
the maintenance gate and receive focused qualification.

## Races and interrupted work

If startup acquired the data lease before maintenance was recorded, maintenance
must stop that runtime and acquire the lease before touching state. If startup
acquires it afterward, it sees pending maintenance and exits before effects.
The pending gate is cleared only with the data lease held. Thus neither a startup
race nor a second helper can overlap stopped-state work with runtime writes.

If the operator/helper dies, leave pending maintenance and all backups/latest
state intact. A later process may acquire a released kernel lock; that does not
clear the persistent record. Inspection names the installation and operation,
checks actual processes, the selected release, state and last completed step,
and chooses the next explicit step. No automatic retries, resume or restoration.

A lost engine response is uncertain. Fence the original management process and
establish that every admitted engine request is terminal before new effects or
gate clearing. Killing a client, waiting or seeing a stopped container cannot
prove that a delayed request will never execute. If this cannot be established,
keep maintenance pending and report the concrete manual recovery needed. Do not
add a general engine cancellation framework or kill an unrelated process.

Persist transitions with the existing private-file validation, synchronization
and readback pattern. Complete visible bytes alone do not prove durability after
a writer crash: a successor validates and resynchronizes the exact record and
its directory before using it. Missing or inconsistent prerequisite evidence
requires inspection. Crash before durable gate clearing may leave maintenance
pending again; it must never invent a healthy startup. A crash after clearing
but before start leaves a prepared, stopped installation that may be started
explicitly after inspection. The gate is not an automatic recovery mechanism.

A failed new runtime stops or remains accurately unhealthy; inspect before any
retry. Prefer fixing forward. Returning to an older release requires proven
latest-state compatibility. Restoring a snapshot requires the owner's explicit
choice, preserving failed latest state separately and reporting the data gap.
No previous device commands are replayed and no local collector is auto-activated.

## Focused evidence before shipping

Use synthetic stores and simulated transports first. Cover:

- A stale previous-release start after maintenance clears: refuse before opening
  newer stores, even if it is the only lease contender.
- Two simultaneous starts and two maintenance attempts: at most one state writer;
  pending maintenance refuses startup before mutations or device effects.
- Stop timeout, a slow module and a lost/delayed engine response: no copy, release
  switch or gate clearing while a writer/request may still act.
- Helper/process interruption before and after backup, release selection and gate
  clearing: preserve latest state and an inspectable phase; no automatic replay.
- A complete record visible before directory synchronization: repeat persistence
  safely, without manufacturing a successful step or starting a process.
- Incomplete backup, committed WAL data, missing assets, unsafe permissions,
  mismatched release/config/state identity and an incompatible older reader.
- Successful manual replace/start, failed startup and an unavailable optional
  source, with truthful build/required-module evidence.

Reuse existing storage/upgrade tests and the ordinary health/authentication
contracts. The new gate needs meaningful race/failure regression tests, a focused
independent safety review and an operator walkthrough in a disposable installation.
Source tests do not qualify engine locking or either real host. Keep actual-host,
installed and physical acceptance separate. No exhaustive outage matrix, new
telemetry platform or additional acknowledgement/receipt protocol is required.
