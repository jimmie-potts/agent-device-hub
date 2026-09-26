# ADR 0018: Monitor and Media share the existing writer

Status: Accepted for issue #33 source implementation.

## Decision

Keep agent-state ownership behind #31's selected source. Add private presentation
configuration to the existing backend, with explicit Monitor and Media modes,
project/session/provider/search filters and a 1000–10000 ms upload interval.
Use the existing neutral project ID; do not invent a second tag or label owner.
The default interval and complete RGB method follow ADR 0015's bounded evidence.

Serialize logical transitions separately from transport completion. Entering
Monitor retires the player's prior generation, pauses its context, persists the
selection, then permits generation-guarded pictures through Player's adapter.
Starting media retires Monitor before the media command. Leaving Monitor alone
keeps playback paused. Filter changes in Media preserve playback. Screen-off
can cancel even while persistence is pending. Screen-on cannot resume work.

One upload can be in flight. Coalesce the latest completed rendition and never
replay intermediate pictures. Preserve an uncertain late physical receipt under
its old generation; do not roll back unknown artwork or retry automatically.
Restart restores selection but not activation. Persistence failure prevents
activation. The renderer and collection remain available without device writes.

## Commands and consumers

Reuse the existing request ledger and revision guards. A finite authenticated
`pixoo-integration/1.0` native extension carries controller/device identity and
mirrors browser mode/view commands. It does not widen shared device API v1.
Shared labels/notices use the selected owner's own command identity. Existing
MCP media operations keep their schemas and enter the same ControlService.

Browser SSE is an invalidation feed followed by current reads. Clients discard
stale IDs, bound consecutive reconnect attempts, and retain interrupted requests
for explicit retry/reconciliation. Configuration, participation, pending mode,
source evidence and physical outcome stay separate in snapshots and UI.

## Alternatives and acceptance

A dashboard-owned adapter would create a second physical writer and is rejected.
Automatic attention takeover would violate Media intent. Autoactivation after
restart or screen-on would turn observation into unsolicited display writes.
A shared API v1 schema change would break the released contract, so the extension
is versioned under Pixoo ownership.

The monitor-control, presentation, migration and browser fixtures verify source
behavior. They do not prove actual client hooks or integrated physical fidelity.
Those checks remain #34. See [monitor operations](../agent-monitoring.md) and the
[capability specification](../../openspec/specs/agent-monitor-controls/spec.md).
