## Context

See [proposal.md](proposal.md) and Hub #794. A design is required because this change alters the recovery qualification that runs before an outage.

`qualifyCompatibility` runs from the installer checkout. It first requires one durable fingerprint across the installer, the retained previous release and the staged target, and refuses with `durable-implementation-unqualified` on a mismatch or `durable-implementation-unavailable` when a file cannot be read. It then runs `install-compatibility-probe.mjs` in separate processes: the target writes synthetic state into a fresh private directory and the previous release reopens it, compares every record and confirms that consumed events produce no repeated fake effects. `executeOperation` calls qualification before intent and stop, so every refusal leaves the service untouched.

These facts from the current source shape the narrower surface:

- All agent-state durable bytes pass through `HubStorage` in `apps/hub/src/storage.ts`. Its `load` and every `commit` run agent-state `validateExport` on the complete state before reading it back or writing a payload. The automation tables use the same connection through `AutomationStore`.
- `validateExport` (exported again as `migrateExport`) lives in agent-state `validation.ts`. It applies the `durable-v1`, `durable-v2` and `durable-v2.1` schemas, uses `identityKey` from `memory-storage.ts`, and checks stored identities, turns, parents and ordering through lifecycle `validateEvent` with `apiVersion: '1.0'`. The same module also compiles the snapshot schemas for `validateSnapshot`.
- Hub `automation.ts` validates stored rules and settings with the `common.ts` validators and lifecycle `validDisplayText`, whose pattern comes from `lifecycle-v1.1.schema.json`.
- Agent-state `index.ts` coordinates ingestion, snapshots, retention and the open path, and builds the states it commits. `reducer.ts`, `retirement.ts` and `types.ts` (including `VERSION` and `LIMITS`) decide content, and `providers.ts`, `metadata.ts`, `subscriptions.ts` and `children.ts` never touch storage. Agent-state releases bump `VERSION` in `types.ts`, as #690 did.

## Goals / Non-Goals

**Goals:** admit reducer, provider, snapshot, coordination and lifecycle changes that leave stored state unchanged; refuse every change to the code or schemas that encode, decode or accept stored bytes; fail closed for unclassified files; strengthen the probe for the current stored metadata.

**Non-Goals:** a stored-format migration procedure, semantic equivalence proofs, a force flag, refactoring agent-state or Hub storage, and any change to receipts, plan digests, provenance inventories, or health and identity checks.

## Decisions

### Durable surface

The fingerprint hashes these files, ignoring file modes as before:

| Location | Durable files | Why |
| --- | --- | --- |
| Hub `dist/` | `storage.js`, `automation-store.js`, `automation.js`, `common.js` (required) | SQLite layout, load and commit validation, automation tables, defaults and stored-row validation. `common.js` holds the identifier and object validators that `automation.js` applies to stored rows; #718 omitted it |
| Hub `dist/` | Any other `.js` that imports `node:sqlite`, except `install/state.js` and `migration-routes.js` | Fail closed for a new storage module. The two exceptions are the installer's read-only state capture and the migration lease file, and neither opens monitor state for writing |
| agent-state `dist/` | Every `.js` except `index.js`, `reducer.js`, `retirement.js`, `types.js`, `providers.js`, `metadata.js`, `subscriptions.js` and `children.js`; today that leaves `validation.js` and `memory-storage.js` (both required) | The durable validator and the identity key it applies. An unclassified module counts as durable |
| agent-state `schemas/` | Every file except `snapshot-v<version>.schema.json`; today `durable-v1`, `durable-v2` and `durable-v2.1` (`durable-v2.1` required) | Stored-state schemas. Snapshot schemas describe an outbound projection and are never stored. Any other or new file, such as `durable-v2.2.schema.json`, counts as durable |
| lifecycle `dist/` | Every `.js` except `index.js` | `index.js` is versioned envelope validation, covered by the frozen schemas below; an unclassified module counts as durable |
| lifecycle `schemas/` | Every file except `lifecycle-v<version>.schema.json` versions other than 1 and 1.1; today `lifecycle-v1.schema.json` and `lifecycle-v1.1.schema.json` (both required) | The published 1.0 grammar that `validateExport` applies to stored identities, and the 1.1 display-text pattern that stored automation text uses. A new lifecycle version is a wire change |

Declaration (`.d.ts`) and source-map (`.map`) files are excluded because Node never loads them. Directory entries are excluded; links are kept, so an unexpected link still changes the fingerprint. A missing required file, a missing package or an unreadable file raises `durable-implementation-unavailable`.

`validation.ts` mixes durable validation with snapshot validation. It stays durable, so a snapshot-validation edit inside it still refuses. A release that needs new snapshot validation must put it in a new module and classify that module as non-durable in `compatibility.ts`, where review sees the change. Splitting `validation.ts` now would itself change the surface and could not pass this gate.

