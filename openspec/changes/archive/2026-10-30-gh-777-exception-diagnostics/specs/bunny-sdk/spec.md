## ADDED Requirements

### Requirement: Filtered exception fields

The SDK SHALL offer `exceptionFields(error, {filter?})`, the one reader of an exception's message and stack in the runtime and its modules, whose result a module MAY add to its own `operation.failed` record and the runtime adds to its fault records (`faultFields`). It SHALL read only an `Error`'s own `message` as a string data property and its own `stack` as a string data property or through V8's own native accessor; it SHALL invoke no getter a value or its class defines, read no `cause`, `errors` list or other member, and return `{}` for a value that is not an `Error` or has no text. It SHALL remove control characters other than tab and newline; apply the caller's filter first, then replace authorization and API-key values (keeping a scheme word), a URL's user information, credential-named parameters and JSON members, well-known key shapes including this repository's `tok_` tokens, and long opaque runs with letters and digits outside a path with `[redacted]`; then replace a JSON-shaped block and a quoted string longer than 128 characters on one line with `[omitted]`; count each replacement in `bunny.exception.redacted_count`; and cut each text to 1,024 characters and bytes for the message and 4,096 for the stack, a stack between its frames, with a `[truncated]` marker and `bunny.exception.truncated` true. The level table SHALL give `telemetry.dropped` WARN.

#### Scenario: Allowed context survives
- **WHEN** a module's error names a device address, a file path and the frames where it arose
- **THEN** the message, the frames, the path and the address are in the fields, with zero replacements and no truncation

#### Scenario: Credential and payload canaries do not
- **WHEN** an error's message holds a bearer token, an API key header, a URL with user information and a token parameter, a JSON password member, a personal access token, a cloud key, a JWT, a long hexadecimal signature, a secret the caller's filter names, a long quoted prompt and a long JSON body
- **THEN** none of those values is in either field, the header, the URL's host and route and the JSON's other members remain, each replacement is counted, and the record the fields complete is valid at profile 1.7 and invalid at 1.6

#### Scenario: Hostile and empty values
- **WHEN** a non-Error object with getters named `message` and `stack`, an `Error` subclass with its own `stack` getter, an `Error` whose `stack` a caller redefined as an accessor, an error with a cause and an `AggregateError` whose errors hold a secret, an error whose message is not a string, and an error with an empty message and stack are serialized
- **THEN** no getter runs, the subclass's record carries V8's own stack, the redefined stack and the non-string message are left out, no secret appears, and the empty error yields `{}`

#### Scenario: Bounds
- **WHEN** a message of 5,000 characters, a message of 1,000 three-byte characters and a stack of 200 frames are serialized
- **THEN** each text is within its limit in characters and in UTF-8 bytes, the stack ends at a whole frame before its marker, and the truncation flag is true
