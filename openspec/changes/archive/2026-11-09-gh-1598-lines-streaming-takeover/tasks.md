## 1. Transport

- [x] 1.1 Encode version 2 external-control datagrams from rendered zones. Verify the byte layout, big-endian fields, white 0 and transition 1 with encoder tests.
- [x] 1.2 Add the `LightDatagram` transport, real UDP sender and `DeviceLink.stream`, threaded through the module, runtime and worker options. Verify that a datagram goes to the configured address and port, and that a send failure rejects.
- [x] 1.3 Model streaming mode in the simulated controller and the unit fakes: entry sets `*ExtControl*`, and datagrams apply only while it is selected.

## 2. Session

- [x] 2.1 Enter streaming with the Start's journaled write, then send frames as datagrams with no per-frame read. Keep pacing, latest value, Stop, alert and source loss. Verify with session tests.
- [x] 2.2 Detect takeover with the once-per-second check against `*ExtControl*`. Verify that the #1598 reproduction, an app pick served after one of the session's requests, ends `manual` with the pick kept.
- [x] 2.3 Keep restoration guards with the streaming selection, and end `device` on a failed send. Verify with session tests.
- [x] 2.4 Update runtime Music lighting tests whose fakes record frames.

## 3. Documentation and delivery

- [x] 3.1 Update the Nanoleaf README's live-session description.
- [x] 3.2 Run build, typecheck, lint, Nanoleaf, runtime Music lighting and workflow checks; record actual results.
- [x] 3.3 Sync and archive this change on the delivery branch. Independent Standards and Specification review and a focused device-command safety review follow on the PR. #725 qualifies the device behavior on the installed Lines.
