## 1. Persistent definitions and compatibility

- [x] 1.1 Define bounded shared weekly-power inputs and core-owned saved representation; prove with focused tests that validation rejects unknown fields, unconfigured/unsupported targets and invalid windows, while independent disabled definitions persist and existing event rows/settings remain unchanged.
- [x] 1.2 Record the new routine discriminator/duplicate-guard representation and its runtime format/admission implications in the owning guide and applicable compatibility checks; prove reopening and latest-state recovery preserve schedule definitions and never assume an old event-only release can read them.

## 2. Clock and command ownership

- [x] 2.1 Add host-local future-boundary calculation and the bounded timer using existing clock/scheduler injection; demonstrate the first missing behavior in a red test, then verify weekdays, on/off selection, duplicate suppression, edits/disable/delete, callback invalidation, late-window expiry and restart without catch-up.
- [x] 2.2 Supply all configured/admitted device identities separately from Hub-mode participation and follow current owner records through SDK sync; test a generic non-Wemo fake target, unsupported power, unavailable/held/external state and changed configuration during a pending read.
- [x] 2.3 Dispatch each admitted boundary once through the core tracker with fresh guards/identity and existing diagnostics/trace handling; test failed/uncertain acceptance, no automatic resend, no continuous re-on after an early off, and continued independence of another scheduled target.

## 3. Authenticated shared management

- [x] 3.1 Extend the current authenticated automation namespace with bounded power-schedule reads/mutations, preserving the event-rule endpoints; verify read/control scopes, origin/header guards, revoked authority during body reads, unknown IDs and privacy-safe typed errors before storage or dispatch.
- [x] 3.2 Add the small shared Automation editor/list with configured power-capable targets, weekdays/local times, enable switches, next occurrence and tracked outcome distinction; run unit and automated browser/accessibility tests proving no writes on page open/reconnect, independent schedules, invalid drafts and no resubmission after a lost reply.

## 4. Source delivery and qualification boundary

- [x] 4.1 Update runtime/dashboard/development guides, the issue's source-slice evidence and verification coverage; run the applicable Node 24 build/type/lint, contract/workflow, runtime/core/scenario and browser checks, with a meaningful negative control for the changed scheduling path. Record actual results and revision.
Delivery gates stay with #483 and its coordinating delivery record: synchronize and
archive the completed source change before final review; obtain independent Standards,
Specification and Acceptance review plus applicable current-head CI; use the guarded
merge and verify merged-main CI; qualify installation against actual releases and
state before activation. Keep #483 open for Wemo transport, maximum-on qualification
and physical acceptance. Reconcile tracker writes by readback and settle only this
work's recorded temporary resources. These gates are not implementation checkboxes
and are not completed by archival.

Source verification: clean checkpoint `6881866571f523f634a110d0a2139d60f24685a7`
passed root build/lint, focused backend 43/43, browser journey and disposable
`weekly-power-schedules` and `automation-lines-moment` captures in
`runtime-20261015T212926Z-093509`; the run stopped cleanly. Root typecheck,
contracts (JS/Python), dashboard units and workflow checks passed. Broader runtime
711/711 and catalog105/105 preceded the final independent-timer correction; the
current focused tests cover that correction and its unchanged regression's red
control. These are source/synthetic results, with installation and physical
acceptance still pending under #483. Review and CI gates above remain required.
