## 1. Profile 1.7

- [x] 1.1 Register `exception.message`, `exception.stacktrace`, `bunny.exception.redacted_count` and `bunny.exception.truncated` as profile 1.7 of artifact 1.7.0 in the catalog and schema: admitted together, under `bunny.runtime` and `bunny.module` only; admit `telemetry.dropped` under `bunny.runtime` at 1.7; remove the four fields on projection to an earlier profile in TypeScript and Python.
- [x] 1.2 Add fixtures: a runtime fault and a module failure with the fields, the same labeled 1.6, exception text under a hub scope, an empty and an over-long message, counts without text and text without counts, the raw `error.stack` field, the runtime's `telemetry.dropped` at 1.7 and labeled 1.6, and a hub host's at 1.1; rename the unknown-version case to 1.8.
- [x] 1.3 Move the version, the pins, the lockfile and the packaging script to 1.7.0; update the profile, host and Python tests.

## 2. The serializer and the runtime

- [x] 2.1 Add `exceptionFields` to the SDK, reading only an `Error`'s own message and V8's own stack, with the caller's filter, the credential and content rules, counts and byte-bounded truncation; export it and give `telemetry.dropped` its level.
- [x] 2.2 Test it with allowed synthetic context, credential canaries in every rule's shape (`=`, `:` and quoted forms, JSON members), a caller-named secret, a long prompt and body on one line and across lines, truncation in characters and bytes and between frames, hostile, bound and caller-installed getters, a cause, an `errors` list, a non-string message and a non-Error, and a profile 1.7 record it produces.
- [x] 2.3 Add `Redactions.scrub` and `faultFields` to the runtime's log writer, write the runtime's fault records through it, and write every record at profile 1.7, with the kit's record check at 1.7.
- [x] 2.4 Extend the runtime's isolation, configuration, diagnostics and process tests so a fault record carries the filtered text and never the synthetic secret, and the maintenance intake's finding carries none of it.

## 3. Documentation and qualification

- [x] 3.1 Amend ADR 0012 "Safe errors" and its amendments, the diagnostic contract (version, privacy paragraph and "Private exception context"), the observability README and TESTING, the runtime README's "Logs" and the SDK README.
- [ ] 3.2 Run build, typecheck, lint, the observability Node, Python, query, package and browser checks, the SDK, runtime, scenario, maintenance and workflow checks, and OpenSpec validation; record the results in the PR.
- [ ] 3.3 Synchronize the affected specifications and archive the change on the delivery branch before final review.
