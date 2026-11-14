## Context

The link already owns request settlement. Its timer, the Node timer, HTTP error status, ordinary rejection and reply have distinct diagnostic terminal branches. An ordinary rejection carries the original error as the local cause.

## Decisions

The real adapter accepts a synchronous diagnostic callback for one timed GET. A link retains only that invocation's classification and uses it only when its generic rejection wins. An injected adapter without classification reports unknown. The public HTTP transport injection remains available. A private callback avoids attributing one invocation's metadata to another that rejects with the same error object.

At existing setup, request-error, response-body and successful-response decode boundaries, assign a fixed category. Read only exact allowlisted codes in an own data descriptor. Keep both deadline paths, the original error and every domain decision. The callback and sink can fail without changing settlement.

Retain whole-run counts for the 14 possible stage and category pairs by device and source, with independent saturation. A summary and recovery retain classification counters from the same run as their terminal counters. The former still follows the existing DEBUG limit and the latter uses INFO.

Use the existing diagnostic contract and private sinks. Profile 1.11 validates the source record before an explicit projection to 1.10 removes optional classification and counters. This preserves truthful timing and avoids imposing new reader requirements on consumers that can explicitly project. Earlier profiles continue refusing Nanoleaf timing events. Legacy default producers remain at 1.1.

## Limits

A code-derived classification says where the local adapter received a failure. It cannot identify whether the network or light caused it. This source change adds no collection path or physical test.
