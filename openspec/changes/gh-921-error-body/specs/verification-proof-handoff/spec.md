## ADDED Requirements

### Requirement: Core refusals carry the shared error body

Every refusal line that the shared verification core prints SHALL keep its 1.x string `error` and `detail` and add `errorBody`, the shared registry error body. The body SHALL carry the registry code mapped from the 1.x refusal, that code's registry `retryable` flag, and `<error>: <detail>` as `detail`, at most 1024 characters. A `stop` that reports `receipt-locked` with its cleanup SHALL carry the body too, and `restart` SHALL pass that line on. Failed outcomes, receipts, exit codes and refusals that adapters and wrappers print themselves SHALL keep their 1.x shape until 1.x retires. The core SHALL take no runtime dependency to build the body.

#### Scenario: Usage refusal
- **WHEN** a caller names an operation the core does not have
- **THEN** the result line keeps `operation`, `error: "usage"` and its `detail`, exits 2, and its `errorBody` carries `invalid-request`, not retryable

#### Scenario: Run held by another operation
- **WHEN** another live operation holds a run's receipt lock past the wait
- **THEN** the refusal keeps `error: "receipt-locked"` and its `errorBody` carries `capacity`, retryable, and a refused `stop` still reports the cleanup it did

#### Scenario: Vendored consumer
- **WHEN** a repository installs the packaged core outside the workspace
- **THEN** no other workspace package resolves from it, and its refusal lines carry the same body