### Why coordination and content modules are outside

The Hub storage adapter re-validates the complete next state with `validateExport` before every write. A target whose storage adapter, validator and stored-state schemas are byte-identical to the previous release's can therefore write only bytes that the previous release's validator accepts. `index.ts`, `reducer.ts`, `retirement.ts` and `types.ts` choose which valid state to write, but they cannot widen the format. In a rollback, the previous release opens the store with its own `index.ts`. This puts `index.ts` in the same class as the reducer, which the owner chose to admit. `index.ts` also holds the snapshot projection that #784 extends, and `types.ts` holds the `VERSION` constant that agent-state releases bump, so hashing either would refuse nearly every agent-state change.

Three checks still cover these modules. The probe runs their write paths in the target and their open path in the previous release, including owner and consumer checks, labels, notices, acknowledgments, attention, retirement, metadata and a known parent. Before any success receipt, the operation's state-preservation check rejects lost unexpired records or backward revisions from the started target. Agent-state's own suites cover the rest.

Alternatives considered: hashing `index.js` and `types.js` as mixed modules is stricter, but it refuses ordinary reducer releases because of the `VERSION` bump and refuses #784's snapshot change. A refactor that moves durable code out of `index.ts` and `validation.ts` changes the surface it defines, so it could not be installed through this gate. Hashing the lifecycle `index.js` would refuse every additive lifecycle version. Hashing individual functions would be fragile.

### Probe coverage

The synthetic write now starts the main session with a lifecycle 1.1 title, project and project ID. It then adds a child session with a known parent and an agent-origin label, and asserts that title, project, project ID, `labelOrigin` and `metadataObservedAtMs` were written. The reopen compares the complete export as before. The qualification's `records` list adds `metadata` and `parents`. A target whose reducer leaks a field into a session fails at the target write, because the shared storage adapter rejects the commit. Without that adapter it would fail at the previous reopen. Either way the result is `durable-reopen-probe-failed` before stop.

### Acceptance examples

These are encoded in `apps/hub/tests/install-compatibility.test.mjs` and run against copied releases in both upgrade and rollback directions where they pass:

1. A target that edits `reducer.js`, `index.js`, `types.js` (`VERSION`), lifecycle `index.js` and a snapshot schema, and adds `lifecycle-v1.2.schema.json` and `snapshot-v1.3.schema.json`, is `compatible` with probe evidence.
2. A newline in `durable-v2.1.schema.json`, a new `durable-v2.2.schema.json`, an unclassified schema file or an edited `lifecycle-v1.schema.json` refuses with `durable-implementation-unqualified`.
3. An edit to any Hub storage module including `common.js`, to `validation.js` or to `memory-storage.js`, a new unclassified agent-state module or a new Hub SQLite module refuses with `durable-implementation-unqualified` without executing the changed code.
4. A target whose reducer stores an extra session field when a title arrives fails with `durable-reopen-probe-failed`. Before this change, the probe had no title event, so it never reached that path.
5. A missing agent-state package, Hub storage module, `validation.js` or lifecycle 1.0 schema refuses with `durable-implementation-unavailable`.

`apps/hub/tests/install-operation.test.mjs` feeds real qualification results for examples 1 to 5 into `executeOperation`. Example 1 succeeds; the others end `refused` with no service effect, and the evidence file carries each qualification result.

### Failure and recovery

Nothing new runs after stop. Every refusal still happens during qualification, before intent, with the existing reason codes and a `refused` receipt. The operation's evidence file previously recorded the qualification result only on success. It now records it before the status check, so a refused receipt's `install-rollback-unqualified` failure pairs with the specific reason in `observations.compatibility`. The receipt itself is unchanged. A change to the durable surface still needs a separately reviewed stored-format procedure. Rollback operations use the same rule in the reverse direction.

## Risks / Trade-offs

- A content module can change meaning within the same format, for example by reusing a field value differently. Schema equality cannot detect that. The risk matches the owner-accepted reducer risk and is mitigated by the probe, state preservation and package suites.
- Lifecycle `index.js` is outside the surface, so an edit that changes how it accepts version 1.0 envelopes is trusted to the frozen-version contract fixtures and to the probe's known-parent record. Edits to the 1.0 and 1.1 schemas still refuse.
- Configuration such as the consumer list comes from Hub `server.ts`, which neither the previous nor this fingerprint covers. The probe fixes its own consumers, so this limitation predates the change.
- The Hub SQLite discovery is a static import check. A new module that stores durable state without SQLite would not be detected. Durable monitor state has one adapter today, and review must classify any new one.
- `ajv` and Node versions are not fingerprinted, as before; dependency inventories and the probe cover them.
