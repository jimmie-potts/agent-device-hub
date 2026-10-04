## Why

[Hub #734](https://github.com/jimmie-potts/agent-device-hub/issues/734) requires the installed native Codex executable to be fingerprinted before unattended intake and closeout. The executable exceeds the current 128 MiB buffered-read limit, so both paths refuse before invocation.

## What Changes

- Reuse the existing no-follow streaming hash helper for both maintenance fingerprint consumers, with a finite 512 MiB file bound and fixed memory use.
- Preserve private configuration/evidence read limits and refusal of unsafe files or mismatched hashes.
- Cover a sparse executable-sized fixture through both consumers, unsafe-file cases, and the extracted package.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `maintenance-intake`: qualify trusted executable fingerprints without loading whole binaries into memory.

## Impact

Maintenance storage/configuration and closeout fingerprinting, focused tests and the existing bundled package. Reuse `apps/hub/src/install/files.ts` without changing its default or installer behavior. Dotfiles' stdin/response contracts, collection, scheduling and runtime authority remain unchanged. Installation and real scheduled acceptance stay with #734.
