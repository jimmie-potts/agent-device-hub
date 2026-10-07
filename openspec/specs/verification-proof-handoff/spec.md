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
