# LIFX controller

Status: Documentation only. No package, LAN transport, effects or service is
implemented or installed here.

This controller will map automatic agent status to supported LIFX lighting
through direct LAN control. It will consume the feed of the selected shared
agent-state owner. Home Assistant and cloud HTTP are alternatives already considered;
neither is a dependency of this controller. See the
[architecture](../../docs/architecture.md) and
[ADR 0003](../../docs/decisions/0003-device-controller-monorepo.md).

## Capability and ownership boundary

Do not assume the user's "A16" bulbs are A19 models, or advertise
color, temperature or effects without product/capability evidence. Qualification
will choose the LAN library or protocol implementation and record its support.

Each configured bulb has one designated writer and queue. Expose supported
capabilities through the common controller contract; callers cannot choose raw
network addresses or packets. Keep service health, desired state, acknowledgment,
reported state and observation freshness separate. Missing packets do not prove
success, and acknowledgment does not prove visible lighting.

The status issue will settle bulb/group mapping, effects, brightness limits,
quiet/disabled behavior, multi-session policy and manual-control/restoration
rules. Consume shared agent state once interpreted by the core. Do not copy a
provider reducer or infer readership from turn completion.

## Issues

GitHub issues own the delivery sequence, prerequisites and acceptance; see the
[open LIFX issues](https://github.com/jimmie-potts/agent-device-hub/issues?q=is%3Aissue+is%3Aopen+LIFX+in%3Atitle).
Shared #4 owns common controller contracts; #11 owns broader deferred Home
Assistant/MQTT research.

## Development and evidence

Follow [scoped instructions](AGENTS.md) and the root
[development guide](../../docs/development.md). Node 24/TypeScript/npm workspaces
are the future implementation direction. The implementing issue adds actual
build/type/test commands and CI; there are no controller commands yet.

Use fake packets, feeds and neutral identities for source work. Real bulb
traffic needs the user's explicit go-ahead and happens only where an issue
allows it: read-only queries to user-supplied IPs in #17, then installation in
#22. Never scan the LAN or change router or firewall settings. Keep bulb IPs
and runtime data outside Git.
