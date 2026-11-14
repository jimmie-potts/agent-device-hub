## Context

The link schedules a 1200 ms deadline before dispatch. The Node HTTP transport has its own whole-exchange deadline. Both compete with the response and with module shutdown. The link already decides which completion counts.

## Goals / Non-Goals

Record the winning branch, elapsed time and local scheduler evidence on existing status and Music reads. [#1663](https://github.com/jimmie-potts/agent-device-hub/issues/1663) owns the installed diagnosis. This source change adds no request, retry, state update or installation action.

## Decisions

The sampler, Music admission and session supply explicit source labels. The link takes one timing sample at the original terminal branch. The HTTP timer identifies its own error privately so that a socket error with the same code remains a different branch.

One module timer probes callback delay while monitored reads are active. Each read tracks completed probes and records the longest observed delay. If a read settles before an overdue probe runs, it records the pending delay separately as a lower bound. Neither measure is physical device time or network latency.

Use the runtime's existing diagnostic writer and sinks. Emit a first failure, a bounded summary during sustained failure and a recovery for each device and read source. The summary and recovery preserve the whole failed run's terminal branch counts and separate observed and pending delay maxima. A recovery keeps short mixed failures visible at INFO even if DEBUG is filtered. Sample successful baselines at DEBUG. The private runtime sinks receive only the approved identifiers, timing and counts. Any configured diagnostic retention or access applies. The new event carries no addresses, credentials, endpoints, request or reply content, exception text or audio. Bounded queues may drop evidence.

## Risks / Trade-offs

The timer measures local scheduling while a read is active. A delay can happen between probes, and hardware and software causes can coexist. Sparse baselines and summaries cannot reconstruct individual unsampled attempts. A stopped or saturated probe skips evidence and cannot alter link settlement.
