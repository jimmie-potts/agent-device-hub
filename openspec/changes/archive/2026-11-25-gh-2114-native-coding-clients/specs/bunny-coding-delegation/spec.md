## ADDED Requirements

### Requirement: Exact native client handoff

An authorized owner SHALL be able to request a qualified native client for the current saved coding attempt. The action SHALL bind the selected worker, job, attempt, harness, native identity and authorized checkout. An original checkout SHALL require positive release of all prior writers. An isolated successor SHALL enforce a verified write boundary against the original checkout and match the saved identity and effective workspace before native continuation. Client choices SHALL distinguish live attachment from saved-session terminal continuation and one-way Desktop takeover. The worker SHALL reserve write control before launching, refuse another writer while authority is held or uncertain, and return authority only on verified release. The Hub SHALL show the time and limits of its last native observation. Private launch paths, profiles and arguments SHALL remain on the worker host.

#### Scenario: The owner continues one of two saved attempts in its terminal

- **WHEN** the owner selects terminal continuation for one saved attempt and its local helper is waiting
- **THEN** only that attempt's client receives its exact saved identity and qualified checkout, and a competing writer is refused

#### Scenario: A completed Codex attempt has a verified isolated successor

- **WHEN** a successful Codex attempt has a clean or committed checkout and meets the native writer fence and saved-session requirements
- **THEN** Jobs can offer exact native terminal continuation without offering a cross-harness handoff

#### Scenario: Claude Desktop acknowledges the saved attempt

- **WHEN** the owner authorizes Claude Desktop takeover after the worker stopped and the exact launcher acknowledgement is observed
- **THEN** Jobs reports Desktop ownership with activity unobserved and prevents another writer until release can be independently verified

#### Scenario: The terminal exits while release remains unverified

- **WHEN** the helper reports that the terminal client exited
- **THEN** Jobs reports exit separately from release and the attempt stays reserved against another writer

#### Scenario: The worker loses contact after assigning authority

- **WHEN** a handoff may have reached the native client and its release cannot be observed
- **THEN** Jobs reports the uncertainty and the worker sends no duplicate launch

#### Scenario: A client combination cannot verify the native identity or authority

- **WHEN** no qualified client route can bind the requested attempt under its subscription and writer rules, or its owner grant is revoked
- **THEN** the operation is unavailable and no native launch is attempted

#### Scenario: A grant changes while the worker prepares a launch

- **WHEN** the worker prepares a native launch and the current private read or worker brief grant is revoked before authorization is sent
- **THEN** the Hub sends no launch authorization and a later eligible request can try again

#### Scenario: The helper has received the plan but has not acknowledged a process start

- **WHEN** the worker reserves write control and sends a launch plan to the terminal helper
- **THEN** Jobs reports that launch is unconfirmed until the helper acknowledges process start and retains the reservation if contact is lost
