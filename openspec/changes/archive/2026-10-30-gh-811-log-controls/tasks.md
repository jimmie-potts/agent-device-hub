## 1. The diagnostics section

- [x] 1.1 Add `checkDiagnosticsSection` and `DiagnosticsConfig` to the configuration reader, admit the `diagnostics` member and refuse any other shape with `config-invalid`.
- [x] 1.2 Refuse, at startup, a module level for a module this runtime does not host.

## 2. The floors

- [x] 2.1 Give `LogWriter.logger` its own optional floor and pass each module's configured level from the module host; take the file's level as the writer's floor, else `--log-level`, else INFO.
- [x] 2.2 Test the section's shape and refusals, a logger's own floor, INFO-and-above by default, DEBUG for one module without widening the others, a configured floor with one module below it, the file's precedence over `--log-level`, an unhosted name, and the file-based refusals beside the edge section's.

## 3. Documentation and qualification

- [x] 3.1 Document the section in the runtime README's "Configuration" and "Logs", the `--log-level` row and the container guide's configuration edit.
- [x] 3.2 Record the noise evidence: the installed hour's counts and a simulated shipped run's counts by event and level, with no demotion.
- [ ] 3.3 Run build, typecheck, lint, the runtime, scenario, container and workflow checks and OpenSpec validation; synchronize the specification and archive the change on the delivery branch before final review.
