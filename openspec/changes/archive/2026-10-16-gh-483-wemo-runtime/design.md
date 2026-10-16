## Context

See proposal.md. Both selected units have private local-protocol and basic physical evidence. The owner excludes the vendor app/cloud, reports no saved rules and accepts Hub-dependent limits. The owner also selects off when an enabled limit finds fresh on evidence without a trustworthy start. These decisions select no live schedule or limit.

This design is required by cross-component ownership, persistent run state and a new XML dependency. ADR 0012 and the existing device/outbox, automation dispatcher and authenticated management paths remain authoritative.

## Goals / Non-Goals

**Goals:** one bounded writer per configured plug, reusable shared timing, truthful evidence and conservative recovery.

**Non-Goals:** discovery, callbacks, vendor accounts, rule database management, offline guarantees, other models, another service and broader routine/editor work.

## Decisions

- Port the narrow local SOAP read/power path into TypeScript using bounded Node HTTP and a pinned XML parser. Validate exact configured origin, observed device MAC, Belkin socket identity and advertised control path before writes. Reject redirects, DTDs/entities, malformed/ambiguous XML, foreign origins and oversized/late replies. No retry. HA adds an unselected service; the current wemo-client constructor starts a callback listener/SSDP client and its request helper has no explicit deadline/size bound. Private PyWeMo remains qualification tooling only.
- Use SDK module registration, one queue and writer lease per plug, durable acceptance/started fences and the existing outcome outbox. Independent readers/queues prevent one offline plug blocking another. Poll every five seconds; evidence older than fifteen seconds is stale. A response to SetBinaryState is transmission evidence; a fresh GetBinaryState supplies observed power.
- An uncertain effect durably holds that device across restart. Only a new explicit wemo-hold-release command, guarded against the same hold/configuration/generation, can clear it after fresh identity/power reading. Polling, schedules and maximum-on cannot clear it. Release sends no power command and does not retry the uncertain action.
- Put maximum-on state in the core beside shared automation, with separate per-target definitions and run records. The module owns only device facts and writes. The core observes the SDK owner copy and uses the existing tracked power dispatcher, including capability/generation/hold checks. Definitions/run state and `power-limit/2.0` status commit in the core store/outbox. The dashboard follows that family through SDK sync, without polling Hub state. The device card owns no timer. This avoids an untracked internal write path or Wemo-specific scheduler.
- Track a known run start from an observed off-to-on transition; preserve it and the attempt fence durably. Repeated on readings or commands do not extend it. Fresh off ends the run. Missing/stale/offline evidence is never off. Across restart retain an earlier known start, otherwise mark elapsed time unknown. Never manufacture a full new duration. An enabled unknown/overdue run gets one guarded off attempt after fresh on evidence; unavailable/held targets show blocked, and an uncertain/admitted attempt is never resent automatically. Explicit manual off remains available after hold release.
- Settings default disabled. A duration edit uses the original run start, so a shorter elapsed duration becomes due on evaluation; disabling removes enforcement without a power command. Enabling on an unknown existing run can turn it off. Disabling or editing fences obsolete evaluation before dispatch. The shared weekly scheduler never re-enables an active window after the limit turns a plug off.
- Reuse the generic device card for power, observation age, limit controls and explicit hold release, with authenticated bounded API management matching schedule CRUD. Show saved enabled state separately from armed/unknown/due/attempted, next deadline, outcome and observed off. Label Hub/reachability dependence. UI reads cause no immediate device effects.

## Risks / Trade-offs

- Hub/network outage can prevent timely off → label the dependency; no offline promise or native-rule fallback.
- An on/off cycle entirely between polls is unobserved → retain earlier known start conservatively, never extend it from repeated on. State the five-second observation delay.
- Process interruption after dispatch intent → retain its opaque attempt identity and do not resend; use tracked outcomes and manual recovery.
- New persistent owner state changes recovery compatibility → require actual release/latest-state/recovery admission before installed activation. Source fixtures are not installed proof.
- Device identity/address drift → refuse writes; operator requalification is explicit. Keep actual configuration, labels and private receipts outside Git/GitHub.

## Migration Plan

Deliver source, independent Standards/Specification/Acceptance review and successful applicable CI through a PR. Sync/archive both specs before final review. Keep the module unconfigured and limits disabled in the established installation until the qualified upgrade procedure admits actual artifacts/state and activation is authorized. Obtain separate named physical schedule/limit trials; existing helper trials do not qualify the product transport. Never use the legacy installer or an event-only recovery reader for new routine/limit rows.
