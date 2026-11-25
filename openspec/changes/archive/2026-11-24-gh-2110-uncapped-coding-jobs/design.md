## Admission and observation

Current workers explicitly declare uncapped admission. Absent that declaration,
the coordinator applies the worker's finite behavior. Start ownership, setup
waiting, setup execution and harness execution are distinct observations.
A queue observation renews only the waiting allowance. An acquired setup lock
and a ready worktree each start their own bounded phase. While the core
dispatch is outstanding, the coordinator owns its assignment to the selected
connection. Losing that selection definitively closes starts the coordinator
has yet to send and fences late core forwards, including after brief storage
failures. For a start already handed to the worker transport, loss remains
uncertain. After a process restart the coordinator uses durable evidence and
treats an interrupted handoff as uncertain when send evidence is absent.

## Worktree and paging

Serialize conflicting Git setup by repository identity. A cancelled attempt
checks its own stop after acquiring the lock and skips setup. Each attempt keeps
its own worktree and process. Uncapped state publishes a bounded summary, and
an authenticated content read pages by stable job identity. The page limit
has no effect on dispatch or named stop.
