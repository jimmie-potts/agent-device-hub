## Implementation

- [x] Admit non-device module sections in the host-local configuration check and refuse the rest.
- [x] Start the core and the configured admitted modules in the host-local profile, refusing any that names a device.
- [x] Add focused negative controls and a real-runtime startup test for the admitted and refused cases.
- [x] Record the admitted modules and the manual configuration edit in the container guide.

## Verification

- [x] Run build, typecheck, lint, the container tests and the workflow checks.
- [x] Synchronize the capability specification and archive the change.

Verification evidence: on macOS arm64 with Node 24.22.0, build, typecheck,
lint:js, check:workflow and the container test command passed. The Linux-only
container runtime tests skip on macOS. test:workflow passed 224 of 226; the two
failures are apt-retry mirror tests whose script this change does not touch.
Three mutants (the secrets guard, the device-simulation filter and the
named-device check) each failed a test. Hosted Linux CI, independent Standards
and Specification reviews and installed acceptance on the Mac-local core are
pull-request and installation gates, recorded on the PR and Hub #1202.
