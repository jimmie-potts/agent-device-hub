## Why

[Issue #567](https://github.com/jimmie-potts/agent-device-hub/issues/567) keeps
Codex Desktop's read, archive and title evidence correct when the runtime no
longer runs on the computer that holds the Codex home. The module's reader reads
a local folder, and the accepted Mac core receives the PC's Desktop sessions
over #566's private ingress with no Desktop metadata behind them.

## What changes

- Add the `desktop-metadata` occurrence family: one bounded snapshot of the
  three Desktop inputs for one feed, which a source-bound `ingest` credential
  may publish on `bunny.event.desktop-metadata.<feed ID>`. The edge binds the
  snapshot's feed to the credential's derived source; the core ignores the
  family.
- Let the Codex Desktop module follow a `sources` list: a source with a `home`
  is read locally as before, one without is fed by those snapshots, under the
  same read, settle, archive-expiry and title rules. The released single-source
  section is unchanged.
- Add the host-local collector, `apps/runtime/bin/codex-desktop-collector.mjs`,
  which reads the same files with the module's reader and publishes bounded
  snapshots through `publishOnce` with the existing producer/receipt contract.
- Let the personal container profile admit a remote-only Codex Desktop section
  through a registration predicate, with device control still disabled.
- Mac `client: local` sessions get no Desktop evidence: the session and
  lifecycle contracts keep read, archive and title evidence Desktop-only, and
  an owner decision is pending on how to tell Desktop sessions apart in the
  shared Mac feed.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `runtime-codex-desktop`: the `sources` form, remote sources and the collector.
- `shared-event-contract`: the `desktop-metadata` family.
- `bunny-runtime`: the `ingest` scope and the Desktop-feed admission check.
- `bunny-container-operator`: admission of a remote-only Codex Desktop section.
- `bunny-sdk`: the registration's `hostLocal` predicate.
