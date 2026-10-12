## Context

See proposal.md for the installed failure and owning issue. Design is needed because the Android process prerequisite changes a release-pinned native artifact and its provenance. The successful qualification source explicitly initializes MediaFrameworkPlatformInitializer before requesting media_session. Android's MediaSessionManager constructor dereferences that manager; the synthetic Context previously bypassed this prerequisite.

## Goals / Non-Goals

Provide the existing read-only projection from the same standalone app_process entrypoint. Keep its four-second watchdog, five-second host bound, fixed arguments, pipe-only result channel, privacy rules and unavailable wire unchanged. No permission, setting, persistent Android service, alternate protocol or deferred feature is added.

## Decisions

Initialize MediaServiceManager through the same fixed reflection calls used in qualification, only when getMediaServiceManager returns null. Do this after obtaining the system context and before requesting media_session. Replacing an existing manager would violate Android's single-registration contract; relying on application bootstrap would leave the standalone path broken.

Exercise the actual Java reader with synthetic Android surfaces that require initialization for media_session. Normal fixtures begin initialized and refuse replacement. A standalone fixture begins empty; a failing initializer must return the existing sanitized failure with unsuccessful exit. Keep the raw-ADB socket regression, including pipefail. These tests establish JDK behavior only.

Reproduce Dex with qualified JDK21/R8 8.3.37 and the existing deterministic commands. Advance the reader source version and update source/Dex pins together. Stored reader provenance accepts bounded version strings and digests, so earlier observations need no rewrite or migration.

## Risks / Trade-offs

Hidden Android APIs can differ from synthetic fixtures; source and reproduction checks cannot establish physical success. A separately approved fixed-reader deployment/read must verify the exact artifact on the selected ONN. Unsupported initialization still becomes a visible gap and never an input command.

## Migration Plan

Deliver reviewed source and its immutable artifact through normal guarded merge/main CI. Prepare exact current-runtime compatibility before any installed upgrade. Device deployment, ONN activation and acceptance follow a fresh approved sequence, with the existing bounded matching-configuration restoration on actual failure. Historical native3 originals and deployed files remain private and revision-bound; no backup restoration or history rewrite is selected.
