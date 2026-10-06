## Context

See proposal.md for why. ADR 0012 says each outcome is saved, marked unreported, in the module's own transaction and published after the commit; it is published again after a restart until the core has it, and the core drops duplicates by `(source, id)`. It does not say how a module learns that the core has it. The core does not exist yet. ADR 0012 also forbids replay: its only exception is reporting a module's unreported outcome again after a restart. The runtime is one process, but #880's failure isolation stops a failed module, the core included, while the others keep running. The bus's `publish` always made a new `id` and `time`; #883 adds `publishMessage`, which sends a prepared message unchanged. A module's tests may import only the SDK and the contracts packages, never the runtime.

## Goals / Non-Goals

**Goals:**
- A crash at any point never loses a message a module committed to its outbox.
- A message goes out only after the transaction that made it committed, and a rolled-back one never goes out.
- No command is ever stored or sent again.
- One conformance suite that any module runs in a few lines, under any test runner.

**Non-Goals:**
- The core's acknowledgment message. It belongs to Hub #782; the kit offers a stand-in until then.
- The core's tracker, inbox and deduplicating store. The stand-in core in the tests only shows what the core must do.
- Remote parts' outboxes. A remote part (#883) may use the same class later.

## Decisions

**Only outcomes wait for an acknowledgment; nothing else is ever sent again.** This was decided in the PR #912 review round, which found the first design's premise wrong.
- A state, removal or occurrence row is deleted as soon as it has gone out. A row that a crash kept from going out goes out at the next start. That is not replay, because nothing received it before.
- An outcome row stays after it goes out, until `acknowledge(id)` deletes it. Every start resends every outcome still stored, and the core drops the duplicates durably by `(source, id)`. That is the one resend ADR 0012 allows: a module's unreported outcome.
- The core's acknowledgment message belongs to Hub #782, which records the hand-off. Until then the kit's stand-in core acknowledges with an occurrence on `bunny.event.stand-in-ack.<module>`, and `followStandInAcks` passes it to `acknowledge`, so the fixture tests exercise deletion.

Rejected:
- **Forgetting a published message after `retainMs` of run time.** This was the first design. It assumed every crash restarts the module, but under #880's failure isolation a failed core stops while device modules keep running. An outcome published while the core was down then reached no subscriber and was forgotten 60 s later: lost. It also resent the last minute's states and occurrences at any restart, which is replay.
- **Retention by wall-clock age across runs.** A message published just before a power cut would be pruned at a restart an hour later, unsent: a lost outcome.
- **Retention by count, such as the newest 64.** Every restart would resend old states and occurrences, which is replay.
- **Resending outcomes while the module runs, on a timer.** It would cover a core that recovers without the module restarting, but it needs a retry policy and timers for every module. The next start resends them, and the core's tracker marks a command uncertain at its deadline meanwhile.

**What is stored is what goes out, both times.** `add` builds the envelope with the module's source, a new `id`, the clock's `time` and a child of `parent`'s trace, stores it as JSON, and returns the parsed stored form. Publishing reads the rows back, so the first send and every resend compare as `duplicate` under `compareDelivery`, even for a payload whose `undefined` fields JSON drops.

**The outbox opens a synchronous transaction itself.** `transaction(work)` runs `BEGIN IMMEDIATE`, `work(add)` and `COMMIT`, then publishes. `node:sqlite` is synchronous, so the work is too; work that returns a promise rolls back with a `TypeError`. A database already in a transaction is refused with `invalid-state`, because publishing after someone else's commit cannot be guaranteed. Alternative: `add` inside the caller's own transaction plus a separate flush. A module could then forget the flush, or flush before its commit.

**Sends run one at a time, in commit order.** One promise chain serializes the publishes after each commit and the restart's republish, so no message goes out twice in one run or overtakes an earlier one. A refused publish stops the send; the rest stay stored for the next transaction or restart, and `transaction` rejects although the work committed.

**`add` checks the kind and key before storing.** A command, a reply, a sync message or a message on the wrong key class is refused with `invalid-request` and rolls the transaction back. A stored row that `publishMessage` would refuse would otherwise block every later message.

**`republish()` is the module's call at start.** The consumer must be listening when it runs, and the module must already follow the core's acknowledgments, or it misses the acknowledgment of a resent outcome until its next start. In the runtime, the core will start before the device modules, as their syncs from the core already need. The fixture's stand-in core serves the mode and subscribes before its start first awaits, and the runtime runs that start before the lamp's. An outcome that goes out while the core is down is resent at the module's next start.

**One kind-to-key-class mapping.** `keyClassOf` in `routing.ts`, an exhaustive switch over every message kind, serves both the bus and the outbox, so the two cannot disagree about which kinds are published and on which key class.

**The kit hosts modules with its own harness.** The module boundary refuses an import of the runtime from a module's tests, so `ModuleHarness` in `@jimmie-potts/sdk/testing` gives a module a context and a stop in the runtime's order. Like the runtime, it gives the module its participant without `close`, and its participant close and `stop()` each have a 5 s deadline, after which, or after a throw, the stop goes on; the harness records each as a failure. The manifest checks move to the SDK so that both refuse the same manifests. Each check runs a fresh instance on its own bus and state directory, validates every message it sees, and fails when the module's handlers, timers or workers fail. A check runs only when the spec names what it needs, so a module that only consumes runs the manifest, lifecycle and copies checks. `conformanceChecks` returns `{name, run}` so that Vitest suites, such as Pixoo's, can run the same checks; only `moduleConformance` loads `node:test`, through `process.getBuiltinModule`, and the checks were run under Vitest.

**The kit detects an outbox by the resend.** After the accepted command's outcome appears, the kit restarts the module on the same database, without acknowledging the outcome, and expects the same outcome again, unchanged. A module that publishes its outcome directly never sends it again.

**The crash test kills a real process.** The fixture lamp takes a `beforePublish` hook that runs just before each message leaves its outbox. The test's runtime process passes one that sends itself SIGKILL, so the kill falls after the commit and before any publish. At the first restart on the same state directory the lamp sends its three messages, and the stand-in core takes the outcome once and acknowledges it. At the second restart the lamp sends nothing.

## Risks / Trade-offs

- [Until Hub #782 adds the core's acknowledgment, outcome rows only grow.] → #782 records the hand-off and must land before the cutover (#840). The core already drops the resends by `(source, id)`, so they are safe.
- [An outcome that goes out while the core is down waits for the module's next start.] → The core's tracker marks the command uncertain at its deadline, so it shows in the inbox until the outcome arrives.
- [A consumer whose full queue drops a state or occurrence never gets it again.] → It syncs, as ADR 0012 requires; an occurrence is lost to it, which is the bus's slow-consumer rule. A dropped outcome goes out again at the next start.
- [A consumer that is not listening yet when `republish()` runs misses the resend until the next start.] → The core story starts the core first. Until then, the tests order the stand-in core first.
- [Each `add` serializes the message once.] → The outbox stores it durably anyway; in-process messages elsewhere still pass as objects.
- [`transaction` rejects after a commit when publishing is refused.] → The README says so; the messages stay stored and go out at the next transaction or start.
