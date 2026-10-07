## 1. The span file

- [x] 1.1 Assert, red before the module exists, that a finished span is a line in an owner-only file, that the pair keeps the latest spans in order within its bound and counts every span let go, that a restart continues the files, that a link, a second hard link and a group-readable file are refused, that a cut line is counted and never returned, and that a read is bounded (`span-file.test.ts`).
- [x] 1.2 Add `span-file.ts`: the segment pair, the header, the bounded reader and the private open.
- [x] 1.3 Assert, red before the option exists, that `spans: 'state-file'` and `--record-spans` write the file and keep nothing in memory, that a runtime without them writes none, and that a file that is not private refuses the start before a module starts (`tracing.test.ts`, `process.test.ts`).
- [x] 1.4 Add the option to `startRuntime`, the flag to the entry point and the exports.

## 2. The query

- [x] 2.1 Assert, red before the module exists, the four cases from the memory harness's real records and spans, a killed runtime, an absent request, a capped query, the trace query with a replay's link, another request on the same trace, every gap, a missing parent, a record or span that is not a contract record, a real handler that throws a secret, and selector and limit refusals (`follow.test.ts`).
- [x] 2.2 Add `follow.ts`: selector and limits, span parsing through the contract's checks, matching, parents, decisions, gaps and the answer.

## 3. The run

- [x] 3.1 Assert, red before the route exists, that the supervisor follows a request, refuses bad queries with 400 and no echo, applies the harness's local-only checks, shows a clean restart as clean and a kill as ended without its stop record, and keeps a killed runtime's finished spans (`supervisor.test.ts`).
- [x] 3.2 Add the harness route, `--record-spans` and `--log-level info` in the runtime's arguments, and the stderr drain between runtimes.
- [x] 3.3 Assert, red before the step exists, that `follow-one-request` passes and attaches one answer for each case, that its negative control fails, and, through a real lifecycle run, that `stop` removes the span file with the runtime directory (`steps.test.ts`, `runs.test.ts`).
- [x] 3.4 Add `follow-proof.ts` and the two capture steps.

## 4. Documentation and qualification

- [x] 4.1 Update the runtime and adapter READMEs, the diagnostic contract's adoption section and the runtime verification checks in `docs/development.md`.
- [x] 4.2 Run build, typecheck, lint, the observability, SDK, event, runtime, scenario and verify checks, the workflow checks and OpenSpec validation.
- [x] 4.3 Show that named tests fail under each negative control: a record from another request in the answer, a missing span reported as present, an over-limit query that hides its cap, `tok_SYNTHETIC950` in the output, a crashed runtime shown as clean, a span line the contract refuses shown, a file that follows a link or is not private, spans let go but not counted, a stopped runtime's last lines not drained, a cut line glued to the next runtime's span, the flag ignored, and a refusal that echoes its input.
- [x] 4.4 Run one request end to end through a real lifecycle run, as an Acceptance reviewer would, and stop it.
- [x] 4.5 Synchronize the affected specification and archive the change.
