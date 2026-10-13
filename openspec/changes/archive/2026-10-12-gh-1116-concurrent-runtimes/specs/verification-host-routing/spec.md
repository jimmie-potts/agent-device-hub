## MODIFIED Requirements

### Requirement: Explicit named operation routing
The dispatcher SHALL require explicit host selection, a supported application and an absolute assigned checkout, and SHALL invoke only its existing verification entrypoint without shell interpretation. It SHALL reject unsupported operations and missing entrypoints before starting a unit. It SHALL use an explicit minimal environment rather than inheriting caller or manager secrets. It SHALL NOT set `APP_VERIFY_SINGLE_RUN` or impose a replacement run-count limit or capacity-qualification gate.

#### Scenario: Separate candidates
- **WHEN** two coordinators select different worktrees
- **THEN** their commands use their selected real checkout paths and distinct transient command units; preview identity remains the owning adapter's result

#### Scenario: Invalid or denied launch
- **WHEN** explicit host selection is missing, the operation is unsupported, or manager access is unavailable
- **THEN** the dispatcher returns a non-success JSON outcome and starts no command unit

#### Scenario: Concurrent runtime launches
- **WHEN** a task starts a runtime through the host route while another task's simulated runtime is live
- **THEN** concurrent presence alone does not cause `run-active`, the selected candidate starts with its own preview identity and leased lifecycle, and command cleanup leaves the other task's run untouched

