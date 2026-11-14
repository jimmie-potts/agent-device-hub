## 1. Retire the entry points

- [x] 1.1 Remove standby startup, admission and peer following. Verify stale control and peer inputs fail before startup or state creation.
- [x] 1.2 Remove the settings history modes. Verify retired queries and standby status refuse, and ordinary history still serves.

## 2. Preserve active behavior

- [x] 2.1 Remove replication history writes. Verify old rows remain intact, new rows stop recording metadata and active Automation edits retain ordinary history.
- [x] 2.2 Exercise active credential and browser guards, SDK lifetime, settings-owner saves and the fake Docker operator commands.

## 3. Synchronize the record

- [x] 3.1 Update current guides and capability specifications, verify links and validate the synchronized change.
