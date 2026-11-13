## Context

The production and private-proxy profiles already verify configuration before
acquiring a process-held state lease. The active core acquires a logical
lease from that same store. It opens a session owner, registers message
intake and resumes publication and tracker work.

## Goals / Non-Goals

Open authoritative core settings and serve local health with a fixed standby
selection. Peer admission, replication and the operating handoff belong to
later work.

## Decisions

- Share option admission between the entrypoint and operator inspection.
  Require explicit standby on production or private-proxy. Check supported
  options and configuration before state preparation. Allow an omitted edge
  block. Validate a supplied block and its grants under the existing
  private-proxy rules, including MCP off. Pass edge off into process startup.
- Construct only the shipped core with its registration-derived history
  rules. Bind the real runtime lease to that exact instance. Open settings
  owners under the normal store lease and validate the session export and
  ordered consumer list without creating a session owner. Validate the
  projected settings snapshot before marking it available.
- Keep settings initialization outside core transactions. General sync,
  freshness refresh, tracker intake, session maintenance, automation
  schedules and recovered publication are inactive. Refuse direct work
  before admitting it with the existing unavailable result. Keep the
  startup diagnostic and existing profile refusals.

## Risks / Trade-offs

Lease refusal or pending restore prevents store and listener startup. A
non-capacity open, load or projection failure takes the existing fatal
startup path. Capacity retains existing health semantics and settings stay
unavailable. Abort and stop fence readiness and release any logical lease.
Process ownership remains held until exit.

Existing history schema migration may add continuity metadata. The legacy
power-window migration may split a definition and copy its exact historical
watermark to the new definition in the same transaction. Neither operation
publishes facts or claims new work. Current-schema session, operational
and pending outbox rows survive standby startup, reads and stop. A later
active start uses normal recovery without resending old commands.
