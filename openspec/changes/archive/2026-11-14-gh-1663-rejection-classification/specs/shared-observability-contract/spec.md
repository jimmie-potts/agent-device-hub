## ADDED Requirements

### Requirement: Profile 1.11 Nanoleaf rejection details

Profile 1.11 SHALL add a closed rejection stage and category pair only to generic Nanoleaf transport rejections in the runtime module scope. It SHALL allow positive safe integer counts of each registered pair on a failed-run summary or recovery. Those optional attributes SHALL exclude raw errors and content.

#### Scenario: Explicit downgrade
- **WHEN** a valid classified timing record is explicitly projected to profile 1.10
- **THEN** only the new vocabulary is removed and the existing timing remains valid, while a malformed source record or a projection of that timing event below profile 1.10 is refused
