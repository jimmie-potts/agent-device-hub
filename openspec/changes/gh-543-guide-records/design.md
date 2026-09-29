## Context

See proposal.md for scope. The guide already separates GitHub snapshots,
native dependencies, strict Guide metadata and dated editorial paths. Its
current status helper can call work with no blockers a candidate without a
ready label; this contract requires stronger evidence for a ready-work claim.
Existing browser and renderer behavior is outside this draft.

## Goals / Non-Goals

Define a compact, language-neutral JSON boundary with explicit unknowns and
operation gates. Do not normalize the live backlog, change existing status
helpers, introduce a service or call an inference provider.

## Decisions

- Use JSON Schema with the existing Ajv dependency and a small reference
  semantic validator. This avoids a new package and permits later Python and
  TypeScript adapters to consume the same definition.
- Keep source records local to the application. A separately constructed public
  projection uses selected public text and stable references, never wholesale
  bodies or execution prompts. Schema validation cannot certify text as public;
  the producer must explicitly attest the allowlisted source selection.
- Preserve unavailable collections as unknown, not empty. Dependency evidence
  has its own observation time, pagination and scope. A current issue fetch
  cannot renew an older graph observation.
- Pin records to one dataset identity. Authored content has independent revision
  and date; code-derived claims require complete source evidence for their scope.
- Exact schema versions are negotiated explicitly. Unknown versions and extra
  properties are rejected. A changed field meaning requires a new version and
  renewed approval rather than silently widening an existing contract.

## Risks / Trade-offs

- Partial evidence limits recommendations → keep browsing available and provide
  source-linked withholding reasons.
- A permissive graph can imply readiness → require complete fresh dependency
  closure and explicit ready status; cycles withhold recommendations.
- Public text may contain private material → publication eligibility is a
  producer responsibility; never pass raw issue bodies or session data to Jev.
- Later interface definitions are not approved → traces use fixture-only opaque
  catalog references and make no compatibility or runtime acceptance claim.

## Migration Plan

Deliver the approved definition and fixtures first. Subsequent adapter work
audits the inventory and wires validation into the guide. No live migration,
installation, provider request or guide publication occurs here.
