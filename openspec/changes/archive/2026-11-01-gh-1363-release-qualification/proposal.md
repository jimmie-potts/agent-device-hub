## Why

[Issue #1363](https://github.com/jimmie-potts/agent-device-hub/issues/1363) separates integrated source from an installable release. A qualification result must identify one committed revision and its exact Linux ARM64 production image.

## What Changes

- Add a manually selected qualification workflow that reuses the existing full Checks and Workflow coverage.
- Produce a production image archive and a closed evidence document bound to source, evaluation inputs, run, attempt and applicable jobs.
- Exercise the production image's test derivative with the existing scenario and browser catalog, including negative controls.
- Reject incomplete or mismatched promotion evidence and retain failed outcomes without touching an installation.

## Capabilities

### New Capabilities

- `bunny-release-qualification`: Pinned release candidates, packaged-image coverage and verifiable promotion evidence.

### Modified Capabilities

None.

## Impact

Existing GitHub Actions gain reusable entrypoints without changing their current automatic gates. New scripts and synthetic tests own release evidence. No runtime wire contracts, storage, installed clients or device permissions change.
