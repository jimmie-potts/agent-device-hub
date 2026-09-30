## Purpose

Provide an explicit trusted host route for disposable application verification when a development session cannot observe or operate the host directly.

## ADDED Requirements

### Requirement: Explicit named operation routing
The dispatcher SHALL require explicit host selection, a supported application and an absolute assigned checkout, and SHALL invoke only its existing verification entrypoint without shell interpretation. It SHALL reject unsupported operations and missing entrypoints before starting a unit. It SHALL use an explicit minimal environment rather than inheriting caller or manager secrets.

#### Scenario: Separate candidates
- **WHEN** two coordinators select different worktrees
- **THEN** their commands use their selected real checkout paths and distinct transient command units; preview identity remains the owning adapter's result

#### Scenario: Invalid or denied launch
- **WHEN** explicit host selection is missing, the operation is unsupported, or manager access is unavailable
- **THEN** the dispatcher returns a non-success JSON outcome and starts no command unit

### Requirement: Command lifetime and preview lifetime are separate
Every host command SHALL have a bounded supervisor lifetime and an exact unit identity announced before launch. The dispatcher SHALL read back command-unit cleanup without stopping preview units merely because an operation ended. A failed, interrupted or unobservable command SHALL never be reported successful and SHALL never be retried automatically.

#### Scenario: Successful operation
- **WHEN** the adapter returns a JSON result with exit zero and command-unit cleanup is verified
- **THEN** the dispatcher returns that result in a host-route envelope and leaves any preview under its existing lease

#### Scenario: Interrupted start
- **WHEN** a command times out or its caller is interrupted before its outcome is known
- **THEN** it stops only the exact command unit, reports uncertainty and any received adapter result, and instructs the coordinator to reconcile owned previews before retrying

#### Scenario: Unreadable cleanup
- **WHEN** the manager cannot verify that the command unit is gone
- **THEN** cleanup is unknown and the command cannot report success even if the adapter emitted successful JSON

### Requirement: Host authority is disclosed
The setup contract SHALL identify host operations as Linux-user execution outside Codex's sandbox, with no claim that denied paths constrain host code. It SHALL document setup, readback, exact owned cleanup, rollback and the supported coordinator matrix without claiming fresh-client qualification.

#### Scenario: Source delivery
- **WHEN** the source launcher is delivered
- **THEN** personal configuration, fresh Desktop/CLI/exec sessions, live listener ownership, Windows handoff and parallel acceptance remain separately qualified; delegated workers and reviewers do not gain direct launch authority
