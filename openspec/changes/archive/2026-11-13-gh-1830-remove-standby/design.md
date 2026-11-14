## Context

The container profile, core, gateway and SDK edge have standby branches.
The follower used the history snapshot and page modes and a separate token.
Current runtime clients already connect to the Mac's authoritative core.

## Decisions

- Refuse retired profile and peer values at existing configuration boundaries
  before startup. Keep supported control defaults, process ownership checks,
  start holds and private credential prechecks.
- Remove the read modes and standby admission. Ordinary history keeps the
  existing filter and error registry. Active bearer and browser requests keep
  their scope, request and origin checks, revocation and trace handling.
- Keep Automation definitions and their exact retained fact and rollback
  requirements. Stop projecting owner changes into replication payloads.
  Ordinary history keeps per-origin order, spans and gaps.
- Keep shared SDK subscription lifetime, request spans and endpoint guards.
  The removal only affects the SDK's standby edge path.
- Existing SQLite stores keep their retired nullable columns and index. New
  history writes omit those columns. New stores do not create them. There is
  no data deletion or metadata rewrite.

## Risks and validation

Use synthetic stores to check old row retention and ignored owner writes. Use
loopback clients and fake Docker to check admission before state or device
effects, active access and unchanged supported operator arguments. A focused
review checks credentials, store compatibility and writer exclusion.

## Delivery and recovery

The Mac deployment batch owns any installed change. Its normal stopped backup
keeps the retained state. Source exercises establish neither installed
configuration compatibility nor recovery eligibility.
