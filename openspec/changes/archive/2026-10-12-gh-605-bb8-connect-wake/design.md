## Context

See proposal.md. GATT discovery and ATT write callbacks succeeded, but a sleeping robot sent no ping reply. The same bounded connection with one wake produced valid ping/version replies and ordinary LED/power results. Subscription reordering alone failed.

## Goals / Non-Goals

**Goals:** Make existing explicit connection work while exposing its wake effect.

**Non-Goals:** Motion, new wire/state schemas, automatic wake/reconnect, native dependency changes or release/backup machinery.

## Decisions

Keep the current explicit connect operation and add one existing wake-characteristic write before ping. Its normal checks, effect recording, spacing and timeout apply. Require discovered wake write support before any initialization write. Keep the current subscription ordering because the physical control refuted that hypothesis. A separate pre-handshake Wake operation would require extra link state and commands; the existing explicit Connect is sufficient when its effect is named.

Use **Connect and wake** in the module-owned frontend and explain wake before protocol checks. Keep the separate Wake control for an already established connection. No outward diagnostic shape changes; temporary private instrumentation is excluded from source.

## Risks / Trade-offs

- Wake may illuminate or initialize the robot → name that effect before explicit activation; no startup or read effects, no intentional motion packet.
- Wake or later replies can fail → preserve uncertainty, cancellation, no retry and explicit Disconnect cleanup.
- Live discovery occasionally stalls → retain current bounds and honest failure; do not add speculative native repairs.

## Migration Plan

No database/configuration change. After accepted source, replace only the selected helper code while it is stopped, preserve native Windows deployment/configuration/token/state, and perform a short normal-use finish check. The dashboard wording follows the selected runtime source installation; old Connect callers receive the newly documented wake initialization. No extra backups or recovery exercise is selected.
