## 1. Recovery

- [x] 1.1 Host tests for the restart decision: settle, retry, configured and suspended never restarted, addressed-but-unconfigured back-off (10 s doubling to 320 s, surviving re-enumeration flips), reset on configuration, short loss, settle and retries across the clock wrap; implement `UsbRecovery` (evidence: `firmware/chompi-controller/test/test_usb_recovery.cpp`, `make test`).
- [x] 1.2 Wire it into the main loop with a data-line reclaim and a USB device restart; build the ARM image and run the artifact check (evidence: `scripts/arm-build.sh`).
- [x] 1.3 Reproduce the failure and verify recovery of the first candidate rule on the owner's CHOMPI with a local diagnostic build (evidence: #743 trial record); the final rule's device acceptance is B11 on the merged image.

## 2. Documentation and validation

- [x] 2.1 Document the behavior in the firmware README and the firmware spec.
- [x] 2.2 Run the firmware host tests, the ARM build and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the spec and archive this change before final review.
