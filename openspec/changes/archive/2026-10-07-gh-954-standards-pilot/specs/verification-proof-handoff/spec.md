## MODIFIED Requirements

### Requirement: A wrapper can refuse a second live run on the host

A `start` whose environment sets `APP_VERIFY_SINGLE_RUN=1` SHALL be refused with the 1.x `error: "run-active"` while any run's service unit is live on the host, whichever application started it. A unit counts when it is `active (running)` or `activating` and its name is a run id; a failed, inactive or stopping unit, a lease or thaw timer or service and the host route's command unit SHALL NOT count. A guarded start SHALL take a host-wide claim, a transient unit that lives while the starting process does, before it reads the units and until `start` returns, so that of two starts begun together one is refused. The refusal SHALL name the first three live runs and a count of the rest, or the start still creating one, carry `errorBody` with the registry code `capacity`, exit 1 and occur before the core creates a receipt, proof directory, runtime directory, unit or timer, leaving the live run untouched. A claim SHALL be given back only while it is still the one that start took; when the start cannot read which claim it took, or which claim holds the name when it gives it back, it SHALL stop nothing, and the claim SHALL end with the starting process. A `start` without the value `1`, `restart`, and every other operation SHALL be unaffected. When the claim cannot be taken or the units cannot be listed the start SHALL go ahead and say so on stderr. The Hub's `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts and the host route SHALL opt in, and no test script SHALL. A composition SHALL count as one run: it SHALL refuse while any run is live, with its own 1.x refusal line and no `errorBody` until 1.x retires, SHALL report `core-build-missing` with exit 3 when the core is not built, and SHALL start its own runs without the variable. Receipts, leases, cleanup and the exit codes of existing paths SHALL NOT change, and the core SHALL take no runtime dependency.

#### Scenario: Second start beside a live run
- **WHEN** a guarded `start` runs while another run's unit is active, for the same adapter or another
- **THEN** the line keeps `operation`, `error: "run-active"` and a `detail` that names the live run, its `errorBody` carries `capacity`, retryable, it exits 1 and the live run's receipt, process and lease are unchanged

#### Scenario: Two starts begun together
- **WHEN** two guarded starts begin at the same moment on an empty host
- **THEN** one starts a run, the other is refused with `run-active`, only the first creates a receipt or runtime directory, and the claim is given back

#### Scenario: Claim held by a start that died
- **WHEN** the process that holds the claim ends
- **THEN** the claim unit ends within seconds and a later guarded start goes ahead

#### Scenario: Stale or unrelated units
- **WHEN** a failed unit, a stray lease timer or the host route's command unit exists and no run is live
- **THEN** a guarded `start` goes ahead

#### Scenario: Test suites
- **WHEN** a test suite starts runs side by side without the variable
- **THEN** every start succeeds, including a suite that spawns a wrapper script directly

#### Scenario: Composition
- **WHEN** `verify:compose start` runs beside a live run
- **THEN** it refuses with `run-active` and records no composition, and when no run is live it starts its three runs

#### Scenario: Composition without a built core
- **WHEN** `verify:compose start` opts in and `@jimmie-potts/app-verify` does not resolve
- **THEN** it prints `core-build-missing` and exits 3, not an internal error

#### Scenario: Release that cannot tell its own claim
- **WHEN** a guarded start cannot read its claim's invocation and gives the claim back
- **THEN** nothing is stopped, and the claim stays until the process that holds it ends
