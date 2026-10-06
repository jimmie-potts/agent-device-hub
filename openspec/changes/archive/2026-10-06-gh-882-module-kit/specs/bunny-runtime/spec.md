## MODIFIED Requirements

### Requirement: Module context

The runtime SHALL call each module's `start` with a context that gives the module:
- its own participant on the one shared bus, with source `bunny/modules/<name>`, including `publishMessage`;
- a logger whose records carry the module's name in their scope and attributes, and the trace ID, span ID and flags of a given trace context;
- tracing that starts a span in a given parent's trace, or a new trace without one;
- the runtime's clock and a scheduler on the runtime's scheduler, which also run the bus's `time`, `expiresat` and request deadlines;
- worker threads that the runtime terminates when the module stops;
- the module's own SQLite file, `modules/<name>.sqlite` in the runtime's private state directory, opened with `node:sqlite` on first use, mode 600, and kept across restarts;
- an abort signal that aborts when the module stops.

A scheduler delay SHALL be an integer from 0 to 2147483647; any other SHALL throw `RangeError`. Once the module's stop begins, its participant, scheduler, workers and database SHALL refuse use with `invalid-state`, while its logger, tracing, clock and signal SHALL keep working, so that its `stop` can still log. Log records SHALL be JSON lines with OpenTelemetry field names, at `info` and above by default.

#### Scenario: Log records name the module and the trace
- **WHEN** a module logs at each level with fields and a span from `trace.span(parent)`
- **THEN** the debug record is dropped at the default level, the others carry their severity, the module's scope and `bunny.module` attribute, which the module's fields cannot replace, and the record with the span carries the parent's trace ID and the span's own span ID

#### Scenario: Deadlines follow the runtime's clock
- **WHEN** the runtime runs on an injected clock and scheduler and a module requests with a 1000 ms timeout from a blocked responder
- **THEN** the command's `time` and `expiresat` come from that clock, the request stays pending while real time passes, and it resolves as `uncertain` when the injected scheduler reaches the deadline; the module's timers fire and cancel on the same scheduler

#### Scenario: The module's own database
- **WHEN** a module writes to its database, the runtime stops, and a runtime on the same state directory starts the module again
- **THEN** the file is `modules/<name>.sqlite` with mode 600 in a mode 700 directory, the second start reads the row, and a module that never asks has no file

#### Scenario: A worker thread
- **WHEN** a module starts a worker thread and messages it
- **THEN** the worker answers

#### Scenario: A prepared message
- **WHEN** a module publishes a message and then publishes the same message again with `publishMessage`
- **THEN** another module receives it twice, the same message with its `id` and `time`


## ADDED Requirements

### Requirement: Fixture module

The runtime's tests SHALL hold a fixture module, a simulated lamp that later stories use as their stand-in module, and a stand-in core. The lamp SHALL serve its lamps through sync, copy the core's mode, switch a lamp on command, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome. It SHALL pass the module test kit. The stand-in core SHALL serve the mode and take every occurrence and outcome once by `(source, id)`, keeping what it took in its own SQLite file across restarts.

#### Scenario: The lamp passes the kit
- **WHEN** the runtime's tests run the module test kit on the lamp
- **THEN** every check passes

#### Scenario: Under the runtime
- **WHEN** the runtime hosts the stand-in core, the lamp and a requester, and the requester switches a lamp on
- **THEN** the request is accepted and the core takes the outcome once; in quiet mode the request is refused with `invalid-state`

#### Scenario: A kill between commit and publish
- **WHEN** the runtime process is killed after the lamp commits a switch and before it publishes anything, then started twice on the same state directory without the requester
- **THEN** the core takes the outcome exactly once, in the first restart, and drops the second restart's resend as a duplicate, and the lamp never receives the command again
