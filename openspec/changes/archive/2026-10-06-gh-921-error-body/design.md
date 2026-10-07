## Context

app-verify's refusal line already uses the key `error`, for a 1.x string code that the Hub composition and vendored adapters read. app-verify promises no runtime dependencies, and its package check asserts that the archive installs none. `@jimmie-potts/event-contracts` is unpublished, and its `v2` entry reads its schema files at load time, which the esbuild intake bundle cannot follow.

## Goals / Non-Goals

**Goals:**
- Each body is exactly what the registry's `errorBody` returns.
- No 1.x consumer sees a changed or missing field.

**Non-Goals:**
- Failed outcomes, adapter and wrapper refusals, and maintenance's other entry points. These keep their 1.x shape until #839.
- New registry codes.

## Decisions

- **A sibling `errorBody` key in app-verify.** The 2.0 body cannot replace the string `error` without breaking its readers. Nesting the exact body under a new key keeps it valid against the error block. At #839 the line becomes `{"operation", "error": {...}}`. Rejected: replacing `error`, which breaks consumers, and a renamed inner object, which would not be the shared shape.
- **A top-level `error` in intake.** The key is free there, and the supervisor reads only the 1.x fields.
- **A copied code table, proved by test.** Each tool keeps the registry codes it uses and their `retryable` flags. A workspace test compares every body with `errorBody` from `@jimmie-potts/event-contracts/v2`. Rejected: a runtime import, which breaks the vendored archive and the build order, and bundling the registry, which changes packaging.
- **`detail` keeps the 1.x reason**, as `<error>: <detail>` in app-verify and the reason in intake, so the body still names it after #839.
- **Codes follow what helps a caller retry.**
  - A lock held by a live operation, or a capture in progress, is `capacity`, because a retry after it finishes succeeds.
  - Full private storage and capped tool output are `invalid-state`, because they return unchanged until the operator acts.
  - A reused run identity with different content is `duplicate-conflict`.
  - A configuration that fails to load is the operator's state, `invalid-state`, while a malformed request is `invalid-request`. Both keep the 1.x reason `invalid-or-unavailable-intake`.

## Risks / Trade-offs

- [A registry change to a used code's flag leaves the copy stale] → The workspace equality tests fail until the copy matches.
- [A packaged test cannot reach the registry] → It skips with a printed reason, and the package check runs its consumer outside every checkout and asserts that the skip happens there.
