## Why

[Hub #2170](https://github.com/jimmie-potts/agent-device-hub/issues/2170) needs to match an approved coding step to its repository, harness and execution environment. The current single endpoint cannot distinguish a busy Mac from an eligible PC or an enrolled cloud worker.

## What Changes

The Hub selects a worker independently of the harness and records its reason with the attempt. Each enrolled worker declares its repositories, revision and bounded capabilities over its authenticated endpoint. Conversation and Jobs show the request, destination, harness and outcome.

## Capabilities

### Modified Capabilities

- `bunny-coding-delegation` gains destination eligibility, ranking and attempt-bound routing.

## Impact

The change extends the coding worker contracts, runtime gateway and tracked dispatcher, Companions job coordinator and store, assistant approval, and Jobs and Conversation controls. The established Mac credential and historical jobs remain supported.
