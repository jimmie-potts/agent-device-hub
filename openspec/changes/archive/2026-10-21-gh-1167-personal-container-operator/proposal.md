## Why

The owner selected a small personal-project container setup in
https://github.com/jimmie-potts/agent-device-hub/issues/1167 and
https://github.com/jimmie-potts/agent-device-hub/issues/1168: Mac as normal host,
Windows as an alternative, one active controller, persistent private state and
manual maintenance with downtime. Publish that bounded profile without the
earlier sealed-package/prepared-environment prototypes.

## What Changes

- Build one reviewed Node 24 container source for Linux amd64 and arm64 from an
  allowlisted committed-source context; preserve private named volumes.
- Add explicit start, stop, status, stopped backup and separate empty restore.
- Bind the existing SQLite state lease before container startup effects and keep
  rendition writes in the runtime parent, including cancellation and child exit.
- Retain the bounded synthetic source/authentication tests from #566.

## Capabilities

### New Capabilities

- `bunny-container-operator`: the manual container profile and private stopped
  backup/restore contract.

### Modified Capabilities

None. Existing runtime entrypoints and installed upgrade procedures remain
available; this profile does not replace their installation contract.

## Impact

Container/operator scripts, six shared runtime ownership/core bridge files,
the necessary Pixoo descendant-write correction, focused tests, CI registration
and operator instructions. Preserve current main's dashboard, dependencies and
workflow policy. No new database service, remote ingress, enrollment, automatic
handoff, migration or live device operation. Cross-architecture archive transfer
and live setup remain separate acceptance; broader issue outcomes remain open.
