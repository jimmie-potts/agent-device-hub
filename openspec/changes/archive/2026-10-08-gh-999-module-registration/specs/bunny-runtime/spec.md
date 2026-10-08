## ADDED Requirements

### Requirement: The shipped list from module registrations

The runtime's build SHALL write a registry with one static import of the `registration` of each package in a folder under `modules/`, in folder order, so the runtime loads no module at run time and the shipped set is fixed when it is built (Hub #999). The shipped list SHALL hold the agent-session core first, by construction, then every registration that ships, each after the modules its `after` names, and otherwise by `order`, then by name. The list SHALL NOT assemble when a registration is named `core`, two registrations share a name, an `order` is not a finite number, an `after` names a module that does not ship, or registrations wait on each other. The shipped order SHALL be the one before registration: the core, then the playback, LIFX, Tidbyt, Pixoo, Nanoleaf and Codex Desktop modules.

#### Scenario: The core first, then each shipped registration
- **WHEN** the shipped list is built from registrations with orders, ties and an `after` that names a module with a higher order
- **THEN** the core is first, a lower order starts first, a tie starts by name, the `after` module starts before the one that names it, and a module that does not ship is left out

#### Scenario: A list that breaks a rule
- **WHEN** a registration is named `core`, two share a name, one names an unknown or an unshipped module in `after`, two wait on each other, or one's order is not a number
- **THEN** the shipped list does not assemble, and the error names the rule

#### Scenario: A module added in its own folder
- **WHEN** a throwaway module is written only under its own folder in a scratch checkout, with its registration, its simulated device and its scenario file
- **THEN** the registry the build writes imports it, the shipped list places it by its order when it declares itself shipped and leaves it out when it does not, the catalog's collection takes its scenario file, and its scenario passes in the in-memory harness on both transports

### Requirement: Harnesses drive registered modules through their registrations

The in-memory harness and a disposable run SHALL build and simulate each registered module through its registration's `simulation`, and SHALL keep code of their own only for the core and the fixture modules (Hub #999). The in-memory harness SHALL create each registered module's simulated device once, on its own clock and scheduler, so the device outlives the runtime's restarts and crashes. A disposable run's supervisor SHALL hold each registered module's `run` half, which outlives the runtime child, and SHALL answer each call the child's module makes over the IPC channel; a call the module abandons SHALL abort the supervisor's call, a runtime that ends SHALL abort its calls, and an answer that comes after SHALL be dropped. The supervisor SHALL hand each new child what the last one left, and SHALL push a simulation to the child's module when its registration asks. Both harnesses SHALL refuse a simulation whose device, action or other field the registration does not take, and the supervisor's state document SHALL key each registered device by its module's name. Both harnesses SHALL take one list of payload schemas, the fixture families' and every registration's, and one validator that registers each registration's families with its checks. The catalog SHALL hold the core's and the fixture modules' scenarios, and SHALL collect each registered module's scenarios and disposable runs from its own file under `tests/scenarios/modules/`, after the core's, in file-name order. A workflow check SHALL fail when a shared file of the runtime or the harnesses names a device module.

#### Scenario: The same catalog through registrations
- **WHEN** `npm run test:runtime:scenarios` and the disposable runs' tests run after the refactor
- **THEN** the catalog lists the same scenarios by name, each passes in process and through the edge, and the disposable runs keep the same run scenarios, capture steps and results

#### Scenario: A disposable run's link
- **WHEN** a module built over the link calls its device, a simulation is pushed, a call is abandoned, and the runtime that made a call ends
- **THEN** the call reaches the supervisor's device and the answer comes back, the push reaches the module's process, the abandoned call and the ended runtime's call abort the supervisor's own call, a call aborted before it is sent is never sent, and a device that refuses a call answers `failed`

#### Scenario: A shared file names a module
- **WHEN** a module's name, in any letter case and with its hyphens as hyphens, spaces or nothing, is added to a shared file
- **THEN** `npm run test:workflow` fails, naming the file, the line and the module, while the core's and a fixture module's names pass
