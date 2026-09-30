## Purpose

Let development coordinators inspect the local requirements for app previews while keeping untested runtime and browser capabilities explicit.

## ADDED Requirements

### Requirement: Read-only prerequisite inspection
The shared CLI SHALL expose `prerequisites`, listed in help, and SHALL report local platform/runtime, supervisor visibility, storage-root admissibility, tooling, app build and capture dependencies. It SHALL create no run/state/unit, bind no socket, launch no browser, install nothing and contact no application/device endpoint. It SHALL NOT call build preparation, seeding, launch, health or boundary callbacks.

#### Scenario: Available local requirements
- **WHEN** the local requirements are present
- **THEN** the result identifies those observations and still leaves actual writes, host launch, loopback/listener ownership, browser/video execution and Windows handoff unproven

#### Scenario: Missing requirement
- **WHEN** supervisor access, a storage root, a tool, build or browser dependency is missing
- **THEN** the result names the missing capability and a next action, rather than presenting successful launch readiness

### Requirement: Evidence and phases remain distinct
Checks SHALL report `present`, `missing`, `unknown` or `unsupported`, with separate launch, capture and handoff summaries. Permission heuristics SHALL NOT prove writes. Exceptions or absent adapter observations SHALL NOT become successful evidence or reveal raw private errors.

#### Scenario: Denied root
- **WHEN** filesystem access checking refuses the runtime or proof parent
- **THEN** the diagnostic identifies the affected root and preserves the distinction between an access-check refusal and a performed write

#### Scenario: Unread build or host evidence
- **WHEN** an adapter has no read-only build observer or host evidence cannot be obtained
- **THEN** the affected check stays unknown or unsupported and no qualified/ready runtime claim is emitted

### Requirement: Additive adapter and package compatibility
An optional adapter prerequisite hook SHALL be explicitly read-only and return validated capability checks. Existing adapters without it SHALL remain usable for existing operations. The package SHALL expose support through help and preserve receipt version. Older help without the new operation SHALL be recognized as unsupported, not interpreted as a passing diagnostic.

#### Scenario: Hub source build
- **WHEN** the Hub runs prerequisites against an absent or stale build
- **THEN** its source-build check identifies that condition without building

#### Scenario: Old consumer
- **WHEN** a pinned consumer's help lists no prerequisites operation
- **THEN** capability discovery returns unsupported and the caller retains the existing start-time checks rather than claiming diagnostic adoption
