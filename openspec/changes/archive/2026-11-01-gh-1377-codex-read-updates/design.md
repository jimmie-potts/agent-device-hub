## Context

See proposal.md for the update failure and issue authority. Exact release checks
currently run in the launcher, the observer executable and the Desktop handshake.
The collector already requires the native protocol sequence independently of
those labels. Design is required because this changes producer qualification.

## Goals / Non-Goals

The selected application must survive a routine update with its private producer
and credential unchanged. Compatibility belongs to the finite observed protocol,
not a calendar-based Desktop version range. There is no new content reader,
native request, provider identity, state owner or automatic app restart.

## Decisions

1. Keep the existing exact request/response interpreter. Only a connection that
   initializes as Codex Desktop can supply candidates. Its version is
   descriptive metadata. The unread snapshot, latest completed turn, read operation,
   expected revision and matching successful changed-revision response remain
   mandatory. Additive fields do not change these decisions. Do not infer native
   semantics from an absent field or a version number.
2. Select the observer for the configured macOS bundle with the established
   Codex bundle identifier and expected executables. Read version/build values
   for the inspection result, without an allowlist. A wrong bundle is not enrolled;
   a valid application can still start normally when observation is unavailable.
   Other native subcommands and transports delegate without observation.
3. Keep the existing receipt feed string unchanged as an opaque enrollment ID.
   Its historical version text records where the profile originated, not the
   current app version. Reusing that ID preserves the dedicated grant and old-core
   compatibility. No core admission, wire schema or database migration is needed.
4. Keep failure and replay behavior unchanged: 30-second correlation, bounded
   frames/requests, live SDK sync, no offline action replay or publication retry,
   and fail-open native forwarding. Existing SDK traces/refusals and diagnostic
   exclusions follow ADR 0012; no native payload or credential is logged.
5. Prefer per-action protocol checks to broader version ranges or a fabricated
   startup read. Version ranges still reject compatible calendar releases and
   admit breaking patch changes. A synthetic startup action cannot prove what the
   real Desktop did and must not write to personal threads.

## Risks / Trade-offs

An upstream release can retain field shapes while changing when its UI marks a
reply read. The receipt means that the selected Desktop successfully marked that
reply read; it does not establish attention or comprehension. The baseline real
Desktop exercise and an updated-build exercise provide dated UI evidence, not a
guarantee about every future UI. A contradictory observed behavior needs a focused
adapter correction. Missing essential fields suppress receipts automatically.

The preserved enrollment ID contains old version text. The operator guide must
explain its stable meaning so an operator does not rewrite it on app updates.

The native executable layout or transport can change. Launcher inspection and
unobserved delegation retain truthful readiness; they cannot promise that an
unsupported transport will yield receipts. Existing connections require normal
quit/relaunch to use replacement host code.

## Migration Plan

Build and review one committed source, run hosted CI and pin the merged host
release. Verify its source and unchanged enrollment derivation before replacing
the owned launcher selection. Preserve the private producer, permissions, old
release and exact prior launcher bytes. Prove compatibility against the existing
accepted core without restarting it. Perform real Desktop action acceptance
through a permitted operator-run disposable profile. Restoring the prior host
launcher restores its exact-version policy; no database rollback is involved.
