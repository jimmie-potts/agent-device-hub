## MODIFIED Requirements

### Requirement: Lines follow the hub's shared status

The module SHALL keep no session rule of its own. At its feed boundary it SHALL give each task the hub's status through the shared session read function, with Nanoleaf's acknowledgment and read policy: `blocked` for a member that needs the owner with an approval or input, `question` for a member that needs the owner with a question, and otherwise its root's status: `working` for a working root, `unread` for a root that is finished for Nanoleaf, and `idle` for a root that is quiet or whose status is `unknown`, including a new task whose first status is `unknown`. A subagent's work SHALL reach the task only through its root's status, so a subagent whose work the hub no longer confirms SHALL NOT hide the root's finished turn. Beyond idle's own steady slot, a task SHALL be held steady only when it is working on its root's own active work and the hub no longer confirms that work. No evidence age, member freshness or retained earlier status SHALL change what a task shows. Waiting and unread tasks SHALL keep their indication until the hub's status changes, subject to the module's mode and connection rules. Effects, wave epochs, source reservations and the frozen state of a lost copy SHALL stay unchanged, and reconnection or resync SHALL NOT replay an arrival wave or a comet.

#### Scenario: A question left waiting
- **WHEN** a task raises a question in Work and stays silent for ten minutes
- **THEN** its Line keeps the question's alert animation throughout, a working task silent for the same time keeps working, and only a working task whose work a core restart left unconfirmed holds steady

#### Scenario: An unread finished task
- **WHEN** a task's turn ends in Work and nobody reads or acknowledges it for ten minutes
- **THEN** its Line keeps its unread indication throughout, and it turns idle at once when Nanoleaf acknowledges the notice or read evidence arrives, and working when a new turn starts

#### Scenario: A silent subagent under a finished root
- **WHEN** a task's root finishes its turn while a subagent is working, and a core restart then leaves the subagent's work unconfirmed
- **THEN** the Line shows the root's unread turn, not held steady, as LIFX and the Tidbyt tile show it done

#### Scenario: Unknown status
- **WHEN** a task shown as working turns `unknown` in the hub's status, and a new task's first status is `unknown`
- **THEN** both show idle at once, with no earlier status retained, and the next known status replaces it

#### Scenario: Reconnect while waiting
- **WHEN** the module's copy is lost and synced again while a task waits on an approval
- **THEN** the task's alert resumes with no wave or comet replayed
