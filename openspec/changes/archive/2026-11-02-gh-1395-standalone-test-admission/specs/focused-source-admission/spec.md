## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Owning-command evidence

Standalone admission SHALL bind fixed expected commands and their actual successful nonempty completion to the exact candidate and authentic hosted job. The changed compiled unit-test entry SHALL execute nonempty successful cases within its complete owning suite. A standalone browser journey SHALL finish its existing keyboard, viewport, reduced-motion and accessibility assertions; a fictitious test count SHALL NOT substitute for completion. Missing, failed, skipped, cancelled, empty, wrong-command or wrong-revision evidence SHALL refuse admission. Labels SHALL NOT waive requirements.

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
