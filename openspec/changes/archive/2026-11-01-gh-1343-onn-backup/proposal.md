## Why

The production ONN configuration has three declared external host paths that the stopped-backup worker currently refuses. Issue https://github.com/jimmie-potts/agent-device-hub/issues/1343 repairs that conflict so a complete byte-exact backup can precede a qualified batch without editing the installed configuration.

## What Changes

- Classify only ONN's declared ADB socket, executable and key-directory fields as external host dependencies, without inspecting or copying them.
- Write backup manifest version 2 with explicit dependency descriptors and separate old-runtime/helper identities; retain version 1 verification semantics.
- Let an already-qualified candidate supply a fixed maintenance helper for the old stopped instance, using its existing state lease and exact mounts. Independently prove that candidate is an ancestor of authenticated pinned main before any artifact download or image load.
- Report allowlisted refusal codes and stages without raw errors or private paths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-container-operator`: complete ONN configuration backup, explicit external dependency inventory, versioned helper provenance and bounded refusal reporting.

## Impact

Backup/operator scripts, the qualified batch handoff, synthetic and disposable tests, container instructions and the current capability specification. ONN configuration and transport contracts are unchanged. Broader backup/restore obligations in #1168, installed snapshot restore, data transfer and physical device operations remain outside this repair.
