## MODIFIED Requirements

### Requirement: Failure isolation

Under ADR 0012's policy A, a module SHALL handle its device's errors and timeouts itself, as outcomes and device state, so they do not stop it. An error that escapes a module SHALL stop only that module, and health SHALL show it `failed` until the runtime restarts; the runtime SHALL NOT restart it. This covers a start that throws, rejects or outlasts the start deadline; a subscription handler or responder that throws; a scheduled callback that throws or rejects; an uncaught error in the module's worker thread; and an error that escapes to the process from the module's own async flow. A refusal or failure SHALL be logged with the module, its 2.0 registry code in `bunny.code`, where it arose in `bunny.phase` (`manifest`, `start`, `handler`, `timer`, `worker` or `async`), the error's type and, when it is an identifier, its code. A problem in a module's stop SHALL be logged with the module and `bunny.phase` but no registry code: a participant close or `stop` that outlasts its deadline (`handlers` or `stop`), a `stop` that throws (`stop`, with the error's type and code), and an error after the module stopped (where it arose, with the error's type and code). As the diagnostic contract requires, a record SHALL NOT hold the reason's sentence, the raw message or the stack. A refusal of a malformed name SHALL leave the name out. A dropped delivery SHALL NOT fail its module: a subscription's first drop SHALL be logged at once, then the drops that go on SHALL be logged once a minute with their count, and a minute without drops SHALL end that, so that the next drop is logged at once.

To stop a module, the runtime SHALL abort its signal, cancel its timers and close its participant, which settles the module's own pending requests, closes its sync copies and owners and waits only for its own running handlers; then it SHALL call the module's `stop` once, terminate its workers and close its database. The participant's close and `stop` SHALL each be bounded by the stop deadline, so `stop` runs after a close that timed out while a hung handler may still run. The whole stop SHALL run in the module's own async flow, whichever flow noticed the failure, so that an error its abort listeners or cleanup throw or reject belongs to that module. A module's stop SHALL NOT wait on another module's handler. The other modules SHALL keep working. An error that escapes to the process from code outside every module SHALL be logged as `runtime.failed` and SHALL exit the process with status 1.

#### Scenario: A handler throws
- **WHEN** a module's subscription handler throws
- **THEN** health shows it `failed` with `internal` and "a handler threw", its record carries `bunny.code` `internal` and `bunny.phase` `handler`, its stop runs once, its subscription receives nothing more, a request to its responder is `unavailable`, and another module still answers requests

#### Scenario: A start fails or times out
- **WHEN** one module's start rejects, another's throws and a third's never finishes, as when it waits on something that never answers
- **THEN** the first two are `failed` with "start failed", the third is `failed` with `unavailable` after the start deadline, each is stopped, and another module runs

#### Scenario: A scheduled device call times out
- **WHEN** a module's scheduled callback rejects with a `TimeoutError` from its device call that the module did not handle
- **THEN** the module is `failed` with "a scheduled callback failed", and the log names the `TimeoutError`

#### Scenario: A worker or an escaped error
- **WHEN** a module's worker thread throws, or an error escapes from a continuation the module started
- **THEN** that module is `failed`, and an error raised outside every module is not attributed to any module

#### Scenario: Errors escape a running process
- **WHEN** in a runtime process one module throws from its own timer and another leaves a rejected promise unhandled
- **THEN** both are `failed` with "an error escaped the module", a third module keeps running, health keeps answering, and SIGTERM still exits 0

#### Scenario: The runtime's own error
- **WHEN** an error escapes to the process from code outside every module
- **THEN** the process writes a fatal `runtime.failed` record with the error's type and code, without its message, and exits with status 1

#### Scenario: No raw error message in the log
- **WHEN** a module's responder throws an error with a code whose message quotes a URL with a token
- **THEN** the failure record carries the error's type and code, and no record holds the token

#### Scenario: Abort listeners that fail
- **WHEN** modules whose abort listeners throw, or leave a rejected promise unhandled, are stopped after a handler error, after a failed start and by the runtime's stop
- **THEN** each error stays with its own module, the module that published the failing handler's message keeps running, no `runtime.failed` record is written and SIGTERM exits 0

#### Scenario: Dropped deliveries
- **WHEN** 1100 messages reach a subscription whose handler is stalled, ten more drop in the second minute, the third minute is quiet, and one more drops after it
- **THEN** one `runtime.delivery.dropped` record is written at once with a count of one, one at the first minute's end with the later drops, the ten wait for one record at the second minute's end, the quiet minute writes nothing, the drop after it is logged at once, every message is either delivered or counted, and the module keeps running

#### Scenario: A sync begun in a failed start
- **WHEN** a module begins a sync of ten families and its start then throws
- **THEN** once the module has stopped, a burst on every family queues nothing for it and no drop is logged

#### Scenario: Stop never waits on another module
- **WHEN** a module fails while its own handler awaits a request to another module whose responder is blocked
- **THEN** that request resolves as `uncertain`, the failed module's stop runs while the other responder is still blocked, and the other module stays running

#### Scenario: A handler that never finishes
- **WHEN** the runtime stops while a module's own handler never finishes
- **THEN** the stop completes within the stop deadline, the module is `stopped`, its `stop` ran once and the timeout is logged

#### Scenario: Nothing left behind
- **WHEN** a module with a pending timer, an open database and a worker thread fails
- **THEN** its signal is aborted, no timer of the module or of the runtime's deadlines remains, the timer never fires, its database is closed, its worker exits, its participant refuses calls, its context refuses timers, workers and the database with `invalid-state`, and its logger, tracing and clock still work
