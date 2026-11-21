## ADDED Requirements

### Requirement: Conversation generation uses a separate Art request version

`art-request/2.1` SHALL admit only a `start` of purpose `request` for the owner. Its subject SHALL be `art`. The payload SHALL contain exactly one format target, the existing `ui` still or the existing `pixoo` GIF processor, and nonblank Unicode scalar text of at most 300 characters. Version 2.0 SHALL retain its existing validation.

#### Scenario: A Conversation request cannot select display behavior

- **WHEN** a request has multiple targets, an ambient purpose, a cancellation, a variation, or undeclared fields
- **THEN** the validator refuses it under version 2.1
