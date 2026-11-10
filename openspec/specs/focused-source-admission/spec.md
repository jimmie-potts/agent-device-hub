# Focused source admission specification

## Purpose

Keep reviewed source integration independent of broad release qualification while preserving deterministic admission and installation evidence.

## Requirements

### Requirement: Focused source admission

The source admission gate SHALL require build, typecheck, lint, applicable unit and consumer checks for every ready candidate. Every candidate SHALL require independent Standards and Specification review of the exact candidate. The gate SHALL omit broad browser/catalog jobs only for complete comparisons confined to an explicit reviewed list of existing dashboard/frontend CSS asset paths and documentation, or the verified standalone-test route. The standalone-test route SHALL accept only modifications to explicitly verified existing test entries and ordinary Markdown, require their complete fixed owning commands with positive exact-head execution evidence, and retain all common checks. Additions, deletions, renames, type changes, helpers, fixtures and incomplete or unsafe comparisons SHALL NOT use that route. New or renamed assets, executable frontend code, backend, credential, persistent-state, writer, device-command and gate-policy impact SHALL retain conservative coverage. Labels SHALL NOT waive coverage. Observable behavior SHALL retain affected disposable acceptance.

#### Scenario: Ordinary presentation candidate
- **WHEN** a ready reviewed candidate changes only known dashboard presentation paths
- **THEN** focused admission can pass without waiting for release qualification
- **AND** affected unit/consumer checks and disposable acceptance remain required

#### Scenario: Documentation-only comparison
- **WHEN** a complete comparison qualifies for the existing reduced Markdown-only route
- **THEN** core build, typecheck, lint, workflow, documentation and independent review remain required
- **AND** deliberately omitted product jobs are recorded as not run, with omission verified against the recomputed selection and successful selected-checks gate

#### Scenario: Missing or inconsistent evidence
- **WHEN** selection, review or an applicable check is absent, failed or for another revision
- **THEN** admission is refused

#### Scenario: Safety or unknown change
- **WHEN** the comparison touches backend, shared, safety, policy or unknown paths or cannot be read completely
- **THEN** the gate retains conservative coverage regardless of labels

#### Scenario: Verified standalone test entry
- **WHEN** a complete ready PR modifies only verified standalone test entries and ordinary Markdown
- **THEN** the gate requires every selected complete owning command plus common build, typecheck, lint, Workflow, documentation and independent review
- **AND** qualification retains its separate complete applicable coverage

### Requirement: Independent qualification scheduling

Draft/checkpoint activity SHALL NOT start broad release qualification. Main integration SHALL enqueue immutable release qualification with one active and newest pending candidate. Removing redundant broad main checks SHALL require an already verified replacement qualification path. Source completion SHALL NOT imply a qualified release or installed acceptance.

#### Scenario: New main revisions arrive during qualification
- **WHEN** more source integrates while an immutable candidate is being qualified
- **THEN** the active candidate stays fixed and a pending candidate can replace an older pending candidate
- **AND** omitted revisions are never reported as qualified

#### Scenario: Ordinary branch advances
- **WHEN** an independently reviewed candidate remains conflict-free after unrelated main changes
- **THEN** admission does not require rebasing solely to obtain an up-to-date build
- **AND** the current comparison and head are rechecked before guarded merge

### Requirement: Isolated task and deployment ownership

Each disposable task SHALL own its mutable worktree, build outputs, container, state, ports, test credentials and proof artifacts. Supported browser journeys SHALL honor a task-selected private output namespace and SHALL NOT bypass it with a shared fixed host filename. A journey that automatically allocates output SHALL create a private invocation-owned namespace. An invocation SHALL NOT overwrite another invocation's retained evidence. Stopping one SHALL leave another intact. Real-client experiments SHALL use supported isolated configuration and declared feed identity, preserving existing authority and qualification limits. Feature tasks SHALL link one designated deployment batch for installed acceptance, and consume its verified recorded writer release without another acknowledgment.

#### Scenario: Concurrent tasks
- **WHEN** two tasks exercise independent synthetic runtime and browser paths concurrently
- **THEN** they require no installation handoff and cleanup affects only their own resources

#### Scenario: Concurrent browser proof outputs
- **WHEN** two independent tasks run the same disposable browser journey with their private output namespaces
- **THEN** each retains its own private output files
- **AND** finishing or cleaning up either instance leaves the other instance's outputs and unrelated existing files unchanged

#### Scenario: Unsupported client isolation
- **WHEN** a client has no supported isolated profile route
- **THEN** the task records that limit and does not select personal settings or the installed service

### Requirement: Owning-command evidence

Standalone admission SHALL bind fixed expected commands and their actual successful nonempty completion to the exact candidate and authentic hosted job. The changed compiled unit-test entry SHALL execute nonempty successful cases within its complete owning suite. A standalone browser journey SHALL finish its existing keyboard and viewport assertions; a fictitious test count SHALL NOT substitute for completion. Missing, failed, skipped, cancelled, empty, wrong-command or wrong-revision evidence SHALL refuse admission. Labels SHALL NOT waive requirements.

#### Scenario: Wemo owning suite
- **WHEN** the verified standalone Wemo module test changes
- **THEN** its complete built suite runs after the common build
- **AND** positive evidence includes successful cases in the changed compiled entry and the nonempty suite without unexpected skips

#### Scenario: MicroDuck owning browser journey
- **WHEN** the verified standalone MicroDuck browser test changes
- **THEN** Chromium setup, dashboard smoke and the complete browser journey run after the common build
- **AND** completion follows its existing assertions and private per-run artifact handling

#### Scenario: Missing or invalid owning-command result
- **WHEN** selected execution evidence is missing, failed, unexpectedly skipped, cancelled, empty or bound to another command or revision
- **THEN** both the hosted gate and delivery preflight refuse standalone admission
