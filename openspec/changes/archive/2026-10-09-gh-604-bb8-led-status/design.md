## Context

See proposal.md and the accepted [qualification](../../../../docs/bb8-controller-qualification.md). Cross-component authorization, durable intent/receipt state and a native dependency require this design artifact.

## Goals / Non-Goals

Keep public domain ownership and frontend in the existing WSL runtime. Keep native BLE and private transport receipts in Windows. Source validation uses synthetic inputs and fake GATT only; installation and physical evidence remain separate.

## Decisions

- `modules/bb8` exports its registration, explicit browser-only frontend and pure `./link` schemas/types. The Windows app imports the pure entry, never another application's implementation. WSL module transport defaults to SDK request/sync; a typed simulated transport supports the existing catalog. End-to-end fake GATT integration separately verifies the Windows packet path.
- Use existing SDK outbox transactions on each owner's private SQLite database. WSL responsibility rows hold IDs, guards and trace context, not executable commands; helper rows record admission, effect-start and results. Recovery only reconciles or completes these rows. An uncertain result persists a hold across restarts; an explicit guarded connect or disconnect releases it without replaying the held command. A completion storage failure leaves responsibility fenced and prevents subsequent writes until recovery.
- Helper role is an explicit optional credential members `role: bb8-link` and selected `robotId`, fixed source `bunny/parts/bb8-windows`, with no ordinary scopes. The edge grants its closed families/keys using existing SDK permissions. No browser/session authority changes. Ordinary credentials cannot acquire it accidentally through control/admin. Internal handlers separately require authenticated module source.
- Public requests carry configuration revision, helper epoch and connection generation. Internal requests add bounded deadline and equal operation/request IDs. One active operation and eight pending prevent unbounded work. A disconnected stream invalidates active/queued operations; each physical chunk rechecks live session/deadline. Restart creates a new epoch and never reconnects BLE.
- Native binding construction runs only behind explicit connect, private adapter/target enrollment and a target-global Windows mutex plus exclusive private-store ownership. Native output is captured privately with a bounded file; outward errors use registered fixed text. Native callbacks are generation-fenced. The pinned Noble dependency remains optional on Linux; Windows setup is documented, not activated.
- MCP denies the BB-8 family prefix before generic dispatch. Inbox resend additionally checks the selected saved family to close the alternate path. Frontend uses only SDK context, tracked Command and sync; main/tail writes are explicit and page entry is inert.

## Risks / Trade-offs

- Historical RGB/version/power assumptions may differ on real firmware → preserve exact selected PacketV1 allowlist and refuse malformed/unsupported replies without alternative writes; #605 observes the actual device.
- Two durable owners increase recovery complexity → separate result consumption from core outcome acknowledgment and test every commit/publication boundary.
- Windows native logs can reveal identity → isolate native execution, retain private bounded output and return fixed registered errors.
- Cross-host clock uncertainty can invalidate deadlines → require clock qualification in helper configuration, cap effect budgets and refuse if the local clock/stream cannot enforce them.

## Migration Plan

Source adds an opt-in configured module and helper; existing installations are untouched. #605 owns Windows setup and installed-runtime rollout after #1037, private enrollment, explicit radio authority and finite physical brief. Teardown ends BLE and releases only the helper's ownership. Recovery restarts passive and reconciles receipts; rollback never replays stored work.

## Open Questions

Actual adapter access, direct-address connection, firmware packet compatibility, visible LED behavior and battery credibility remain physical observations for #605; they do not change this bounded source contract.
