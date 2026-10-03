## Why

[Hub #472](https://github.com/jimmie-potts/agent-device-hub/issues/472) installation preflight found an additional inherited reader on the owner-selected Wispr source. The owner approved accepting that source's existing permissions instead of changing Wispr's ACLs; collector-created data must remain private.

## What Changes

- Accept additional ACL grants on the explicitly selected source and its SQLite sidecars without changing their permissions.
- Preserve source ownership qualification, local fixed-drive/path restrictions, explicit source binding and read-only access.
- Continue enforcing exclusive owner/SYSTEM/Administrators grants on collector configuration, retained state, backups and exports.
- Qualify the change with native Windows synthetic source-preservation and private-output rejection checks, and publish a distinct offline collector package.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wispr-collector`: distinguish accepted vendor-source permissions from the private collector-owned output boundary.

## Impact

Collector path qualification, native synthetic tests, package version and installation documentation. The shared aggregate contract and Hub APIs remain compatible. Installation, live collection, language collection and Hub sharing retain #472's separate authorization and acceptance checkpoints; no Wispr permissions, settings or records are changed.
