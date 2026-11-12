## Why

History writes a row whenever any top-level member of a state record differs from the record it holds ([#1771](https://github.com/jimmie-potts/agent-device-hub/issues/1771), design [#1768](https://github.com/jimmie-potts/agent-device-hub/issues/1768)). A reading time nested in `observed` makes every Wemo and Pixoo reading a change: about half of the stored rows only repeat a reading with a new time. Before history can tell a repeated reading from a change (#1772), each state family must say which of its members may change while its state does not. A wrong entry would later hide real changes, so the declaration must be deliberate for every family and checked by tests.

## What Changes

- **Contracts package:** a new `v2/bookkeeping` module with the bookkeeping members of every state family the package defines, as JSON pointers to object members: `device` (the observation, paint and external-control times), `power-limit` (the copied reading time and the view's update time) and `playback` (the reading time); every other family, `session` included, declares an empty list. It also holds the rules a declaration must meet, a comparison that ignores bookkeeping members, and the leaf-mutation helper #1772 uses.
- **SDK:** `ModuleFactory.bookkeeping`, optional, for a module's own state families.
- **Modules:** the Pixoo declares `pixoo-display` `/monitor/page` (owner decision 3 on #1768), the Roborock `roborock-vacuum` `/observedAtMs/value` and LIFX `lifx-light` `/observed/observedAtMs` (the history replay on #1768).
- **Runtime:** `moduleBookkeeping` collects the modules' declarations beside `moduleSchemas`, and the shipped list refuses to assemble, so the runtime does not start, when a module declares a family of the contracts package, a family it does not register, a family another module declares, or a pointer the rules refuse.
- **Tests:** a checked-in classification table of every state family and version of the core and every registered module; the deny list; pointers checked through `$ref`, `allOf`, `oneOf` and `anyOf`; and the leaf-mutation check over each declared family's fixtures.
- **Unchanged:** every message, schema, payload, wire value and validation result; history, publishing and device polling. Nothing reads the declaration until #1772.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: adds the requirement "Bookkeeping members of state families".
- `bunny-sdk`: "Module registration" gains the optional `bookkeeping` member and the runtime's refusal at start.

## Impact

`packages/event-contracts` (`src/v2/bookkeeping.ts`, an export of the art state families, the package export, README and tests), `packages/sdk/src/registration.ts`, `apps/runtime/src/modules.ts` and its index, the Pixoo, Roborock and LIFX registrations, and runtime tests. No storage, migration, contract version or installation change; installation of the reader follows #1772 and #1774.
