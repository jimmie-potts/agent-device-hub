## ADDED Requirements

### Requirement: A disposable run on virtual time

A disposable run of the fixture runtime SHALL run on virtual time when its run file names `clock: "virtual"`, which its seed SHALL write only for a catalog scenario that asks for it; every other run, and every run of the shipped runtime, SHALL stay on the real clock. In a run on virtual time the supervisor SHALL be the authority for the run's time: it SHALL start at the real time when the run starts, hold the run's simulated devices on a manual clock, start each runtime child at the run's current virtual time with that time as the child's own argument (never a runtime argument), and move time only when its loopback harness API asks. `GET /clock` SHALL answer the run's virtual time, when the next timer of its devices or its runtime is due, and whether work is still in flight; `POST /clock/advance` SHALL take only `ms`, a whole number of milliseconds from 0 to 3600000, refuse any other body with 400 and `invalid-request`, and answer as `GET /clock` once the advance is settled. A run on the real clock SHALL refuse both routes with 409 and `invalid-state`, and the runtime's gateway SHALL serve no clock route. An advance SHALL move time in the in-memory harness's steps, each step stopping at the earliest timer due in the devices or the runtime: the devices' clock first, then the child's, which SHALL wait for its modules' worker calls (at most 10 s of real time each), move its clock, give real work its turn and answer with its next due time, whether work is in flight and how many lines it has written to stderr. The supervisor SHALL answer only once its journal has read those lines. Advances, starts and restarts SHALL run one after another; a child that ends during an advance SHALL end it early, at the time reached. A restart's hold SHALL advance virtual time by the hold instead of waiting in real time. The child SHALL pass its clock to `runMain` as its test clock and the same clock's monotonic reading to the fixture core's options. The run adapter SHALL learn the run's clock from the harness API; on virtual time its `now` SHALL be the virtual time, its `wait` SHALL advance the run, and its parts SHALL run on a manual clock that moves with it and stamps their messages. A wait in which no timer is due in the run or the parts, after an advance that found nothing in flight and changed nothing the scenario can read, with no call waiting for an answer and no part reconnecting, MAY pass without a call to the run, provided the run gets that time before anything else reaches it. A hook against a stopped runtime SHALL be refused on virtual time. Timers that guard real I/O SHALL stay real: socket liveness, the lag watchdog, launcher probes and device and media I/O deadlines. A capture's `scenario-result.json` SHALL record `clock` as `virtual` or `real`. The control SHALL add no message, event, record or error shape to the bus: the supervisor and child exchange it on their existing IPC channel.

#### Scenario: A run on the real clock
- **WHEN** a run of the fixture runtime on the real clock, or a run of the shipped runtime, is asked for `GET /clock` or `POST /clock/advance`
- **THEN** each answers 409 with `invalid-state` in the shared error body

#### Scenario: The gateway serves no clock
- **WHEN** the runtime's gateway is asked for `/clock`, `/clock/advance` or the harness's clock paths, with GET or POST, in a run on either clock
- **THEN** each answers 404, while the same path on the harness of a run on virtual time answers 200

#### Scenario: Time moves only on an advance
- **WHEN** a run on virtual time is read twice without an advance, then advanced by two minutes, and a remote part's action then reaches the runtime
- **THEN** both reads name the same time, the advance answers that time plus two minutes, and the runtime's record of the action carries a time at least two minutes after the start, which the real clock has not reached

#### Scenario: A restart's hold on virtual time
- **WHEN** a run on virtual time restarts with a hold of four seconds
- **THEN** the run's virtual time is four seconds later, and the next runtime's `runtime.started` record carries at least that time

#### Scenario: A malformed advance
- **WHEN** an advance names a negative, fractional, too large or non-numeric `ms`, another field, or a body that is not an object
- **THEN** it is refused with 400 and `invalid-request`, and the run's time does not move

#### Scenario: The child's monotonic clock
- **WHEN** the verification child builds its clock for a run on virtual time
- **THEN** the fixture core's options and the test clock it gives `runMain` carry the same monotonic clock, which moves with the wall clock

#### Scenario: A converted capture
- **WHEN** a catalog scenario that asks for virtual time runs as a capture step on a fresh run
- **THEN** every step passes, and its `scenario-result.json` records `clock` `virtual`, while every other scenario's records `real`

## MODIFIED Requirements

### Requirement: A test clock only in a disposable verification run

The runtime process SHALL take a test clock (a wall clock, a scheduler and a monotonic clock) only as a programmatic input to `runMain` or `runProcess`, which a disposable verification run's child SHALL pass when, and only when, its run is on virtual time (see "A disposable run on virtual time"), and SHALL run on that clock's wall clock and scheduler when it takes one. The runtime SHALL not use the test clock's monotonic clock itself: it is for the module options the run's child builds, such as the fixture core's, to which the child SHALL pass the same monotonic clock. No runtime argument or environment variable SHALL select a clock: the argument parser SHALL stay strict and refuse any clock argument with a usage error. The installed entry points, `src/main.ts` with `launch.ts` and the shipped module factories, and the container's `deploy/container/entrypoint.mjs`, SHALL construct and pass no clock, scheduler or monotonic clock. With a test clock, the process SHALL require `--simulate`, `--environment test`, `--edge`, an IPC channel and a state directory other than the installed default, which the verification supervisor's fork gives its child and the service manager and the container entry do not give the process. An IPC channel alone does not prove the supervisor, since Node also opens one for a process whose environment names an open descriptor. Without any one of them it SHALL fail before any module starts or any port is bound, through its existing failure path: exit 1 and exactly one `runtime.failed` record, with `error.type` `RuntimeError`, `error.code` `invalid-state` and fixed text. Without a test clock the runtime SHALL keep the real clock and its default scheduler.

#### Scenario: No argument selects a clock
- **WHEN** the runtime is started with `--clock`, `--clock virtual`, `--test-clock`, `--scheduler` or `--monotonic`
- **THEN** the argument parser refuses each with a usage error, and the shipped entry point exits 2 with its usage line, no record and no ready line

#### Scenario: The installed entry points pass no clock
- **WHEN** the installed entry points' sources are checked
- **THEN** none of `src/main.ts`, `src/launch.ts`, `src/modules.ts` and `deploy/container/entrypoint.mjs` names a clock, a scheduler or a monotonic clock

#### Scenario: A test clock outside a disposable run
- **WHEN** a process is given a test clock with the production environment, without `--simulate`, without `--edge`, without an IPC channel, or with the installed default state directory, each alone
- **THEN** it exits 1 with exactly one record, `runtime.failed` with `invalid-state`, no module record, no `runtime.started` and no ready line, and nothing is created under the default state directory

#### Scenario: A test clock in a disposable run
- **WHEN** a process with an IPC channel is given a test clock that stands still, with `--simulate`, `--environment test` and `--edge`
- **THEN** it starts and serves, its `runtime.started` record carries the test clock's time, and a module timer on its scheduler does not fire before the process stops

#### Scenario: No clock given
- **WHEN** a process is given no test clock and a module sets a short timer on its scheduler
- **THEN** the timer fires in real time
