# Verification proof handoff

## Purpose

Make verification failures actionable and let an owner inspect retained, verified captures through a disposable preview without exposing other files.

## Requirements

### Requirement: Missing build diagnostic

The Hub verification wrapper SHALL report an absent shared core build as one JSON result with state `unavailable`, exit 3 and an instruction to run `npm run build`, before creating a run. Other import failures SHALL retain their distinct failure.

#### Scenario: Fresh unbuilt checkout

- **WHEN** the owner invokes `verify start` after dependency setup but before building
- **THEN** stdout contains one actionable JSON result and no preview starts

### Requirement: Frozen proof links

An opted-in preview SHALL serve passed frozen capture files through read-only HTTP URLs on its existing loopback origin. Handoff SHALL name those URLs. Adapters without proof serving SHALL retain their existing handoff behavior.

#### Scenario: Handoff and later capture

- **WHEN** handoff commits a capture set and a later capture is taken
- **THEN** the frozen screenshot and video URLs return bytes matching their frozen checksums, repeat handoff returns the same links, and the later capture has no proof URL

### Requirement: Confined proof access

Proof serving SHALL refuse traversal, symlinks, mutations, uncommitted or tampered proof, unrelated runs, private/live files and failed captures. Unknown or active attachment formats SHALL download without executing as preview-origin content. Existing application routes SHALL retain their behavior.

#### Scenario: Untrusted path or content

- **WHEN** a caller requests a private file, a linked file, a changed capture, or an HTML attachment
- **THEN** private, linked and changed files are refused, and the allowed HTML attachment is delivered only as a download with execution disabled

#### Scenario: Browser media inspection

- **WHEN** the owner opens a delivered screenshot or video link
- **THEN** the browser can display the media while cross-origin subresource access and state-changing methods are refused

### Requirement: Preview ownership and retained evidence

Proof URLs SHALL share the preview listener, lease and stop boundary. Reseeding SHALL preserve frozen proof and the existing port. The caller guidance SHALL distinguish temporary HTTP access from retained local files and attach proof where the chat client supports it. Installed configuration SHALL NOT enable the verification proof route.

#### Scenario: Stop or expiry

- **WHEN** the preview stops or its lease expires
- **THEN** its proof URLs cease serving while the frozen local files remain unchanged

### Requirement: Core refusals carry the shared error body

Every refusal line that the shared verification core prints SHALL keep its 1.x string `error` and `detail` and add `errorBody`, the shared registry error body. The body SHALL carry the registry code mapped from the 1.x refusal, that code's registry `retryable` flag, and `<error>: <detail>` as `detail`, at most 1024 characters. A `stop` that reports `receipt-locked` with its cleanup SHALL carry the body too, and `restart` SHALL pass that line on. Failed outcomes, receipts, exit codes and refusals that adapters and wrappers print themselves are outside this requirement until 1.x retires. The core SHALL take no runtime dependency to build the body.

#### Scenario: Usage refusal
- **WHEN** a caller names an operation the core does not have
- **THEN** the result line keeps `operation`, `error: "usage"` and its `detail`, exits 2, and its `errorBody` carries `invalid-request`, not retryable

#### Scenario: Run held by another operation
- **WHEN** another live operation holds a run's receipt lock past the wait
- **THEN** the refusal keeps `error: "receipt-locked"` and its `errorBody` carries `capacity`, retryable, and a refused `stop` still reports the cleanup it did

#### Scenario: Vendored consumer
- **WHEN** a repository installs the packaged core outside the workspace
- **THEN** no other workspace package resolves from it, and its refusal lines carry the same body

### Requirement: A wrapper can refuse a second live run on the host

A `start` whose environment sets `APP_VERIFY_SINGLE_RUN=1` SHALL be refused with the 1.x `error: "run-active"` while any run's service unit is live on the host, whichever application started it. A unit counts when it is `active (running)` or `activating` and its name is a run id; a failed, inactive or stopping unit, a lease or thaw timer or service and the host route's command unit SHALL NOT count. A guarded start SHALL take a host-wide claim, a transient unit that lives while the starting process does, before it reads the units and until `start` returns, so that of two starts begun together one is refused. The refusal SHALL name each live run, or the start still creating one, carry `errorBody` with the registry code `capacity`, exit 1 and occur before the core creates a receipt, proof directory, runtime directory, unit or timer, leaving the live run untouched. A `start` without the value `1`, `restart`, and every other operation SHALL be unaffected. When the claim cannot be taken or the units cannot be listed the start SHALL go ahead and say so on stderr. The Hub's `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts and the host route SHALL opt in, and no test script SHALL. A composition SHALL count as one run: it SHALL refuse while any run is live and SHALL start its own runs without the variable. Receipts, leases, cleanup and the exit codes of existing paths SHALL NOT change, and the core SHALL take no runtime dependency.

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

### Requirement: Refusals name what differs

An unknown scenario SHALL be refused as a usage error that names the scenario and points at `help`, and a capture, extend or scenario on a run that is not running SHALL say whether the run is in another state, its unit is not active, or its unit is not the process the receipt recorded.

#### Scenario: Unknown scenario
- **WHEN** a caller names a scenario the adapter does not define
- **THEN** the usage refusal reads `no scenario named <name>; help lists the scenarios`

#### Scenario: Run that is not running
- **WHEN** a capture names a run whose receipt is stopped, whose unit is gone or whose process differs from the receipt
- **THEN** the `run-not-running` detail names the state, the inactive unit or the identity mismatch
