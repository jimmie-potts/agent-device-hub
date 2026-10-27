## Context

See proposal.md for the approved outcome and issue link. Home and component routes currently mount DeviceCard, whose Wemo branch uses useAttempt and PowerLimitPanel. Core device and power-limit copies already arrive over the shell's participant. This design is included under the schema's cross-component criterion because presentation, the retained command adapter and the independent limit-save panel must compose without changing their mutation behavior.

## Goals / Non-Goals

**Goals:** extract reusable presentation, preserve existing command/limit recovery, keep everyday controls concise, and retain detailed evidence on demand.

**Non-Goals:** new routing destinations, room assignment storage, device transports, scheduling, energy monitoring, dependency changes or physical tests.

## Decisions

- WemoCard owns presentation and local tab state; WemoDeviceCard adapts existing records, useAttempt, guarded deviceAction and PowerLimitPanel. Replacing those owners with local optimistic power or a second save path would change accepted semantics, so retain them.
- Power selection derives only from known observations. Freshness/authority/capability/availability and pending/held state gate writes. The existing useAttempt store retains one identity across Home/device placements, tabs, navigation and reload.
- Both tab panels stay mounted in one CSS grid cell. The inactive panel retains layout contribution but uses hidden plus visibility:hidden and pointer suppression, so the tallest current control face sets both tabs' dimensions without clipping text or inventing a fixed phone height.
- PowerLimitPanel receives an optional concise presentation. Its request, validation, revision guard and uncertain-save lock remain unchanged. Routine headings/status notes are suppressed in the concise view; consequential attempt/save outcomes remain available. The default generic presentation is retained for its other consumers.
- A collapsed evidence disclosure retains desired/observed state, observation age, command/transmission identity, maximum-on start/deadline/status and outage behavior. This satisfies existing bunny-wemo and bunny-power-limits evidence requirements while honoring removal of routine inline warnings and labels. There is no Details or Activity tab.
- Use shared glass/skin tokens and code-native CSS illustrations. The generic lamp describes the load, never measured physical output. It remains mounted while tabs change; all state still comes from the designated module and core.

## Risks / Trade-offs

- Hidden panels could remain keyboard-accessible → browser checks assert inactive fields are not visible/focusable and tab geometry is unchanged, with axe at desktop and phone widths.
- Desired state could look observed → a focused fixture asserts selection follows the report, with unknown/stale/held cases distinct and no optimistic flip on acceptance.
- Concise presentation could obscure uncertain work → keep pending/refused/failed/uncertain and limit-attempt evidence; preserve lost-reply, explicit recovery and independent-target browser checks.
- Duplicate placement could create a new writer or save → reuse existing adapters and records; navigation/tab checks count mutations.

## Migration Plan

No storage, protocol or configuration migration is introduced. Deliver through a reviewed PR and exact main CI, then the qualified routine apps/runtime upgrade and passive served-browser readback. Preserve private settings and devices. Recovery eligibility remains governed by the runtime procedure; this change does not certify an older reader or authorize device commands.
