## Context

See proposal.md for motivation. Contract 1.0 rejects unknown fields everywhere, so even an additive moment needs a new API minor with negotiation. Four in-repo consumers pin the contract package exactly and call `validate('request' | 'snapshot' | 'receipt' | …)` and `admit()`: the hub, the MCP, Tidbyt and LIFX. The Device MCP 1.0.0 archive bundles the released 1.0.0 contract from vendor/ with a pinned checksum. No controller serves moments yet.

## Goals / Non-Goals

**Goals:**

- Define API 1.1 so that every 1.0 caller observes identical results, including TypeScript types.
- Make the device-side decisions testable as pure functions in both languages: precedence, timing, duplicates, supersession and the return to the current base.

**Non-Goals:**

- Controller adoption, HTTP routes, MCP tools and the hub's sending, rules, budgets or quiet hours.
- Device mood presets, rendering and transport outcomes.
- Moving the Device MCP artifact to 1.1.0.

## Decisions

- **Suffixed definitions in the existing schema file.**
  - 1.1 adds `requestV1_1`, `receiptV1_1`, `snapshotV1_1`, `feedV1_1`, `capabilitiesV1_1` and friends next to the untouched 1.0 definitions.
  - Shared leaves are reused by `$ref`, including the 1.0 capability entries through JSON pointers.
  - Alternatives:
    - Widening the 1.0 definitions would change what 1.0 consumers accept.
    - A second schema file would duplicate every shared leaf.
    - Extending closed objects with `unevaluatedProperties` would rewrite the 1.0 definitions.
- **Read negotiation with a 1.0 default.**
  - `negotiateApiVersion` serves a read without a version at 1.0. A named version gets the highest served version of the same major that is not above it, and another major or a malformed value is `invalid-request`.
  - Over HTTP the signal is the `apiVersion` query parameter, matching agent-state's opt-in `snapshotVersion=1.1` style.
  - The default keeps the installed hub's 1.0 snapshot validation working when a device adopts 1.1.
  - Controllers built before 1.1.0 may reject the parameter; the Nanoleaf controller on `main` (`88831e4`) accepts only its declared read parameters. A client therefore treats `invalid-request` on a versioned read as a 1.0-only controller and reads again without the signal.
- **Overloaded `admit`.**
  - `admit(Admission)` keeps returning the 1.0 `AdmissionResult` type.
  - A state with `apiVersions` (`AdmissionStateV1_1`) selects the 1.1 overload.
  - The first attempt widened the shared result type, and Tidbyt's typecheck failed. That failure is why the types are split.
  - A 1.1 envelope validates only when the state serves 1.1, so every earlier admission case keeps its decision.
- **Moments do not advance the configuration revision.**
  - The revision serializes desired changes, and a moment is transient.
  - If a moment bumped it, a dashboard edit in flight would fail with revision-conflict whenever a moment arrived.
  - The envelope still checks the expected revision and generation, so stale hub decisions lose through the existing guards.
- **Start in the receiving controller's clock.**
  - The hub already reads a snapshot before commanding, so it can translate its own elapsed time into the device's `sampleClock` epoch.
  - The device can then refuse stale moments itself.
  - Alternatives:
    - A delay relative to admission cannot detect a late delivery.
    - UTC would compare clocks across processes, which the contract avoids.
- **Moment checks happen when the writer takes the moment, not at ticket admission.**
  - Duplicate, missed and blocked depend on presentation and alert state, which only the device writer knows.
  - The order is duplicate, then missed, then blocked. Missed and blocked moments are remembered, so a retry of a dropped moment is a duplicate, not a late replay.
- **Supersession at delivery, even for a future start.**
  - A newer accepted moment ends the current one immediately, and the device shows its base until the new start. This keeps one current moment and one clear ending.
  - The alternative was to keep the old moment playing until the new start, which needs a queue of two.
- **A moment starts at its tick and plays the full duration from the actual start.**
  - Lateness is judged when the moment is delivered and again before every later event while it is scheduled. A writer that reaches the start more than `toleranceMs` late drops the moment as `moment-missed`, so a stall cannot make it play out of step with other devices or block a newer moment. The scheduled state carries `toleranceMs` for this. The dropped moment records no ending, because it never played; its receipt carries `moment-missed`.
  - Any later ineligibility ends a scheduled moment immediately: an alert on status is `preempted`, and a mode change or explicit command is `interrupted`. The start therefore needs no second eligibility check.
- **`coversStatus` is a permission the writer applies.**
  - A device whose capability cannot cover status blocks status-covering moments only while it shows status. It still plays them over content.
  - The hub can therefore send one interrupt-set moment to every device. Rejecting the flag at admission would have required per-device hub logic.
- **`downgradeSnapshot` omits moment content instead of translating it.**
  - A 1.0 reader cannot act on moments.
  - A 1.1 `lastOutcome` could carry a 1.1-only failure code, so it becomes `unknown`, which is the contract's rule for missing evidence.
- **MCP packaging pins the bundled version.**
  - The workspace must pin 1.1.0 so that npm links the local package.
  - `package-mcp.mjs` rewrites the staged pin to `1.0.0` before installing the vendored archive. The packed MCP `package.json` then matches its earlier bytes, and `verifyInstalledMcpPackage` is unchanged.

## Risks / Trade-offs

- [The workspace MCP source builds against 1.1.0 while its archive bundles 1.0.0] → The MCP validates only 1.0 definitions (`identity`, `ticket`, `id`, `snapshot`, `request`, `receipt` and `failureCode`), and all of them are unchanged. `test:mcp:package` runs the bundled archive.
- [The reference assumes a start transmission succeeds] → Documented. Devices report real transport outcomes through the ordinary receipt fields.
- [`snapshotV1_1` repeats the 1.0 `maxPending` ladder] → Sharing it would mean editing the 1.0 `snapshot` definition. Revisit if a later minor changes snapshots again.
- [The core mood names may not suit every device] → Moods stay open IDs; only three core names are required, and devices map them to their own presets.

## Migration Plan

- There is no data or runtime migration. The in-repo pins move to 1.1.0 together with the package.
- Controllers adopt 1.1 in their own stories by serving `snapshotV1_1` to 1.1 readers and `downgradeSnapshot` output to 1.0 readers.
- To roll back, revert the change. The 1.0.0 release archive and its receipt stay untouched.
- After merge and green main CI, publish `controller-contracts-v1.1.0` with the archive, its SHA-256 and a source receipt.
