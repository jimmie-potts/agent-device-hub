## 1. Evidence and refusal

- [ ] 1.1 Add the closed qualification validator and hosted provenance checks, with failing-before and passing-after tests for failure, missing, wrong revision/digest/attempt and unexpected skip.
- [ ] 1.2 Add immutable candidate/input binding and image archive creation, verified by focused tests and real disposable image execution.

## 2. Hosted qualification

- [ ] 2.1 Reuse the existing full workflows with an expanding qualification input; verify all applicable jobs remain selected.
- [ ] 2.2 Add bounded coalesced manual qualification, packaged scenario/browser coverage and artifact finalization; verify a clean committed candidate on hosted Actions.
- [ ] 2.3 Document artifact consumption and scheduling limits; record elapsed time and job-minutes including retries, setup and temporary overlap against an identified baseline.

## 3. Delivery

- [ ] 3.1 Run build, lint, workflow and focused checks, then synchronize and archive the complete specification change before independent review.
- [ ] 3.2 Obtain independent Standards/Specification and hosted evidence readback on the committed candidate before merge authorization.
