## MODIFIED Requirements

### Requirement: A disposable run on virtual time

A disposable run of the fixture runtime SHALL run on virtual time when its run file names `clock: "virtual"`, which its seed SHALL write for the run of every catalog scenario, with no per-scenario choice; every other run, such as the `fixtures` and `mac-codex-local` runs, a module's own runs and the negative controls, and every run of the shipped runtime, SHALL stay on the real clock. In a run on virtual time the supervisor SHALL be the authority for the run's time: it SHALL start at the real time when the run starts, hold the run's simulated devices on a manual clock, start each runtime child at the run's current virtual time with that time as the child's own argument (never a runtime argument), and move time only when its loopback harness API asks. `GET /clock` SHALL answer the run's virtual time, when the next timer of its devices or its runtime is due, and whether work is still in flight; `POST /clock/advance` SHALL take only `ms`, a whole number of milliseconds from 0 to 3600000, refuse any other body with 400 and `invalid-request`, and answer as `GET /clock` once the advance is settled. A run on the real clock SHALL refuse both routes with 409 and `invalid-state`, and the runtime's gateway SHALL serve no clock route. An advance SHALL move time in the in-memory harness's steps, each step stopping at the earliest timer due in the devices or the runtime: the devices' clock first, then the child's, which SHALL wait for its modules' worker calls (at most 10 s of real time each), move its clock, give real work its turn and answer with its next due time, whether work is in flight and how many lines it has written to stderr. The supervisor SHALL answer only once its journal has read those lines. Advances, starts and restarts SHALL run one after another; a child that ends during an advance SHALL end it early, at the time reached. A restart's hold SHALL advance virtual time by the hold instead of waiting in real time. The child SHALL pass its clock to `runMain` as its test clock and the same clock's monotonic reading to the fixture core's options. The run adapter SHALL learn the run's clock from the harness API; on virtual time its `now` SHALL be the virtual time, its `wait` SHALL advance the run, and its parts SHALL run on a manual clock that moves with it and stamps their messages. A wait in which no timer is due in the run or the parts, after an advance that found nothing in flight and changed nothing the scenario can read, with no call waiting for an answer and no part reconnecting, MAY pass without a call to the run, provided the run gets that time before anything else reaches it. `POST /restart` SHALL take `holdMs` and `untilReleased`, `true` or `false`, and refuse any other field or value with 400 and `invalid-request`. With `untilReleased` the runtime SHALL stay stopped until `POST /release`, or at most 10 s of real time, before its hold begins, and the wait SHALL exist before the runtime stops. `POST /release` SHALL take an empty object, refuse a body with a field with 400 and `invalid-request`, answer 409 and `invalid-state` when no restart waits for a release, and otherwise end the wait. A run on the real clock SHALL refuse a restart with `untilReleased` `true`, and `POST /release`, with 409 and `invalid-state`, and restart nothing. On virtual time the run adapter SHALL run a hook against a stopped runtime by asking for a restart that waits for a release, running the hook once the runtime refuses connections, then releasing it; once the restart answers, its own clock SHALL follow the run's time. On virtual time the child SHALL give each registered module it builds over a link the run's wall clock, scheduler and monotonic clock as `run.remote`'s options, and the supervisor SHALL give its simulated devices the run's monotonic clock with `run.create`'s options; on the real clock neither SHALL be given, and a module or device without them SHALL keep the clocks it had before virtual time. On virtual time a capture's browser journey SHALL start with the page's clock at the run's time, and the run SHALL not move during the journey unless the capture moves it. On virtual time a restart's wait for the reader to come back SHALL advance the run while the reader's stream is away, until its bound has passed in the run's time; once the stream is back, the run's time SHALL stand still while the reader resyncs, and the wait SHALL fail only once the bound has passed in real time. A wait SHALL end only once a reader whose lost stream is back has synced every copy again, for a stream the scenario dropped on either clock and for any lost stream on virtual time, and SHALL fail after 15 s of real time with fixed text naming the copies that did not. During an ordinary wait on virtual time, the parts' clock SHALL stand still once the reader's stream has returned and its copies are resyncing. The wait SHALL finish advancing its requested interval after the copies resync. On virtual time a wait SHALL also end only once the reader accounts for what was published with a matching subscription on its current stream. Every occurrence and outcome SHALL be matched by source and ID. In each copy that has synced and has not stopped, the SDK copy's applied state, removal tombstone or snapshot revision SHALL account for the owner's latest state or removal of each entity. The verification fixture SHALL record stream eligibility at publication so that the first state refresh after reconnect includes live deliveries without requiring replay of the lost interval. Once the reader resyncs, the adapter SHALL refresh publication eligibility for the returned stream. A counted overflow SHALL NOT waive outstanding live publications. A later snapshot may account for lost state or removal. A missing occurrence or outcome SHALL remain outstanding until received or until the stream is lost. The delivery wait SHALL fail after 15 s of real time with fixed text naming every missing publication. At a virtual expectation's bound, including a bound of zero, the adapter SHALL settle any already owed time, advance by zero for fresh evidence of the run's own work, and refresh state before the bound check. It SHALL capture real work pending before the first bound check: an answer, a reconnect for a part the scenario has released, the reader's resync, a batch of eligible publications or the run's own work as reported by the child. Each captured completion SHALL justify at most one recheck. A completion SHALL include its own observable result, such as the returned reader's resync or publications linked to an action by its existing trace. Other publications SHALL NOT hold a completed read. Work started by a check and its logs SHALL NOT enter the pending set. The adapter SHALL hold virtual time at the bound. A single monotonic 15 s deadline SHALL include catch-up, zero advances, state refreshes, predicate evaluation and waits for work to change. With no recorded work left to justify a retry, the expectation SHALL fail with the check's own text. At the deadline it SHALL report what is still pending and preserve the last failed check's text when available. Timers that guard real I/O SHALL stay real: socket liveness, the lag watchdog, launcher probes and device and media I/O deadlines. A capture's `scenario-result.json` SHALL record `clock` as `virtual` or `real`, and every catalog scenario's capture SHALL record `virtual`. The control SHALL add no message, event, record or error shape to the bus: the supervisor and child exchange it on their existing IPC channel.

