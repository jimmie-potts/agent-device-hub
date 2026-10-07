## ADDED Requirements

### Requirement: Profile 1.2 registers the B.U.N.N.Y. runtime

The artifact SHALL be version 1.2.0 with profiles 1.0, 1.1 and 1.2, and producers SHALL still default to profile 1.1. Profile 1.2 SHALL be profile 1.1 plus the runtime's vocabulary: the `runtime` service; the `bunny.runtime` scope for the runtime's own records and one `bunny.module` scope for every module's records; the runtime's events; the module events `message.received`, `outbox.republished` and `outbox.acknowledged`; and the attributes they use, among them `bunny.module`, `bunny.source`, `bunny.pattern`, `bunny.code`, `bunny.phase`, `error.type` and `error.code`. `error.type` and `error.code` SHALL be identifiers of at most 64 characters. Profiles 1.0 and 1.1 SHALL reject every profile 1.2 addition. The catalog SHALL list each profile's additions and, for each runtime scope, the services and events it allows. Both runtime scopes SHALL belong to the `runtime` service; a `bunny.module` record SHALL name its module in `bunny.module` and use only the events listed for that scope; the runtime's own events SHALL appear only under `bunny.runtime`. A new runtime or module event or attribute SHALL be a catalog change with fixtures, contract review and the packaged-consumer checks. The Python helper SHALL validate and convert profile 1.2 records without a code change.

#### Scenario: Additions closed to earlier profiles
- **WHEN** a record uses a profile 1.2 service, scope, event or attribute and claims profile 1.0 or 1.1
- **THEN** it is invalid, and projecting such a 1.2 record to 1.1 fails, while a 1.2 record without them projects to 1.1 and a 1.1 record projects to 1.2

#### Scenario: Runtime scope rules
- **WHEN** a record puts a runtime event under `bunny.module` or another scope, a module event under `bunny.runtime`, a `bunny.module` record without its module's name, or either runtime scope under another service
- **THEN** it is invalid

#### Scenario: Cross-language profile 1.2 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the runtime's records and their negative controls: an unregistered event, a raw message, a stack, a URL with a token, a module name with spaces, a missing resource field, a module record under the wrong scope or without its name, and a 1.2 record labeled 1.0 or 1.1
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus and tests against the installed archive

#### Scenario: Schema and catalog agree
- **WHEN** the schema's enums and attribute definitions are compared with the catalog
- **THEN** they list the same versions, services, scopes, events, bodies and attributes, and each body is distinct

#### Scenario: Construction leaves out what the catalog does not register
- **WHEN** a profile 1.2 record is built from input with an unregistered attribute holding a raw message, or with a URL in a registered attribute
- **THEN** the built record keeps profile 1.2 and holds no part of the message, and the record with the URL is refused
