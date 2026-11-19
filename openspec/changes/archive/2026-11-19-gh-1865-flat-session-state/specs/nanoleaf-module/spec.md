## MODIFIED Requirements

### Requirement: The core's sessions through sync

The module SHALL follow the core's `session` records through the SDK's sync, never a 1.x feed, read each through the contracts package's shared session read function, and adapt the view to its existing projection at its feed boundary without rewriting the Lines projection. It SHALL keep its copy of them in memory only, rebuilt by sync after a restart; no row SHALL hold the core's sessions. A sync that completes, the first or one after an overflow, SHALL be projected as a fresh start, so no comet or wave replays across a gap; each live change after it SHALL be projected as one change. The section's shared-input configuration SHALL be applied at start: a new one pauses shared input, and the module SHALL select shared input again with the synced sessions right after, as a fresh start that keeps epochs and replays nothing. A projection or failure report carrying the shared-input generation from before a new configuration SHALL change nothing; inside one runtime this guard is defensive, since the feed's generation moves with each projection, and the workers' lock files keep a second runtime off the same state. A shared-input configuration SHALL need no 1.x feed endpoint or token file, and one with `bindings` SHALL stay refused. A copy that stops following the core SHALL freeze the tasks steadily until a later sync, which the module SHALL try again with capped backoff, logging the failure and the recovery once each.

#### Scenario: A working session on a Line
- **WHEN** the core publishes a working session from a qualified source
- **THEN** the wall view shows it on an element and the Lines show its indicator; a session from another source is skipped

#### Scenario: A new task's wave and a finished turn's comet
- **WHEN** a session starts working after the first sync, then finishes its turn in Work
- **THEN** the Lines show one outward wave that does not loop, then the task's own loop, then one comet for the finished turn, and the task stays unread

#### Scenario: A resync after an overflow
- **WHEN** a burst of session changes overflows the module's sync subscription, so the SDK syncs again without a failure, and a turn ends in the gap
- **THEN** the completed sync is projected as a fresh start: no comet plays for that turn and no wave for the sessions that started in the gap

#### Scenario: A new configuration at a restart
- **WHEN** the module restarts with another qualified source
- **THEN** shared input is paused and selected again, both sources' sessions show, and no wave or comet replays

#### Scenario: A stale generation
- **WHEN** a feed that selected shared input projects, or reports a failure, after another configuration selected it again
- **THEN** the projection is refused and no row changes

## ADDED Requirements

### Requirement: Lines follow the hub's shared status

The module SHALL keep no session rule of its own. At its feed boundary it SHALL give each task the hub's status through the shared session read function, with Nanoleaf's acknowledgment and read policy: `blocked` for a member that needs the owner with an approval or input, `question` for a member that needs the owner with a question, and otherwise its root's status: `working` for a working root, `unread` for a root that is finished for Nanoleaf, and `idle` for a root that is quiet or whose status is `unknown`, including a new task whose first status is `unknown`. A subagent's work SHALL reach the task only through its root's status, so a subagent whose work the hub no longer confirms SHALL NOT hide the root's finished turn. Beyond idle's own steady slot, a task SHALL be held steady only when it is working on its root's own active work and the hub no longer confirms that work. No evidence age, member freshness or retained earlier status SHALL change what a task shows. Waiting and unread tasks SHALL keep their indication until the hub's status changes, subject to the module's mode and connection rules. Effects, wave epochs, source reservations and the frozen state of a lost copy SHALL stay unchanged, and reconnection or resync SHALL NOT replay an arrival wave or a comet.

#### Scenario: A question left waiting
- **WHEN** a task raises a question in Work and stays silent for ten minutes
- **THEN** its Line keeps the question's alert animation throughout, and a working task silent for the same time holds steady once its work is unconfirmed

#### Scenario: An unread finished task
- **WHEN** a task's turn ends in Work and nobody reads or acknowledges it for ten minutes
- **THEN** its Line keeps its unread indication throughout, and it turns idle at once when Nanoleaf acknowledges the notice or read evidence arrives, and working when a new turn starts

#### Scenario: A silent subagent under a finished root
- **WHEN** a task's root finishes its turn while a subagent is working, and the subagent then stays silent for five minutes
- **THEN** the Line shows the root's unread turn, not held steady, as LIFX and the Tidbyt tile show it done

#### Scenario: Unknown status
- **WHEN** a task shown as working turns `unknown` in the hub's status, and a new task's first status is `unknown`
- **THEN** both show idle at once, with no earlier status retained, and the next known status replaces it

#### Scenario: Reconnect while waiting
- **WHEN** the module's copy is lost and synced again while a task waits on an approval
- **THEN** the task's alert resumes with no wave or comet replayed
