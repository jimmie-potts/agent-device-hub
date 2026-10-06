## Context

See proposal.md for why. ADR 0012 says each outcome is saved, marked unreported, in the module's own transaction and published after the commit; it is published again after a restart until the core has it, and the core drops duplicates by `(source, id)`. It does not say how a module learns that the core has it. The core does not exist yet. The runtime is one process: a module, the bus and the core share it, and every crash ends in a restart of all of them. The bus's `publish` always made a new `id` and `time`; #883 adds `publishMessage`, which sends a prepared message unchanged. A module's tests may import only the SDK and the contracts packages, never the runtime.

## Goals / Non-Goals

**Goals:**
- A crash at any point never loses a message a module committed to its outbox.
- A message goes out only after the transaction that made it committed, and a rolled-back one never goes out.
- No command is ever stored or sent again.
- One conformance suite that any module runs in a few lines, under any test runner.

**Non-Goals:**
- An acknowledgment protocol between the core and the modules.
- The core's tracker, inbox and deduplicating store. The stand-in core in the tests only shows what the core must do.
- Remote parts' outboxes. A remote part (#883) may use the same class later.

## Decisions

**The core "has" a message once the module has kept running for `retainMs` after publishing it.** In one process, publishing hands the message to every subscriber's queue at once. The only way the core can then miss it is a crash before its handler commits it, and every crash restarts the module. So the outbox keeps each published message, marked with the run that published it, and that run forgets it `retainMs` later (60 s by default) on the module's scheduler. A restart sooner sends it again, and the consumer drops the duplicate by `(source, id)`. A run forgets only what it published itself, so a message an earlier run left unconfirmed stays until a run sends it again.

Alternatives:
- **An acknowledgment from the core.** The module would delete a message when the core confirms it, which also covers a consumer that dropped it from a full queue. It needs a new core family or command, a core that sends it, and a decision about acknowledgments sent while the module is down. That belongs to the core story. Rows can later be deleted on an acknowledgment without changing what is stored.
- **Retention by wall-clock age across runs.** A message published just before a power cut would be pruned at a restart an hour later, unsent: a lost outcome.
- **Retention by count, such as the newest 64.** Every restart would resend the last outcomes however old, so a fresh view would show stale occurrences again; ADR 0012 rules out replaying past occurrences.

**What is stored is what goes out, both times.** `add` builds the envelope with the module's source, a new `id`, the clock's `time` and a child of `parent`'s trace, stores it as JSON, and returns the parsed stored form. Publishing reads the rows back, so the first send and every resend compare as `duplicate` under `compareDelivery`, even for a payload whose `undefined` fields JSON drops.

**The outbox opens a synchronous transaction itself.** `transaction(work)` runs `BEGIN IMMEDIATE`, `work(add)` and `COMMIT`, then publishes. `node:sqlite` is synchronous, so the work is too; work that returns a promise rolls back with a `TypeError`. A database already in a transaction is refused with `invalid-state`, because publishing after someone else's commit cannot be guaranteed. Alternative: `add` inside the caller's own transaction plus a separate flush. A module could then forget the flush, or flush before its commit.

**Sends run one at a time, in commit order.** One promise chain serializes the publishes after each commit and the restart's republish, so no message goes out twice in one run or overtakes an earlier one. A refused publish stops the send; the rest stay stored for the next transaction or restart, and `transaction` rejects although the work committed.

**`add` checks the kind and key before storing.** A command, a reply, a sync message or a message on the wrong key class is refused with `invalid-request` and rolls the transaction back. A stored row that `publishMessage` would refuse would otherwise block every later message.

**`republish()` is the module's call at start.** The consumer must be listening when it runs. In the runtime, the core will start before the device modules, as their syncs from the core already need. The fixture's stand-in core serves the mode and subscribes before its start first awaits, and the runtime runs that start before the lamp's.

**The kit hosts modules with its own harness.** The module boundary refuses an import of the runtime from a module's tests, so `ModuleHarness` in `@jimmie-potts/sdk/testing` gives a module a context and a stop in the runtime's order. The manifest checks move to the SDK so that both refuse the same manifests. Each check runs a fresh instance on its own bus and state directory, validates every message it sees, and fails when the module's handlers, timers or workers fail. `conformanceChecks` returns `{name, run}` so that Vitest suites, such as Pixoo's, can run the same checks.

**The kit detects an outbox by the resend.** After the accepted command's outcome appears, the kit restarts the module on the same database and expects the same outcome again, unchanged. A module that publishes its outcome directly never sends it again.

**The crash test kills a real process.** The fixture lamp takes a `beforePublish` hook that runs just before each message leaves its outbox. The test's runtime process passes one that sends itself SIGKILL, so the kill falls after the commit and before any publish. Two restarts on the same state directory show the core taking the outcome once, then dropping the resend.

## Risks / Trade-offs

- [A consumer backlog longer than `retainMs` at a crash, or a full consumer queue, loses a message.] → The core's tracker records the command as uncertain at its deadline, so it shows in the inbox. An acknowledgment can replace the retention later.
- [A restart within `retainMs` resends the newest messages, and a view without memory of them shows them again.] → Only for one minute's messages, and only after a crash or restart; the core drops them.
- [A consumer that is not listening yet when `republish()` runs misses the resend.] → The core story starts the core first. Until then, the tests order the stand-in core first.
- [Each `add` serializes the message once.] → The outbox stores it durably anyway; in-process messages elsewhere still pass as objects.
- [`transaction` rejects after a commit when publishing is refused.] → The README says so; the messages stay stored and go out at the next transaction or restart.