#### Scenario: A run on the real clock
- **WHEN** a run of the fixture runtime on the real clock, or a run of the shipped runtime, is asked for `GET /clock`, `POST /clock/advance`, `POST /release` or `POST /restart` with `untilReleased` `true`
- **THEN** each answers 409 with `invalid-state` in the shared error body, and the runtime's generation does not change

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
- **WHEN** any catalog scenario, each now converted to virtual time, runs as a capture step on a fresh run
- **THEN** every step passes, and its `scenario-result.json` records `clock` `virtual`

#### Scenario: A release with nothing to release
- **WHEN** a run on virtual time is asked for `POST /release` with no restart waiting, or with a body that has a field, or for `POST /restart` with `untilReleased` that is not `true` or `false`
- **THEN** the first answers 409 with `invalid-state`, and the others 400 with `invalid-request`

#### Scenario: A hook against a stopped runtime on virtual time
- **WHEN** the run adapter of a run on virtual time runs a hook against a stopped runtime with a four-second hold
- **THEN** the hook exits quietly, the runtime starts again as the next generation, and the run's time and the adapter's are four seconds later

#### Scenario: A remote module without the run's clocks
- **WHEN** Playback's remote module is built over a link without options, and its monotonic clock and its wall clock move apart
- **THEN** it judges freshness on `performance.now()`; given the run's clocks, it judges freshness on the run's monotonic clock instead

#### Scenario: MicroDuck's simulation on the real clock
- **WHEN** a run on the real clock creates MicroDuck's device without a monotonic clock and builds its remote module without options
- **THEN** the device stamps its sensor with `process.hrtime`, and the module judges that stamp fresh and polls on `setInterval`; on virtual time both follow the run's clock

#### Scenario: A reader held past the run's bound
- **WHEN** after a restart on virtual time the reader's re-registration is held until the run's time has passed the 15 s bound and stopped moving, then let through
- **THEN** the restart resolves with the reader resynced, rather than failing at the bound of the run's time

#### Scenario: A delivery still on its way
- **WHEN** on virtual time the run publishes events and a state while the reader's stream holds every frame until the wait's last refresh has answered, then lets them through
- **THEN** the wait ends only once the reader has heard them and its copy shows the state

#### Scenario: A delivery that never arrives
- **WHEN** on virtual time what the run published does not reach the open stream of the reader within 15 s of real time
- **THEN** the wait fails with fixed text that names each missing occurrence or outcome by type, source and ID, and each missing state or removal by copy, entity and revision

#### Scenario: An expectation past its bound with real work in flight
- **WHEN** on virtual time an expectation's bound passes in the run's time while a disconnected reader's reconnect, or an action's answer, is held, and is then let through without the run's time moving
- **THEN** the expectation passes once the work has ended, and the run's time has not moved past the bound

#### Scenario: An expectation past its bound with nothing in flight
- **WHEN** on virtual time the bound check fails without independently pending work, even if the check completed a request that wrote a log
- **THEN** the check runs once and the expectation fails with its text

#### Scenario: A restart's resync held after the stream is back
- **WHEN** after a restart on virtual time the reader's stream is back and its resync is held, then let through
- **THEN** the run's time does not move while the resync is held, the copies' sync deadlines do not pass, and the restart resolves with the reader resynced
