## MODIFIED Requirements

### Requirement: Nanoleaf workers and failure isolation

The module SHALL run one supervised worker per configured device on the runtime's clock, scheduler and stop signal, with its lock file in the private folder, start one after an accepted command when none runs, and start them again when shared input is selected again. A worker that ends because the store failed or another instance holds its lock SHALL start again after a wait that doubles from 1 s to 30 s, one start at a time: at most one pending start per device, which a start for a command or a selection replaces. The run SHALL be logged once as it ends, each later end at DEBUG, and once as it recovers, and a failed pass's run SHALL count as recovered only once a worker presents the device again. Every device request SHALL go through the device's link, which uses the configured address and in-memory token, settles within the light client's 1.2 s timeout on the module's scheduler, and turns timeouts into the device's availability: one `device.unavailable` warning when an outage begins, summaries at DEBUG, and one `device.available` when it ends; a device that answers with an HTTP error is reached, and one that refuses the module's token SHALL be logged once as the refusals begin and once as they end, with no failed-pass record besides. A failed pass for any other reason SHALL be logged once per run of failures. No transaction SHALL span an await or a device request, so a command or an edit is answered while the worker waits on the device. Each worker wait SHALL be rounded up to the runtime scheduler's whole milliseconds. Each device write made for a command SHALL record a `bunny.device.call` span in the command's trace. The lock files SHALL be created with mode 600. Device and store errors SHALL never fail the module (policy A): no scheduler callback throws, and a publication the store refuses is logged once and tried again. The module SHALL pass the module test kit with its offline check.

#### Scenario: An offline wall at start
- **WHEN** the module starts while its wall never answers
- **THEN** the start returns at once, the device is `unavailable`, commands are still answered, two minutes of failed polls log one warning, and the device is `available` with one recovery record once the wall answers

#### Scenario: A command and an edit while the worker waits on the wall
- **WHEN** the wall holds a worker request and a mode command and a wall edit arrive, under the runtime with its lag check
- **THEN** both are answered at once, the event loop never stalls for 250 ms while the request is held, the edit succeeds while the request is still held, and the lag check stays active

#### Scenario: A store failure
- **WHEN** the module's store refuses its writes so the worker's pass and its failure record both fail, and then takes them again
- **THEN** the device is `degraded` and its wall view `failing` while no worker runs, the worker starts again on its own, a new session takes a Line, and the failed pass and the stopped worker are each logged once, then each recovery once; a store that refuses the module's reads while it publishes is logged once, never fails the module, and the record is published within a second of the store reading again, before the next poll

#### Scenario: Commands while no worker can run
- **WHEN** another instance holds the device's lock and ten commands arrive
- **THEN** each command starts the worker, which ends at once, and one restart waits at a time, so once its wait is the longest the worker starts again once per 30 s, not once per command

#### Scenario: A second take of a lock in the same process
- **WHEN** the device's worker lock, or any other lock file the module opens, is held and a second take of it in the same process is refused
- **THEN** another process is still refused that lock until the first holder lets it go

#### Scenario: The module test kit
- **WHEN** the kit runs the module with a simulated Lines controller, and with one that never answers
- **THEN** every check passes, the offline one included
