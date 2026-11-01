## Context

The current Checks workflow already selects all groups for non-PR events and checks every selected job. Workflow owns specification, preflight and retained-document coverage. The closed container exporter and production/test Dockerfiles already exclude private state. See proposal.md for the intended outcome.

Design is required because promotion crosses workflow and deployment ownership and needs evidence integrity before implementation.

## Goals / Non-Goals

Qualification identifies one candidate and immutable artifact. It never changes the installation. Automatic trigger activation belongs to the dependent policy change.

## Decisions

Reuse both workflows through a boolean qualification input, which can only expand Checks to all groups. The caller validates its full SHA against the requested candidate before starting children. Every checkout inherits that immutable caller revision.

Use Actions artifacts for a compressed Docker image archive rather than introduce a registry. Record the immutable Docker image ID as image identity, plus the archive SHA-256 and Linux ARM64 architecture. A test derivative identifies the production base; its full runtime catalog exercises built packaged bytes and existing negative controls.

A fixed concurrency group with cancel-in-progress false lets the active run finish and retains GitHub's newest pending candidate. No custom scheduler or automatic retry is added. A separate candidate remains unqualified until its own run succeeds.

A closed receipt binds repository, candidate, evaluation revision and input hashes, run/attempt, image, required job results and outcome. The consumer must additionally obtain authentic run, job and artifact identity from GitHub. A copied JSON document alone is not authority.

Workflow failures emit failed or incomplete evidence where the finalizer can run. Cancellation or missing artifacts remains incomplete. Failed qualification has no installation effects and requires an explicitly selected same-revision retry. Machine-readable receipts retain their own schema under ADR 0012; no runtime event envelope or diagnostic exporter changes.

## Risks / Trade-offs

Image archives cost transfer and storage; existing artifact retention bounds them. Expiry makes a candidate unavailable until explicitly qualified again. Native hosted ARM64 runner differences are reported with observations instead of converted to invoice savings. Temporary broad-workflow overlap is measured until trigger activation.

Only synthetic source and closed build contexts enter hosted artifacts. Private operational records, credentials and owner state remain outside GitHub under ADR 0011.

## Migration Plan

Land the manual path under existing delivery gates. After successful hosted evidence, the policy owner can activate coalesced main qualification and remove redundant broad triggers. Returning to the prior workflow configuration changes no installed state.
