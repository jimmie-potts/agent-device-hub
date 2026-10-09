## Context

See the proposal for scope and #892 for the consumer inventory. The Guide tree
owns unrelated maintenance parsing and its workflow owns retained document checks.
Places is shared by static documents and both dashboards.

## Goals / Non-Goals

Keep one parser and one navigation manifest. Remove source obligations for the
retired publication without changing runtime storage, controllers, installation,
private records or the separately hosted site.

## Decisions

Extract parser/upsert and Markdown section handling into maintenance, with the
historical Guide-heading fingerprint exclusion as a literal compatibility rule.
Keeping an import shim would leave a deleted provider dependency. Saved-backlog
reporting and HTML rendering have no retained consumer and are removed.

Keep the diagram/atlas checks as a separate job in the existing Workflow workflow.
This retains Markdown coverage and browser evidence without bringing back Guide CI.
Preserve ordinary preflight CI identity, review, proof and finish-line checks;
remove the special Guide flags, records and nightly-refresh issue exemption.

Remove the Guide entry from the shared Places manifest and regenerate retained
pages. Leave all other destinations and preview-specific loopback restrictions
unchanged. The exporter stages only atlas/reference/architecture files; it neither
writes a replacement root landing page nor publishes or deletes remote files.

## Risks / Trade-offs

- Lost shared consumers: inventory imports, fixtures, commands and links before deletion;
  run parser, closeout, preflight, document and dashboard navigation regressions.
- Changed assessment hashes: preserve exclusions and prove unchanged fingerprints,
  while scope edits must still mark recommendations stale.
- Accidental CI loss: compare live rules and workflow identities, preserve all
  non-Guide jobs and assert retained checks and artifacts in the workflow suite.
- Historical links: leave immutable receipts, archived changes and dated source
  snapshots intact; active instructions use retained owners.

## Migration Plan

Merge independent diagram extraction first, extract maintenance consumers, remove
Guide source and update current specs/instructions/tests together. Deliver through
reviewed source and exact-revision CI. Reverting the PR restores source; it does
not restore, alter or qualify an installed runtime or separately hosted site.
