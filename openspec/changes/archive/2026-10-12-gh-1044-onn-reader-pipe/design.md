## Context

The native reader accepts an inherited pipe as its only result channel and suppresses VM startup output. Android raw ADB uses a socket pair for subprocess stdout. Duplicating that socket directly into fd3 makes the reader refuse before emitting metadata. Synthetic tests previously supplied a pipe and missed the raw-channel mismatch.

## Goals / Non-Goals

**Goals:** Deliver the fixed reader result through raw ADB; preserve failure status, privacy and deadlines; qualify the mismatch without device access.

**Non-Goals:** New reader fields, relaxed descriptor checks, changed native artifacts, new transports, settings, helpers or deferred features.

## Decisions

Use a fixed shell pipeline from the existing invocation to `cat`, with `pipefail`. The shell creates the pipe before `3>&1` duplicates stdout. Reader output travels through the pipe into raw ADB; startup stdout/stderr remain suppressed. `pipefail` keeps a failed reader from becoming a successful shell exit when forwarding succeeds. No caller supplies a command, path or argument.

Keep the Java reader's pipe-only guard. Accepting arbitrary descriptors or reopening the raw socket would broaden the native boundary and require an artifact rebuild. This transport correction preserves both source and Dex pins.

The existing five-second transport signal and native watchdog bound the whole operation. An unavailable, malformed or interrupted result still creates a collection gap. The pipe carries no controls and adds no retry or fallback. Stores and wire formats do not migrate. Existing latest-state recovery preserves originals and gaps; failed activation restores only its matching configuration.

## Risks / Trade-offs

The fixed invocation depends on the selected Android shell's `pipefail` and ordinary `cat`. A synthetic socket-backed shell regression checks success and failure propagation with the actual reader; a new approved installed check must verify the selected device. Source tests alone do not establish device acceptance. No automatic alternative invocation is introduced.
