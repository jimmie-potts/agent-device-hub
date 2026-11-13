## Context

The runtime listener checks Host and proxy proof before the gateway. The
gateway has separate entry points for SDK, MCP, browser and dashboard routes.
The core's own standby guards prevent effects from internal callers. This
change adds a refusal at each external entry before any owner call.

## Goals and boundaries

Keep the ordinary runtime and SDK call order. Refuse standby requests with
shared registry errors under ADR 0012. The runtime ships with the standby
gateway off. In-process tests provide the bounded status reader. The shipped profile
hosts the core only. A trusted in-process composition retains its chosen
modules and applies the same external gateway policy.

## Decisions

- Capture standby mode and pin the original start function from the exact
  core factory registration. Carry the function through the async host
  handoff. The edge switch and a module's name convey no mode authority.
- Use the private credential parser and require exactly one read scope and
  no role. Validate before state setup and bound ownership reservation. A
  bound token remains process-owned. Store consumption is a later action.
  Validate replacements in full before grants or connections change.
- Apply normal Host, origin, bearer and SDK source rules. Validate bounded
  request structure without an owner, bus, endpoint lookup or ordinary
  control grant. Re-admit the original bearer from in-memory grants after
  awaited reads, while the gateway is still open. On SDK POSTs, keep body
  decoding errors first and re-admit before checking operation fields.
- Keep one internal status GET with a fixed query contract. Check the
  decoded result and the exact serialized JSON for secrets and bound the
  delivered UTF-8 bytes. The handler receives only validated inputs.
- Use the existing HTTP and SDK refusal records, bounded labels and trace
  rules. A valid request refused here is unavailable before effects. It
  creates no accepted, queued or uncertain outcome and is never retried.

## Risks and checks

| Boundary | Regression probe |
| --- | --- |
| Startup | Replace the registered start across async admission. Invalid configured grants must refuse before state or ownership work. |
| HTTP | Valid writes from a reader reach the fixed refusal. Malformed input and request headers retain their existing errors. |
| SDK | A stream, command and endpoint registration cannot allocate or enter the bus. Stale tokens fail admission before operation fields are inspected. |
| Status and reload | Rotate the same grant ID or close the gateway during a pending read. Refused replacement retains prior grants. The sent JSON remains bounded and redacted. |
| Compatibility | Use the same fixtures with enabled and disabled ordinary cores. Assert existing route and grant behavior. |

## Migration

The source change needs no storage migration. Shipped standby keeps local
health and the edge off. Existing active configuration continues to apply.
