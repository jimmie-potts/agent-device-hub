## MODIFIED Requirements

### Requirement: One playback module with private speaker configuration

The runtime SHALL host one module, `playback` (module API 1.2), that owns both the Sony HT-A9 and the Sonos Move sources, because the presented-source rule needs both in one owner and modules cannot import each other. Its `configure` SHALL accept a section with exactly an `id`, a routing ID of lowercase letters and digits with single hyphens and at most 128 characters, a `sources` list of one or two speakers in preference order with at most one of each kind, and optionally a `secrets` member, which it does not use. A Sony speaker SHALL be `{kind: "sony", endpoint}` with an endpoint `http://<numeric private or loopback IPv4>:<port>/sony`, and a Sonos speaker `{kind: "sonos", endpoint}` with the exact control URL `http://<numeric private or loopback IPv4>:<port>/MediaRenderer/AVTransport/Control`, neither with credentials, a query or a fragment. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name the record's `id` as its one device. A speaker's address SHALL NOT appear in any message, log record, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `living-room` and the Move then the HT-A9 at private addresses
- **THEN** the runtime accepts it, the module's device is `living-room`, and its configuration keeps the speakers in that order

#### Scenario: Sections the module refuses
- **WHEN** the section lists no speaker or three, repeats a kind, uses the former `selected` form, adds a member, gives an ID with capitals, underscores, dots, a repeated hyphen or more than 128 characters, or gives an endpoint that is HTTPS, public, named, portless, credentialed, with a query or fragment, or on another path
- **THEN** the runtime refuses the module with `invalid-request`, its detail quotes no address, and the other modules run

#### Scenario: No section
- **WHEN** the configuration file has no `playback` section, or there is no file
- **THEN** the runtime refuses the module with `not-found` and runs the others

## ADDED Requirements

### Requirement: Passive reads of current playback artwork

The playback owner SHALL provide its current bounded normalized PNG through its authenticated module content contribution, addressed by artwork generation and playback record revision. Content SHALL be available only for the exact current available, known playing or paused Sony observation whose committed ready record matches the owner's current artwork and metadata. Malformed, missing, obsolete, stale, unavailable, stopped or mismatched references SHALL return the existing safe missing-content result. Stop and abort SHALL retire content from that run. A read SHALL perform no receiver fetch, worker decode, publication, revision change, freshness reset or command. It SHALL expose neither a receiver URL nor credentials, listening metadata or native exception text. The existing gateway read authority, no-store and nosniff policies SHALL protect the returned PNG.

#### Scenario: Several consumers read the same thumbnail
- **WHEN** multiple authorized read-only consumers request the current ready thumbnail
- **THEN** they receive the same bounded PNG without another acquisition, decode, state publication or command

#### Scenario: Replacement precedes publication
- **WHEN** the owner has moved to another candidate or observation while the committed record still identifies earlier artwork
- **THEN** the earlier reference returns missing content until the exact current ready record and private snapshot agree

#### Scenario: Generation persists while the record changes
- **WHEN** a playing-to-paused transition or same-generation candidate replacement publishes a newer record revision
- **THEN** its new reference is distinct, the old revision reference returns missing content, and only the current matching ready image is served

#### Scenario: Source, freshness and run boundaries
- **WHEN** the presented source becomes Sonos, playback becomes stale, unavailable or inactive, publication rolls back, or the module stops or restarts
- **THEN** previously issued image references cannot serve obsolete artwork and content reads cause no recovery effect

#### Scenario: Authority and safe errors
- **WHEN** an unauthenticated caller, an authenticated caller without read authority, or an authorized caller with an obsolete or absent artwork reference requests content
- **THEN** the existing gateway returns respectively its safe authentication, authorization or missing-content response without echoing private input, malformed gateway references retain the existing input refusal, and valid content uses image/png, no-store and nosniff
