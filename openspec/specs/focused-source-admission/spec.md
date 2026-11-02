# Focused source admission specification

## Purpose

Keep reviewed source integration independent of broad release qualification while preserving deterministic admission and installation evidence.

## Requirements

### Requirement: Focused source admission

The source admission gate SHALL require build, typecheck, lint, applicable unit and consumer checks for every ready candidate. Every candidate SHALL require independent Standards and Specification review of the exact candidate. The gate SHALL omit broad browser/catalog jobs only for complete comparisons confined to an explicit reviewed list of existing dashboard/frontend CSS asset paths and documentation. New or renamed assets, executable frontend code, backend, credential, persistent-state, writer, device-command and gate-policy impact SHALL retain conservative coverage. Labels SHALL NOT waive coverage. Observable behavior SHALL retain affected disposable acceptance.

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
