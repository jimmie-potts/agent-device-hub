## Why

The owner needs explicit household knowledge and attributed conversations that remain usable when a model or client changes. [#636](https://github.com/jimmie-potts/agent-device-hub/issues/636) selects a source-only extension of the existing companions owner.

## What Changes

- Add titled active/inactive knowledge using the preference lifecycle, curated persona inspection and explicit current context preview/copy.
- Extend the existing message store with attributed meaning, immutable creation order, correction revisions and deletion receipts. Preserve existing assistant identities and unknown legacy evidence.
- Add private versioned additive export/import and bounded authenticated reads; prove source portability with two fake adapters and a replacement test client.
- Add dashboard management and focused SQLite/runtime/browser checks. Keep the existing synthetic graph and Reachy behavior.

## Capabilities

### New Capabilities

- `bunny-companion-knowledge`: explicit knowledge, profiles, current context, attributed conversation and additive recovery.

### Modified Capabilities

None. Existing preference documents and synthetic-task control contracts remain compatible; the new authoritative history supplements their private views.

## Impact

Companions source, tests, browser contribution, maintained runtime scenarios and owning guides. One SDK database and outbox; existing authenticated content and opaque staged commands. No new dependency, service, provider, installation, microphone, sensor or device effect. No automatic learning, context injection, profile editor or persistent context cache. ADR 0011/0012 and the diagnostic contract continue to apply. Real providers and installed acceptance remain separate.
