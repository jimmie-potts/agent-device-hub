## Context

A producer publication acknowledgment and a consumer feature acceptance are independent observations. A worker can permanently retire its input while core capture later accepts another feature.

## Goals

Distinguish the last known producer dequeue, publish attempt, publish acknowledgment, core acceptance and worker acceptance. Preserve every existing admission, expiry, restoration, retry and restart rule. Historical attribution requires evidence from the affected run.

## Decisions

Use process-local bounded sequence checkpoints and relative ages. Acknowledgment describes settlement of the existing publish call. Join checkpoints by the existing validated capture generation and sequence. Never subtract monotonic readings from different processes. Emit at most one immediate loss/recovery pair per 60 seconds. Coalesce further episodes with a saturating count and retain their last loss checkpoint with its ages as measured at loss. Flush coalesced evidence at the trailing boundary or termination, and allow at most one terminal record per generation. Record worker loss once per playing session. The producer observes its timers without driving work and cleans them up when retired. Runtime subscription overflow retains its existing delivery-drop record and also identifies the first retirement cause at the worker.

Publish only catalog-admitted static event text, fixed labels, and bounded integers through existing sinks. Audio, feature values, titles, addresses, raw errors and endpoint and request identifiers are omitted. The capture generation is the sole cross-process correlation field.

## Limits

A delayed observer and a silent failed sink can omit a checkpoint. The available evidence can identify which stage last witnessed progress without proving that an upstream stage caused a later deadline.
