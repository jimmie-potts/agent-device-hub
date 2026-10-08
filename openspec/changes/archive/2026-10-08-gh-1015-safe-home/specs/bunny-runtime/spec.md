## ADDED Requirements

### Requirement: Observe the verification child's private home without inspecting process environments

Disposable runtime verification SHALL obtain HOME as one bounded, child-observed field over the directly forked child's private IPC channel, for both fixture and shipped runtimes (Hub #1015). It SHALL NOT read process-environment files or serialize an environment object. Only the current child and generation may supply the observation; every spawn SHALL reset prior evidence. Missing or malformed evidence SHALL leave the existing private-state check failing, and an observed path outside the run SHALL fail it. Startup SHALL wait at most one second after runtime readiness for the observation, without inferring a value or resending. The observation SHALL remain in the existing private boundary report, with no new log or diagnostic payload. Open-file, default-state, credential-file, network guard, restart and cleanup checks SHALL retain their existing behavior.

#### Scenario: Both entry points report their own home
- **WHEN** a disposable fixture or shipped runtime starts with a private run HOME
- **THEN** verification observes that child's HOME through IPC and the existing private-state check passes when its other conditions hold, without reading a process-environment file

#### Scenario: Missing or invalid home evidence
- **WHEN** the current child reports no HOME, a malformed or oversized report, or an absolute HOME outside the run
- **THEN** private-state verification fails, no environment object is serialized, and no intended launch path substitutes for missing evidence

#### Scenario: A restart replaces the observation
- **WHEN** a runtime restarts and an old child or generation reports a HOME
- **THEN** that report cannot qualify the new child, which starts with missing evidence and qualifies only through its own valid report

#### Scenario: Process-environment inspection is reintroduced
- **WHEN** a runtime verification source adds a process-environment-file path
- **THEN** the source regression check fails without executing the read
