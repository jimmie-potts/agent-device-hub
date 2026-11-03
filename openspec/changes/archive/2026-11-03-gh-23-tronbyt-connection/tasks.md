## 1. Connection

- [x] 1.1 Pin the compatibility record against current upstream releases (server v2.5.2, firmware v1.7.4) with a disposable server run
- [x] 1.2 Add `TidbytConnection` and `TronbytConnection` with a failing-first test for each difference from the cloud
- [x] 1.3 Add the backend selector to the section, with refusals for the other backend's settings

## 2. Writer and handoff

- [x] 2.1 Per-backend gate and refresh; the cloud's stay fixed
- [x] 2.2 Handoff: drop tile memory and display state, report an uncertain write once, settle unfinished commands, hear nothing more on the old backend
- [x] 2.3 Keep a database from before the record on the cloud with its tiles

## 3. Controls

- [x] 3.1 Declare brightness and modes on the Tronbyt backend; keep every capability unsupported on the cloud
- [x] 3.2 `brightness-set` and `device-mode-set` as tracked commands, with idempotent repeats, guards, expiry and outcomes
- [x] 3.3 The pin follows its tile; `hide-*` and `interrupt` act in the module

## 4. Verification and docs

- [x] 4.1 `SimulatedTronbyt`, fixture parity through both backends, and backend-specific authentication, errors and timeouts
- [x] 4.2 Optional check against a real server, run on a disposable one
- [x] 4.3 Card copy by backend, with its test
- [x] 4.4 README, development guide and specs
