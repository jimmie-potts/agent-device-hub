## ADDED Requirements

### Requirement: Qualified bounded batch deployment

The host operator SHALL consume only matching successful hosted qualification for an exact committed revision and immutable Linux ARM64 production image. It SHALL bind the selected project, previous and target identities, included issues, designated owner, focused storage assessment, required client checks and recovery decision to one private deployment record. It SHALL serialize deployment and manual maintenance, verify stopped writer exit, take and verify a consistent backup, preserve private volumes/configuration/network, select the image once and verify exact running identity, health and the selected read-only client path before success. The verified writer release SHALL be reusable without another conversational acknowledgment.

#### Scenario: Verified batch
- **WHEN** a matching qualified artifact is selected for the established owned target and its bounded checks pass
- **THEN** the private record identifies the installed revision/image, backup, checks and actual writer release without claiming physical acceptance

#### Scenario: Ineligible artifact or overlapping operation
- **WHEN** qualification is absent, failed, incomplete, wrong-revision or wrong-image, or another operation holds the selected project
- **THEN** promotion refuses before stopping or changing the selected runtime and preserves existing evidence

### Requirement: Inspectable failed and interrupted deployment

Each deployment SHALL durably record its intended phase before effects. Interruption, failed start or failed client verification SHALL preserve latest state and unfinished evidence, stop only the owned failed replacement where possible and report failed or uncertain outcomes honestly. New maintenance SHALL refuse unfinished deployment until an explicit reconciliation verifies actual state and records the result. Reconciliation SHALL NOT automatically resume replacement, clear a live owner's lock, retry, restore a snapshot or select an image.

#### Scenario: Interrupted or failed replacement
- **WHEN** replacement is interrupted or a selected check fails
- **THEN** the last intended phase remains inspectable, latest data is preserved, another operation refuses, and explicit reconciliation records actual identity and process state before releasing the hold

### Requirement: Explicit latest-state compatible image return

Returning to a previous image SHALL require explicit reader/configuration compatibility evidence bound to the latest stopped state and the exact previous image. Unknown, incompatible or stale evidence SHALL refuse return without deleting current data or restoring an older snapshot. Unknown recovery SHALL NOT by itself prevent an otherwise eligible forward deployment.

#### Scenario: Qualified previous reader
- **WHEN** the previous image has reopened the candidate's newly written disposable state and compatibility matches the latest stopped backup and configuration
- **THEN** explicit image return preserves that latest state and follows the same exclusion, identity, health and client checks

#### Scenario: Incompatible or unknown reader
- **WHEN** previous-reader compatibility is unknown, incompatible or does not match latest state
- **THEN** return refuses before image replacement while a separately eligible forward operation remains possible
