## Why

[Hub #1377](https://github.com/jimmie-potts/agent-device-hub/issues/1377) addresses
routine Codex Desktop updates disabling the installed receipt observer. The
owner wants compatible updates to keep working without a new build allowlist
or credential enrollment.

## What Changes

- Admit the selected Codex application by its bundle identity and observe its
  existing native stdio protocol across version and build changes.
- Keep every receipt dependent on the complete native read request and successful
  changed-revision response, plus the existing current-owner target checks.
- Retain the enrolled source identifier and metadata contract. Report observed
  versions in the launch check without presenting them as compatibility proof.
- Document the supported protocol, loss conditions and evidence limits. Preserve
  the Claude producer and native forwarding when collection is unavailable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-agent-hooks`: replace exact Codex release admission with the selected
  application's bounded native protocol correlation.
- `bunny-runtime`: identify the qualified Codex producer by its protocol and
  enrollment, retaining exact transaction and replay guards.

## Impact

The host launcher, observer, focused tests and read-receipt guide change.
Lifecycle/2.1, session/2.1, source grants, SDK intake and stored records stay
compatible with the accepted core. There is no new dependency, device command,
content collection or cross-repository contract change. Installation can replace
only the host helper after exact source review and CI if the existing core passes
the compatibility exercise. Normal-launch integration remains a separate consumer
of this policy; this change does not install global environment settings.
