## Ownership and configuration

Capture the optional peer from verified config and hand it to the original
standby core. With no receiver, a valid configuration leaves local health
available and performs no token read or peer I/O. With a receiver, load the
outgoing bearer in the background through the protected-file reader. Require
a canonical HTTPS origin and reject redirects. Keep private inputs and raw
errors out of diagnostics.

## Reads and durable progress

Register all selected settings subscriptions before reading. One dirty flag
coalesces eligible signals and overflow. Compare signal projections with
verified receiver values. A newer signal during an ambiguous read or apply
can prompt another read even when it equals a previously verified value.
Signal data supplies neither applied settings nor comparison baselines.

Pin the first history head, scan over skipped rows and apply sealed slices.
Buffer up to two projected facts from an open revision. Verify origin, exact
tokens, scan bounds and transaction order. Bound body size and the total read
time. The caller owns one cancellable capped recovery loop. Steady-state
transport schedules no history reads.

The receiver offers metadata, a guarded optional projection of the same
committed owners, snapshot replacement and sealed apply. Exact expected
state includes the source checkpoint and private replacement generation.
Apply receipts give final touched projections or tombstones. A terminal
commit or complete replacement records the local completion time. Incoming
checkpoints, private replacement generations and local export epochs are
distinct.

## Failure and recovery

After a lost receipt, discard the volatile pass and reread committed state.
Repeat a validated terminal read when its metadata-only receipt was lost.
Reject a foreign origin. A typed continuity refusal retires the old stream.
After resubscribing, validate a same-origin replacement against exact expected
state, including when the sequence is reused. Older-writer recovery explicitly requests replacement
even at sequence zero. Retain that intent until verification and reassert
it after interruption. A matching anchor does not reveal an unlogged edit.

Stop cancels transport, fences queued receiver operations and waits for any
entered commit before lease release. The receiver owns the atomic settings,
provenance, progress and completion write. The follower reads and subscribes.
