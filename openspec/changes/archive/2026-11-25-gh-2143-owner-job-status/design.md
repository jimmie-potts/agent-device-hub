## Context

A Conversation can finish its delegation turn while the worker continues. Jobs already resolves the latest attempt and verifies permission to inspect its original and current operation.

## Decisions

Resolve one full job ID against the indexed Jobs query. Bind the returned job to the asking companion and conversation. Save its operation and reported status inside the local task record in the input transaction. Retrying the same request ID uses the existing input receipt.

The conversation history and knowledge library share message records. Save neutral text in those rows. The private Conversation page renders the owner’s question and answer only after checking its current conversation, task and coding grants. It withholds the original status after an attempt changes and checks access to that prior attempt before reporting the change. The task record carries these optional fields without changing existing rows.

A question arriving as a steer waits in the existing conversation queue. A mixed request receives a local clarification. The owner can still use the dedicated job controls.

## Verification and recovery

The disposable Conversation exercises a running worker, access loss, restart, replacement of an attempt, continued normal conversation and an ordinary provider request after the private answer. A denied or unavailable job produces the same local reply as an unknown ID. The worker and its job state have no new writer.
