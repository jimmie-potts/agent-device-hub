## MODIFIED Requirements

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion`, `checkContributions` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. `MODULE_API_VERSION` SHALL be `1.3`: `1.1` added the module's configuration, secrets, private folder and worker calls to `1.0`, and `1.2` adds its contributions to the runtime's gateway (Hub #835); a `1.0`, `1.1` or `1.2` module SHALL still be accepted. Module API `1.3` SHALL add the frontend presentations and trusted assets specified below without changing message profile 2.0.

A manifest MAY declare `pages` (at most 16, each passive page `{id, title, render}`, or a frontend page shape permitted by module API 1.3, with distinct IDs of lowercase letters and digits with single hyphens of at most 64 characters, never `content` or `assets`, and titles of at most 80 characters), `content(ref)` (content by reference, `{type, bytes}` or undefined), `tools` (at most 16 read tools, each `{name, description, input, output, read}`, with distinct names of a lowercase letter then lowercase letters, digits and underscores of at most 48 characters, descriptions of at most 1024 characters, an object `input` schema that allows no other member and an object `output` schema) and `settings` (`{schema, show}`, an object schema and what to show of the configuration `configure` accepted, so a module that declares settings SHALL declare `configure`, keeping one configuration path). `checkContributions` SHALL refuse each malformed one with `invalid-request`, and SHALL refuse any of them in a manifest written for a module API older than `1.2`. `checkManifest` SHALL include it.

The manifest MAY declare a synchronous `configure(section)` that returns `{config, devices?}` or a refusal from `errorBody`, whose detail SHALL be fixed text that repeats no value from the section, since health shows it. A module's context SHALL type its configuration as possibly undefined, because `configure` is optional. `checkConfiguration(manifest, section)` SHALL check a module's own section of the runtime's configuration file as the runtime does before it starts the module, and SHALL return `{status: 'accepted', config, devices, secrets}` or `{status: 'refused', problem}`: a module that declares `configure` needs a section (`not-found`); a section is a JSON object (`invalid-request`); its `secrets` member, when present, maps at most 16 names, each lowercase letters and digits with single hyphens, to absolute paths (`invalid-request`); `configure` must not refuse, with the refusal's code and detail, throw (`internal`, keeping what it threw in memory only) or answer neither a configuration nor a valid refusal (`internal`); and its devices must be distinct routing IDs of at most 128 characters (`invalid-request`). A module without `configure` SHALL get an undefined configuration and the secrets its section names. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

#### Scenario: The kit and the runtime check the same configuration
- **WHEN** `checkConfiguration` gets no section for a module with `configure`, an array, malformed secrets, a refusing or throwing `configure`, devices that are not distinct routing IDs, and a valid section
- **THEN** it refuses them with `not-found`, `invalid-request`, `invalid-request`, the refusal's code or `internal`, and `invalid-request`, and accepts the valid one with its configuration, devices and secrets; the runtime refuses and the kit's manifest check fails for the same sections

#### Scenario: Contributions checked like the rest of the manifest
- **WHEN** `checkManifest` checks a `1.2` module with a page, content, a tool and settings, the same contributions declared by `1.0` and `1.1` modules, pages with malformed, repeated or reserved IDs, a missing title or render, tools with malformed or repeated names, an input that allows other members, a non-object output or no read, and settings without `configure`, schema or show
- **THEN** it accepts the `1.2` module and a `1.3` one, refuses the older ones with `pages, content, tools and settings need module API 1.2` while each still runs without contributions, and refuses every malformed contribution with `invalid-request` and a fixed sentence naming it

#### Scenario: Frontend declarations require their API version
- **WHEN** a module declares an interactive page or trusted asset under API 1.2, or declares the valid corresponding shape under API 1.3
- **THEN** the older declaration is refused with `invalid-request`, the valid 1.3 declaration is accepted, and legacy passive pages continue to work

## ADDED Requirements

### Requirement: Browser frontend and trusted asset declarations
The SDK SHALL define browser-safe frontend contributions for the fixed shipped modules, keyed by module and page identity. Pages SHALL distinguish passive HTML, integrated frontend components and trusted bundled editors. A component page SHALL require no Node renderer. A trusted editor SHALL name finite declared script/style assets; asset identities and types SHALL be validated separately from arbitrary content references. Malformed, duplicate, mixed or reserved declarations SHALL be refused with the shared `invalid-request` code before use. Browser contributions SHALL expose no credential, storage or device transport implementation.

#### Scenario: Passive and interactive pages coexist
- **WHEN** a module declares one valid passive page, one frontend component and one trusted editor with declared assets
- **THEN** their presentations remain distinct and each can be admitted without enabling scripts in the passive page

#### Scenario: User content is not an executable asset
- **WHEN** a client supplies an undeclared asset reference or uploads content containing executable markup
- **THEN** no declaration is created and that content cannot execute through the trusted asset route
