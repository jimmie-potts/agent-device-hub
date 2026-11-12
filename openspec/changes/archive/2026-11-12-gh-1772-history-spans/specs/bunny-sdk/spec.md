## MODIFIED Requirements

### Requirement: Module registration

The SDK SHALL export `ModuleRegistration`, which each runtime module exports as `registration` from its package entry (Hub #999): the module's factory (`name`, `create`, `simulate`, its own payload `schemas` and its `simulatedSection`), `shipped`, `order`, a number, and `after`, the module names that must start before it; optionally `registerFamilies`, which registers its families on a validator with checks beyond their schemas, `simulation`, how the runtime's scenario harnesses simulate its devices, and `hostLocal` (Hub #567), a predicate saying of a configuration section that the module reaches no local device or file for it, so a host that disables device control may admit that section although the module declares a simulation. A `simulation` SHALL name the `actions` a scenario may ask for and, through `admits`, the other fields each action takes, and SHALL give two halves: `memory`, which creates the simulated device on a harness's clock and scheduler, reads its state, acts on a simulation and builds the module on it; and `run`, which creates what a disposable run's supervisor holds, reads its state, acts on a simulation with a `push` to the runtime's process, answers each call the runtime's module makes over its link, and builds the module with a `DeviceLink`, optionally starting from what the last runtime left (`handover`). A link's `call(method, args, signal)` SHALL resolve with `answered` and the device's value, `failed`, or `abandoned` when the signal aborted first. Its types SHALL need nothing but the SDK and the contracts packages, so a module registers itself within its boundary.

A factory MAY also give `bookkeeping` (Hub #1771): the bookkeeping members of the module's own state families, by family, as the requirement "Bookkeeping members of state families" of the message profile defines them; a family it leaves out has none. The runtime SHALL collect the declarations beside the modules' schemas, and the shipped list SHALL refuse to assemble, so the runtime does not start, when a module declares a family of the contracts package, a family its `schemas` do not register or one another module also declares, or a pointer that requirement refuses. History SHALL read the declaration to tell a repeated reading from a change (#1772).

A factory MAY also give `polling` (Hub #1772): the state families the module publishes on a poll, each with its polling interval in milliseconds, the longest one when the interval changes with the device's state; a family it leaves out is published only when something happens. A family SHALL be one its `schemas` register or a state family of the contracts package, and an interval SHALL be a whole number of milliseconds from 1 to one hour; otherwise the shipped list SHALL refuse to assemble, so the runtime does not start. The runtime SHALL give the core's history each module's declaration by the module's source, for its gap rule.

#### Scenario: Each module registers itself
- **WHEN** the runtime's build collects the device modules
- **THEN** each one's package exports a `registration` whose `name` is its manifest's, with its factory, its place in the shipped list and its simulation, and its folder imports only the SDK and the contracts packages

#### Scenario: A host-local section
- **WHEN** a module's registration gives `hostLocal` and a host without device control checks a section
- **THEN** the section is admitted only when the predicate says it reaches no local device or file, and a module without the predicate is admitted only when it declares no simulation

#### Scenario: A module redeclares a family of the contracts package
- **WHEN** a registration declares bookkeeping for `device`
- **THEN** the shipped list refuses to assemble, naming the module and the family, and the runtime does not start

#### Scenario: A declaration the runtime refuses
- **WHEN** a registration declares bookkeeping for a family it does not register, for a family another module declares, or with a pointer to a member that is never bookkeeping or that its schema does not declare
- **THEN** the shipped list refuses to assemble with a sentence naming the module, the family and the reason

#### Scenario: A polling declaration
- **WHEN** the shipped registrations declare their polled families, and a registration declares a polling interval for a family it neither registers nor can publish as a contracts state family, or an interval of 0, a fraction or more than one hour
- **THEN** the declarations equal the checked-in table of every registered module, and each bad one refuses the shipped list with a sentence naming the module, the family and the reason
