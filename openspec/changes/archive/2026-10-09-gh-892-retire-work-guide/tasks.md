## 1. Preserve shared consumers

- [x] 1.1 Retain #890 diagrams independently; pass diagram, atlas and no-Guide regression checks.
- [x] 1.2 Extract maintenance parser and section handling; pass parsing, upsert, fingerprint and closeout regressions.

## 2. Retire Guide dependencies

- [x] 2.1 Delete Guide application, outputs, contracts and exclusive fixtures; audit active imports, commands and links.
- [x] 2.2 Remove Guide preflight flags and exceptions; pass non-Guide evidence, missing-CI and rejected-flag regressions.
- [x] 2.3 Move retained checks into Workflow; pass routing/artifact tests and compare live required-check identities.
- [x] 2.4 Remove Guide from Places, regenerate retained pages and export; pass static, browser, preview-isolation and dashboard navigation checks.
- [x] 2.5 Update current instructions/templates and parser ownership; verify no new-work Guide obligation and document historical exceptions.

## 3. Validate source acceptance

- [x] 3.1 Run owning build/type/lint/workflow/preflight/maintenance and navigation checks; retain actual results and limits.
- [x] 3.2 Synchronize current capability specs and archive this completed change before independent final review.

Validation: 193 workflow tests, 96 preflight tests, 73 maintenance tests, 16 extracted Python parser tests and packaged maintenance consumer passed. Build, typecheck and lint passed. Both dashboard browser suites, retained Places (42 pages and 5 mobile views), atlas, reference, diagram hashes and no-Guide checks passed using synthetic inputs. No installed service, device or public deployment was changed.
