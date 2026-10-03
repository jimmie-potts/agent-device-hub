## Why

The installed collector stops with `source-schema` on the owner's Wispr 1.6.1034 database. Its History table uses `transcriptEntityId`, `timestamp DATETIME` and `app`, while the accepted fixture profile uses `id`, a textual timestamp declaration and `appName`. Metadata and isolated synthetic production-reader probes confirmed the mismatch. The owner approved this separate compatibility repair under [#472](https://github.com/jimmie-potts/agent-device-hub/issues/472).

## What Changes

- Add one fixed native History mapping for the observed identifier and destination fields, accepting its DATETIME declaration with the existing strict timestamp parser.
- Preserve the existing profile, bounded read-only access, column allowlist, private paths, retention and aggregate format.
- Qualify numeric and opted-in language collection with synthetic native Windows fixtures; missing edit-observation evidence remains unknown.
- Deliver a new immutable collector package before installed acceptance resumes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wispr-collector`: explicitly support the qualified native History schema alongside the existing fixture profile.

## Impact

Collector source reader, synthetic/native tests, package identity and owning runbook. The versioned `@jimmie-potts/wispr-contracts` aggregate boundary and existing Hub consumers are unchanged. No cloud service, arbitrary column configuration, source migration, permission repair or product-default change is added. Installation, live semantic comparison, scheduling and one-day acceptance remain in #472.
