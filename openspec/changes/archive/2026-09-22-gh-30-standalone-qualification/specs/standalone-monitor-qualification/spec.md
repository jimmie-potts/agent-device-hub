## Purpose

Provide repeatable, confined source evidence that the selected standalone Linux/WSL monitoring route stays responsive and recovers during everyday use.

## ADDED Requirements

### Requirement: Bounded honest source qualification
The qualification command SHALL use the actual hook and Pixoo/Nanoleaf consumer code with synthetic data, record source/runtime identities and measurement boundaries, retain failures and emit a concise report without overwriting prior results. It MUST distinguish source receipt, fake transport, installed-client and physical evidence.

#### Scenario: Normal and concurrent monitoring
- **WHEN** one task and ten concurrent tasks produce measured events
- **THEN** the report includes startup, every hook-return sample and both consumers' receipt samples, evaluated against targets defined before the run

#### Scenario: A target fails
- **WHEN** a sample, resource ceiling, confinement or scenario check fails
- **THEN** the report retains the failure and the command exits unsuccessfully without relabeling historical results or relaxing targets

### Requirement: Failure isolation and bounded recovery
The command SHALL exercise dashboard connection/reconnection, an ordinary integration control, unavailable and stalled consumers, a short 50-task burst, host outage and restart. It MUST verify hard fail-open deadlines, bounded resources, explicit rejection/resync, retained state and one owner without requiring embedded-host or physical qualification.

#### Scenario: A consumer stalls
- **WHEN** one consumer stops receiving while events continue
- **THEN** healthy consumer progress and hook return remain independently observable and recovery uses current state rather than expired effects

#### Scenario: Host restarts
- **WHEN** the disposable standalone owner stops and restarts
- **THEN** labels and notices persist, consumers recover current state and competing ownership is refused

### Requirement: Confined execution and descendant cleanup
The command SHALL isolate private state, external network, devices and Windows executables from the measured processes and SHALL reap owned descendants on success, timeout and failure. Missing confinement or cleanup evidence MUST fail qualification.

#### Scenario: Isolation is unavailable
- **WHEN** required namespace or process-supervision support is unavailable
- **THEN** no unconfined consumer is launched and the command reports unsuccessful qualification

#### Scenario: A descendant detaches
- **WHEN** the measured process fails or exceeds its deadline with a detached descendant alive
- **THEN** the supervisor terminates its owned namespace and verifies its exit before reporting cleanup success
