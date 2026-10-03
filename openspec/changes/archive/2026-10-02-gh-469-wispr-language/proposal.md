## Why

Numeric usage cannot show which words recur or distinguish recognition cleanup from observed later editing. Issue [#469](https://github.com/jimmie-potts/agent-device-hub/issues/469) adds descriptive, explicitly opted-in language aggregates to the accepted private collector, while keeping uncertainty and sensitive-data limits visible.

## What Changes

- Add separate raw, formatted and observed-text contributions, with versioned English tokenization, useful-word filtering, repeated phrases and bounded mechanical change counts.
- Publish exact today/7d/30d/all rankings from private contributions, enforcing three-distinct-dictation support within each app/category/corpus subgroup before the 100-entry cap.
- Keep text analysis off by default. Exclude sensitive patterns and owner-selected apps/terms; retain numeric behavior for unsupported, unknown and oversized language input.
- Extend the retained store and publication lifecycle so retries, late edits, pruning, algorithm changes, opt-out and restore preserve the existing retention and clear contracts without copied transcript fields.
- Observe supported dictionary/snippet counters as separate snapshots with unknown windows and explicit unavailable states. Never edit the source or infer that text was sent, corrected an error or improved communication.
- Extend synthetic, native Windows and offline-package checks and owning documentation.

## Capabilities

### New Capabilities

- `wispr-language`: Opt-in language contributions, bounded comparisons, exact suppressed rankings and private lifecycle behavior.

### Modified Capabilities

None. The existing `wispr-collector` requirements already define independent language availability, retained contributions and text-clear/recovery behavior. This change supplies the optional implementation within that contract.

## Impact

Owning code is `apps/wispr-collector`, with the existing `packages/wispr-contracts` language table boundary and collector CI/package checks. Hub consumers use `english-1` and `english-stop-1`; changes to that compatibility profile must update its consumers together. No new cross-repository API, ingestion service, dependency, installation, scheduling, live personal-data read or device operation is proposed. Installed source-field meanings remain separately qualified; unknown language, edit finality and counter windows must stay explicit.
