## ADDED Requirements

### Requirement: Publish one prepared message without a stream

The SDK SHALL export `prepareMessage(source, draft, {now?, parent?})`, which gives a profile 2.0 message from `source` with a new `id`, the current `time` and a `traceparent` that continues `parent` or starts a new sampled trace, and `publishOnce({url, source, token, timeoutMs}, key, message)`, which sends one prepared message to an edge's `publish` call over `http` without a stream: one POST of `{schema, key, message}` to `<url>/api/sdk/v1/publish`, with the token only in the `authorization` header, the source in `bunny-source` and the message's `traceparent` as a header. `timeoutMs`, an integer from 1 to `MAX_TIMEOUT_MS`, SHALL bound the whole call, connecting included. It SHALL resolve, and never reject for the edge's answer, with `published`; `rejected` with the edge's registry body, or `unavailable` when the edge could not be reached, since then the message was not published; or `uncertain` with `uncertain-result` when the call reached the edge and its answer was lost, late, over 16 KiB or not the edge's, or the edge failed with `internal` or `uncertain-result`, since the message may have been published. Every error body SHALL carry the message's trace ID. It SHALL reject with `SdkError` `invalid-request`, before anything is sent, a malformed deadline, a URL that is not `http`, or a token or source that cannot be sent in a header. It SHALL send nothing again and report nothing but its result.

#### Scenario: Published in one call
- **WHEN** a prepared message is published through an edge with its source's token
- **THEN** the result is `published`, a subscriber on the edge's bus receives the message unchanged, and the edge read one publish call and no stream

#### Scenario: Refused by the edge
- **WHEN** the call carries a token the edge does not grant, a message from another source than the token's, a message outside the token's grant, or a message the profile refuses
- **THEN** the result is `rejected` with `unauthenticated`, `forbidden`, `forbidden` and `invalid-message`, carrying the message's trace ID, and nothing is published

#### Scenario: An edge never reached
- **WHEN** nothing listens on the edge's port
- **THEN** the result is `rejected` with `unavailable` at once

#### Scenario: A lost or foreign answer
- **WHEN** the edge takes the call and never answers, answers `internal` or `uncertain-result`, answers with an unregistered code, a flag that disagrees with the registry, a body that is not JSON, a 200 that is not its publication, or more than 16 KiB
- **THEN** the result is `uncertain` with `uncertain-result`, at the deadline for the silent edge

#### Scenario: The call's headers
- **WHEN** a message is published to a listener that records the call
- **THEN** the call goes to `/api/sdk/v1/publish` with the token in `authorization`, the source in `bunny-source` and the message's `traceparent`, and the body holds the key and the message and no token

#### Scenario: A malformed call
- **WHEN** `timeoutMs` is 0, negative, fractional, over `MAX_TIMEOUT_MS` or not a number, or the URL is `https` or not a URL
- **THEN** the call rejects with `invalid-request` and nothing is sent
