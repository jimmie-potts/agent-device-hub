## ADDED Requirements

### Requirement: Module registration

The SDK SHALL export `ModuleRegistration`, which each runtime module exports as `registration` from its package entry (Hub #999): the module's factory (`name`, `create`, `simulate`, its own payload `schemas` and its `simulatedSection`), `shipped`, `order`, a number, and `after`, the module names that must start before it; optionally `registerFamilies`, which registers its families on a validator with checks beyond their schemas, and `simulation`, how the runtime's scenario harnesses simulate its devices. A `simulation` SHALL name the `actions` a scenario may ask for and, through `admits`, the other fields each action takes, and SHALL give two halves: `memory`, which creates the simulated device on a harness's clock and scheduler, reads its state, acts on a simulation and builds the module on it; and `run`, which creates what a disposable run's supervisor holds, reads its state, acts on a simulation with a `push` to the runtime's process, answers each call the runtime's module makes over its link, and builds the module with a `DeviceLink`, optionally starting from what the last runtime left (`handover`). A link's `call(method, args, signal)` SHALL resolve with `answered` and the device's value, `failed`, or `abandoned` when the signal aborted first. Its types SHALL need nothing but the SDK and the contracts packages, so a module registers itself within its boundary.

#### Scenario: Each module registers itself
- **WHEN** the runtime's build collects the device modules
- **THEN** each one's package exports a `registration` whose `name` is its manifest's, with its factory, its place in the shipped list and its simulation, and its folder imports only the SDK and the contracts packages
