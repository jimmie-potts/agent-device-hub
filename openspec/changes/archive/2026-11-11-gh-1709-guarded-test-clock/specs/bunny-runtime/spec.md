## ADDED Requirements

### Requirement: A test clock only in a disposable verification run

The runtime process SHALL take a test clock (a wall clock, a scheduler and a monotonic clock) only as a programmatic input to `runMain` or `runProcess`, which a disposable verification run's child passes, and SHALL run on that clock's wall clock and scheduler when it takes one. No runtime argument or environment variable SHALL select a clock: the argument parser SHALL stay strict and refuse any clock argument with a usage error. The installed entry points, `src/main.ts` with `launch.ts` and the shipped module factories, and the container's `deploy/container/entrypoint.mjs`, SHALL construct and pass no clock, scheduler or monotonic clock. With a test clock, the process SHALL require `--simulate`, `--environment test`, `--edge` and an IPC channel, which the verification supervisor gives its child and the service manager and the container do not. Without any one of them it SHALL fail before any module starts or any port is bound, through its existing failure path: exit 1 and exactly one `runtime.failed` record, with `error.type` `RuntimeError`, `error.code` `invalid-state` and fixed text. Without a test clock the runtime SHALL keep the real clock and its default scheduler.

#### Scenario: No argument selects a clock
- **WHEN** the runtime is started with `--clock`, `--clock virtual`, `--test-clock`, `--scheduler` or `--monotonic`
- **THEN** the argument parser refuses each with a usage error, and the shipped entry point exits 2 with its usage line, no record and no ready line

#### Scenario: The installed entry points pass no clock
- **WHEN** the installed entry points' sources are checked
- **THEN** none of `src/main.ts`, `src/launch.ts`, `src/modules.ts` and `deploy/container/entrypoint.mjs` names a clock, a scheduler or a monotonic clock

#### Scenario: A test clock outside a disposable run
- **WHEN** a process is given a test clock with the production environment, without `--simulate`, without `--edge`, or without an IPC channel, each alone
- **THEN** it exits 1 with exactly one record, `runtime.failed` with `invalid-state`, no module record, no `runtime.started` and no ready line

#### Scenario: A test clock in a disposable run
- **WHEN** a process with an IPC channel is given a test clock that stands still, with `--simulate`, `--environment test` and `--edge`
- **THEN** it starts and serves, its `runtime.started` record carries the test clock's time, and a module timer on its scheduler does not fire before the process stops

#### Scenario: No clock given
- **WHEN** a process is given no test clock and a module sets a short timer on its scheduler
- **THEN** the timer fires in real time
