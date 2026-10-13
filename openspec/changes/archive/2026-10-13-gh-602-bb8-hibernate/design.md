## Context

See proposal.md. Runtime registration and frontend generation discover package manifests, while scenario discovery imports built module files. Removing four CI steps alone does not stop implicit shared BB-8 checks. This crosses build, runtime and verification boundaries, so the schema's cross-cutting criterion requires this design.

## Goals / Non-Goals

**Goals:** Retain dormant code/state with zero default BB-8 feature verification; preserve active-device checks and stored-format refusal rules.

**Non-Goals:** Battery repair, new hardware, new runtime service, cleanup of private stores, physical acceptance or automatic reactivation.

## Decisions

Use one package hibernation marker in existing build-time discovery; it changes no runtime protocol or loader. Keep package manifests and format-reader source paths for retained state. Exclude both dormant packages from workspace installation so the Bluetooth dependency is not installed in CI; clean release Git archives still retain their source paths. Remove standalone build/typecheck commands and feature test runners; preserve dedicated test sources with `.hibernated` suffixes outside test discovery. Remove only BB-8 behavior branches from shared cases, keeping generic production-inventory metadata and all other owner cases. Keep remaining workflow expectation checks synchronized. A workflow-only removal was rejected because shared suites would still run the feature.

## Risks / Trade-offs

- Retained code is untested during hibernation → document its inactive status; a future owner decision must restore verification before use.
- Existing state still belongs to its format owners → preserve production readers, schemas and upgrade refusals; never equate dormancy with migration compatibility.
- Installed config changes affect one shared process → hold its existing operation lock, preserve unrelated config/grants and state, restart once and inspect ordinary required health. No backup exercise or device test.

## Migration Plan

Deliver reviewed source/CI through the existing guarded PR process. Disable only BB-8 configuration and its helper grant on the established target, with private intent/readback and no robot effects. Preserve the previous source and settings privately; no automatic recovery/replay is selected. Future resumption requires a new owner decision, working hardware and restored verification.
