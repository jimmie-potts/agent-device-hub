## Why

The owner retired the Work Guide direction and authorized source removal under
[Hub #892](https://github.com/jimmie-potts/agent-device-hub/issues/892), part of
[epic #888](https://github.com/jimmie-potts/agent-device-hub/issues/888).
Shared diagrams, maintenance parsing and verification must survive that removal.

## What Changes

- **BREAKING:** Remove the Guide application, generated releases, exclusive tests,
  contracts, saved backlogs and CI; retain its history in Git and archived changes.
- Remove Guide from shared Places navigation; keep the remaining destinations,
  current-place identity, preview isolation and credential boundaries.
- Retain independent diagrams and atlas; extract recommendation parsing and
  preserve historical fingerprint exclusions.
- Remove Guide metadata duties and preflight exceptions. Run retained documentation
  checks in the existing Workflow workflow, including Markdown-only changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `epic-guide`: retire this capability from the Hub source tree.
- `shared-places-navigation`: remove the retired Guide destination.

## Impact

Hub documentation generators, shared Places data consumed by both dashboards,
maintenance closeout, delivery preflight, CI and authoring instructions change.
The separate public repository/site is unchanged. Source-only delivery authorizes
no installed-runtime change or device action. No cross-repository wire contract changes.
