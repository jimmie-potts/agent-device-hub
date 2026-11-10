## Why

[Issue #1584](https://github.com/jimmie-potts/agent-device-hub/issues/1584): Show now (#1581) can show only artwork in the art owner's published `art` record, which holds the 24 most recent artworks. That record is the core's only source of composition IDs. Older retained artwork on later gallery pages has Show now disabled, and a direct `art-show` command for it is refused `not-found`. The owner wants to show any retained artwork.

## What Changes

- When the artwork is not in the published record, the core reads that artwork's summary from the art owner's private `catalog` content, newest first, and applies the same composition rules. The runtime host binds this reader, which calls the art module's content contribution through the module host, as the gateway does for an authenticated reader. It runs once per show command within 5 seconds and stops at the artwork or the last page. Each cursor must move toward older art, so a scan always ends.
- Art the owner no longer retains stays `not-found`. A catalog that cannot be read, or one that returns a malformed page, is refused `unavailable`. Nothing is sent in either case.
- The gallery enables Show now for every artwork it lists and drops the "only the most recent saved art" explanation.
- `art-show/2.0`, its admission, the plan path, the owner permit, the automation log evidence, the typed refusals and `core_art_show` stay as they are. The tool description now says any retained artwork can be shown.

ADR 0012: no new message format, error shape or family, and no new path that polls for state. The catalog read is the owner's content fetched by reference, once per command, with the shared error body.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: an owner show resolves retained art past the published record through the art owner's catalog, with `not-found` and `unavailable` refusals.
- `bunny-art`: the gallery's Show now no longer depends on the art record.

## Impact

- `apps/runtime`: `core/art-catalog.ts` (the host-bound reader), the fallback in `core/art-show.ts`, core and automation-part binding, `runtime.ts` binding, the `core_art_show` description, the runtime guide and tests.
- `modules/art`: the gallery frontend and its guide. The module's commands, content and state are unchanged, because its `art-auto/2.1` prepare and present already check the artwork against its whole private store.
- No contract, schema, storage, migration, device or credential change. Installation and physical acceptance stay pending for the owner's next batch.
