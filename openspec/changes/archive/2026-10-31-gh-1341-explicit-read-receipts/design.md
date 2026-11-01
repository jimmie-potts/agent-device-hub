## Context

See proposal.md for the owning issue and motivation. Lifecycle/2.0 and session/2.0 currently restrict positive read evidence to Codex Desktop. Runtime mapping still feeds the retained lifecycle 1.2 reducer. Changing one schema in place would either weaken the existing rule or admit data the owner cannot preserve. The native Codex receipt API works in disposable homes, but real Desktop viewing and a Claude equivalent remain unqualified.

Design is required by the schema because version compatibility, source qualification and stale evidence need explicit decisions before implementation.

## Goals / Non-Goals

**Goals:** Define the next receipt input and an executable eligibility reference without activating an unfinished producer or consumer. Freeze the session/turn/notice target at the observed action. Keep provider-specific observation outside the shared decision.

**Non-Goals:** Runtime adoption, provider hooking, database access, native read writes, title/archive evidence, credential changes, a new UI or proof that a person comprehended a reply. The existing session/2.0 projection and lifecycle 1.x reducer keep their current restrictions; their later adoption is separate work.

## Decisions

- Keep the existing lifecycle family, type, routing convention and profile. An opt-in entry point registers lifecycle/2.1 after the core families. Its schema accepts lifecycle/2.0 through a reference and adds a distinct `read-receipt-observed` variant. The distinct kind prevents it from being mistaken for the old marker-based `read-observed`. In-place widening and a new transport format were rejected.
- Require the existing full identity and known turn. The event also names `generation` and `noticeId`, obtained from the owning session feed at observation. These identify the finished result the action concerned. Looking up a newer target when a delayed receipt arrives is forbidden. The later adapter can use existing SDK sync/subscription; no Hub polling is introduced.
- Represent provenance as a closed union. `provider-client` carries `client: desktop`, `seenRevision` and `acceptedRevision`; it means an observed successful client read request/response after a completed turn. `owned-ui` carries `viewRevision`; it means the application owns the view action and has qualified its policy. Provider revisions are bounded opaque tokens that also allow colons, preserving native `initial:<thread-id>` values. Owned-UI revisions retain the shared identifier rule. Neither is a timestamp or a comparable sequence number. A generic rendering callback cannot claim either variant.
- Match caller-supplied qualification to message source, provider/client/host/source feed and provenance kind. A producer cannot self-authorize through its payload. The future authenticated receiver must establish the source and current version qualification before calling the reference. This source delivery changes no credential or admission scope.
- Check the current session's identity, generation, known turn, named turn-ended notice and finished activity. Reject known children. Check this again atomically at future owner adoption, because a reference result taken before a new turn is not a durable authorization. Lifecycle freshness is independent: returning to read an old completed result must not fabricate fresh agent activity or connectivity.
- Leave the default registry untouched. The reference uses its own explicitly constructed validator; runtime and SDK users remain on their existing registration. There is no stored state or migration in this change. Source registration success does not qualify the current runtime reducer or projection.
- Keep the adapter's observation narrow under ADR 0011. Full native API responses can contain preview text, so a later adapter must select only declared receipt/identity/target fields before persistence, transmission or diagnostics. The experiments use synthetic model input. No owner content is selected for capture.

## Risks / Trade-offs

- A valid shape cannot prove a real client action. The explicit qualification input and separate installed acceptance keep schema validity distinct from truth.
- A future adapter needs the correct owner generation and notice at action time. Events before that binding is known remain unknown; they cannot be rebound after a newer completion.
- The source API is deliberately inactive in default consumers. A later adoption must handle lifecycle/2.1, the shared owner and an appropriate versioned session projection together.
- Codex's API is experimental and its Desktop launch controls are implementation details. Version qualification and fallback to unknown remain required. Claude's documented MessageDisplay hook also fires without an interactive viewer, so it cannot substitute for a read action.
- The present computer-use tool refuses ChatGPT. Continue disposable protocol checks, record the UI gap and require a permitted UI route for actual-client qualification. Do not bypass that restriction with another automation mechanism.

## Migration plan

No live migration or installation. Export the opt-in contract, validate compatibility and reference behavior, update the owning specification and guides, and deliver through a reviewed PR. Consumers continue using their present schemas. Removing the unused extension before adoption has no stored-data or runtime effect.
