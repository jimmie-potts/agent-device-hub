## MODIFIED Requirements

### Requirement: Publish one prepared message without a stream

The SDK SHALL export `prepareMessage(source, draft, {now?, parent?})`, which gives a profile 2.0 message from `source` with a new `id`, the current `time` and a `traceparent` that continues `parent` or starts a new sampled trace, and `publishOnce({url, source, token, timeoutMs}, key, message)`, which sends one prepared message to an edge's `publish` call over HTTP or certificate-verified HTTPS without a stream: one POST of `{schema, key, message}` to `<url>/api/sdk/v1/publish`, with the token only in the `authorization` header, the source in `bunny-source` and the message's `traceparent` as a header. `timeoutMs`, an integer from 1 to `MAX_TIMEOUT_MS`, SHALL bound the whole call, connecting and TLS negotiation included. HTTPS SHALL explicitly verify the server certificate and hostname against the platform trust roots. Certificate refusal or an unfinished TLS handshake SHALL yield unpublished `unavailable`; only an authenticated TLS connection counts as reached. The publisher SHALL NOT follow redirects, downgrade to HTTP or disable verification. It SHALL resolve, and never reject for the edge's answer, with `published`; `rejected` with the edge's registry body, or `unavailable` when the edge could not be reached, since then the message was not published; or `uncertain` with `uncertain-result` when the call reached the edge and its answer was lost, late, over 16 KiB or not the edge's, or the edge failed with `internal` or `uncertain-result`, since the message may have been published. Every error body SHALL carry the message's trace ID. It SHALL reject with `SdkError` `invalid-request`, before anything is sent, a malformed deadline, a URL whose protocol is neither HTTP nor HTTPS or that carries credentials, a query or a fragment, or a token or source that cannot be sent in a header. It SHALL send nothing again and report nothing but its result.

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
- **WHEN** `timeoutMs` is 0, negative, fractional, over `MAX_TIMEOUT_MS` or not a number, or the URL uses another protocol, is not a URL, or carries credentials, a query or a fragment
- **THEN** the call rejects with `invalid-request` and nothing is sent

#### Scenario: Verified HTTPS and a stalled handshake
- **WHEN** the same publication uses a trusted HTTPS peer, an untrusted or wrong-name certificate, or a listener that never completes TLS
- **THEN** only the trusted peer receives the publication; certificate refusal and the bounded unfinished handshake return unpublished `unavailable`, carrying no token in diagnostics

#### Scenario: HTTPS redirect or lost answer
- **WHEN** the authenticated peer redirects to another HTTPS or HTTP destination, or accepts the publication but never answers
- **THEN** the result is `uncertain-result`, no destination is followed and no publication is retried

## ADDED Requirements

### Requirement: Host publication admission

A host-authenticated SDK principal SHALL optionally supply a synchronous, pure
`checkPublication(message)` function. The edge SHALL invoke it only after the
ordinary message schema, authenticated source, routing and family/scope checks,
and before any bus publication. Returning the shared registry error body SHALL
refuse the publication without effects; returning undefined SHALL preserve the
ordinary publication path. The check SHALL grant no additional authority and
SHALL NOT be a remote wire field or stored command. Principals without a check
SHALL retain their existing behavior.

#### Scenario: Host refusal before publication
- **WHEN** a valid permitted publication reaches a principal's host check and the check returns forbidden
- **THEN** the caller receives the ordinary forbidden refusal and no subscriber receives a message; a later permitted publication can still succeed

#### Scenario: Ordinary admission precedes host policy
- **WHEN** a publication has an invalid schema, another source or a key outside its grant
- **THEN** ordinary admission refuses it before the host check is called
