## Design

Companions stores the stable job ID, originating conversation and exchange, approved repository and brief, and the first attempt's operation ID. The operation ID stays on the existing tracked dispatcher and worker messages. The Conversation receipt names the job as queued. The model can finish the turn immediately.

A durable waiting record is marked sending before dispatch. The existing worker slot rules still apply. An ambiguous send stays uncertain at recovery. A known unsent job retains its place. A terminal result and its pending delivery commit together. The Conversation message uses a deterministic ID and links to the original receipt, so repeating delivery after a crash produces one visible result. Older LangGraph delegation checkpoints keep their graph nodes and settlement path.

A Conversation cancellation does not stop a job already saved. A named stop targets one attempt. The worker's acceptance of that request does not prove the worker stopped. An unanswered stop remains visibly uncertain until a terminal observation arrives.
