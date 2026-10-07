## ADDED Requirements

### Requirement: Modules that serve one family side by side

The runtime SHALL start and run several modules that serve the same sync family, such as `device`, which every device module serves for its own devices (Hub #918, #967). A module's source on the bus SHALL be `bunny/modules/<name>`, or `bunny/core` for the core, so the module names that the shipped module list and health give are the owners a consumer names. Each module's health entry SHALL list in `serves` the families it serves through sync now, and SHALL have no `serves` while it serves none, so a consumer syncs a shared family only from the modules that serve it. A module, or a remote part through the runtime's edge, SHALL sync such a family from each owner by name and get only that owner's records; a sync that names no owner while several serve the family SHALL be refused with `invalid-request` and recorded once as `runtime.sync.refused` at INFO.

The fixture lamp and the configured fixture sign SHALL each serve their own devices' `device/2.0` records beside their own family: the lamp's record names its kind with every capability unsupported, and the sign's carries the sign's availability, which the sign publishes as a device record whenever it publishes the sign's changed state. The scenario catalog's seed SHALL let a reader's copy name its owner, and the reader view SHALL read one owner's copy of a family. The catalog's `device-owners` scenario SHALL run in the in-memory harness on both transports and in a disposable run.

#### Scenario: Two modules that serve device run
- **WHEN** the runtime starts two in-test modules that both serve `device` for their own devices, and a third module that syncs `device` from each by name at its start
- **THEN** health shows all three running with status `ok`, and `serves` lists `device` for the two device modules and is absent for the third; the third module's copy from each owner holds only that owner's devices, a remote part through the edge syncs each owner by name with the same result, and its sync that names no owner is refused with `invalid-request` and recorded once at INFO

#### Scenario: The device-owners scenario
- **WHEN** the catalog's `device-owners` scenario starts the core, the lamp and the configured sign, offline at first, and the reader follows `device` from the lamp and from the sign by name
- **THEN** every module runs, and health names the lamp and the sign, and no other module, as serving `device`; the copy from the lamp holds only lamp-1; the copy from the sign holds only sign-1, unavailable after the sign's deadline and available once it is online; each copy synced once; and the reader's own syncs of `device` with no owner and from the core are refused with `invalid-request` at INFO and `unavailable` at WARN, each recorded once
