## ADDED Requirements

### Requirement: Local art decoration follows actual presentation
Local dashboard decoration SHALL use only a validated bounded palette from fresh decoded visibly presented artwork. Applying, locking or restoring decoration SHALL perform no generation call, device command, catalog edit or layout save. Invalid palette or styling input, missing assets, stale observations and unfinished or obsolete image loads SHALL keep the valid prior or default decoration.

#### Scenario: A new image is not ready
- **WHEN** selected artwork is loading, fails decoding, becomes stale or is replaced by a newer selection
- **THEN** its unpresented palette does not change decoration and the prior valid or default theme remains usable

#### Scenario: Styling input is malformed
- **WHEN** a palette or stored styling preference contains invalid colors, unknown fields, a texture URL, a private path or executable content
- **THEN** no supplied code or asset is used and the valid prior or default theme is retained

#### Scenario: Local application is free
- **WHEN** valid displayed art changes decoration or the owner locks or restores colors
- **THEN** provider-call and device-command counts do not increase and Home layout remains unchanged
