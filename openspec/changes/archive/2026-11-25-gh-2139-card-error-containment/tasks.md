## 1. Tests first

- [x] 1.1 A browser journey with a faultable test build: Home render and effect faults, a component page and a module page; each part fails on the base code with the page unmounted.
- [x] 1.2 A unit test of the fault record: one record, table level, card identity and error type, no message.

## 2. Containment

- [x] 2.1 One boundary at each Home card, component page card and module page; the journey and unit test pass.
- [x] 2.2 The journey harness fails on an unexpected failed card, shown by an existing journey run with a fault.
- [x] 2.3 Boundaries at the route pages, the device directory, the rail's conversations and the backdrop source, and around the work that picks a card's content; a route page and the directory fail on the base code with the page unmounted.
- [x] 2.4 The harness records a card that fails after the last health check and the world's close fails the run on it, shown red on the base harness and green with the card named.

## 3. Documentation

- [x] 3.1 The runtime dashboard README describes the failed card, what is and is not contained, and its record, formed and not yet delivered.
