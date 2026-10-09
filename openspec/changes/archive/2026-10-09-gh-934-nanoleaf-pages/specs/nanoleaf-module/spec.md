## MODIFIED Requirements

### Requirement: Nanoleaf module and its configuration

The runtime SHALL ship the Nanoleaf module, `nanoleaf`, the TypeScript port of codex-nanoleaf (Hub #26) wrapped as a module of API `1.3`, created by `createNanoleafModule({transport})` with the Nanoleaf HTTP client as its real transport and a simulated controller under `--simulate`. Its `configure` SHALL take 1 to 8 devices, each with a routing ID, a kind (`lines` or `panels`), a private IPv4 address and the name of its token's secret file, with exactly one Lines device, `wall`; 1 to 128 distinct qualified agent sources; and, optionally, Codex Desktop's metadata files. It SHALL refuse anything else with `invalid-request` and fixed text that repeats no value from the section, and return the device IDs. Its start SHALL open only local resources: its own SQLite file, its private folder, where it writes the port's registry file without any token, and its secret files, whose tokens it keeps in memory only.

#### Scenario: A section the module accepts or refuses
- **WHEN** the module's section names the Lines as `wall` with a private address and a named secret, or names a public address, a second Lines device, a device without its secret or a setting the module does not take
- **THEN** the first is accepted with its device IDs, and each other is refused with `invalid-request` and a fixed detail

#### Scenario: Tokens stay in memory
- **WHEN** the module starts with its token file and reaches its controllers
- **THEN** each request carries the token, and no file the module writes, message, log record, reply or synced state holds it

## ADDED Requirements

### Requirement: Integrated Nanoleaf wall editor

The Nanoleaf module SHALL declare a Wall page in the runtime dashboard. It SHALL preserve the existing editor's saved Lines and Panels views, device selection, task and project inspection, keyboard selection, Classic and Project layout, coverage, element assignments and signature swaps, project colors, palette, orientation, Locate, device-only eviction, and Work, Quiet and Free controls. Local assembly, number visibility, filters and selection SHALL remain browser presentation choices. The page SHALL consume the shell's authenticated connection and shared tracked-command behavior without contacting the old wall service, a private store or a physical controller. Opening, selecting, local presentation changes and unsubmitted drafts SHALL send no command and change no saved scene or device. User-controlled text SHALL remain text, never executable markup.

#### Scenario: Opening and selecting the wall
- **WHEN** an authenticated reader opens the declared Wall page and selects an element or changes a local display preference
- **THEN** the saved wall and task details are visible inside the shell, keyboard selection works, and command count, saved scenes and device effects remain unchanged by those interactions

#### Scenario: Existing editor controls
- **WHEN** a controlling user changes a supported map setting, assignment, project color or palette, requests Locate or eviction, or chooses a mode
- **THEN** the action targets the selected device through its existing command family and retains the module's ownership and domain refusals; no other device is targeted

#### Scenario: Device switch and page exit
- **WHEN** a user switches from Lines to a configured Panels device and then leaves the editor
- **THEN** the view and controls use the selected device's saved geometry and supported operations, and the departed editor stops its subscriptions, listeners and animation work without sending a command

### Requirement: Cached editor geometry and qualified navigation

The module SHALL serve a bounded editor-layout content reference for one explicitly selected configured device, using only the saved layout. The response SHALL identify its schema and device and include only the validated connector graph needed to render the Lines; Panels use their saved element outlines. Unknown devices, malformed parameters, missing geometry and unavailable modules SHALL return shared registry errors with fixed text and no filesystem path. The read SHALL NOT discover geometry, write a file or contact a controller. The page SHALL retain a stale or unavailable indication rather than infer an empty current wall, and an explicit read retry SHALL never repeat an edit.

A wall task SHALL optionally carry a Codex Desktop navigation URL only when its qualified source identity is Codex Desktop and its session ID is a plain UUID. That URL SHALL have exactly the form `codex://threads/<UUID>`. Other clients, malformed identities, titles and user text SHALL never become a navigation target. Geometry, page source and wall state SHALL expose no device address, secret, token or animation favorite.

#### Scenario: A cached layout read has no effects
- **WHEN** the page reads a configured Lines device's saved connector geometry
- **THEN** it receives a bounded validated graph for that device without a controller read, store write or scene change

#### Scenario: Missing or invalid layout
- **WHEN** the page selects an unknown device, uses a malformed device query or reads a device with missing saved geometry
- **THEN** the request returns its registry refusal without falling back to another device, exposing a path or discovering geometry; the page provides an honest unavailable state and a read-only retry

#### Scenario: Qualified Desktop navigation
- **WHEN** the wall shows a qualified Codex Desktop task with a UUID session ID, another provider's task, and a task whose title or identity contains a URL-shaped string
- **THEN** only the qualified Desktop UUID produces a local Codex navigation link; the other values remain inert text and no navigation changes unread state by itself

### Requirement: Authorized wall actions and tracked results

A wall mutation SHALL require the runtime's control authority and existing browser request and Origin checks. The editor SHALL show no enabled mutation control to a read-only or disconnected caller, and the runtime SHALL independently refuse an unauthorized command before effects. Explicit actions SHALL use the existing core dispatcher, shared request identity and operation tracker. An accepted reply SHALL remain distinct from completion. Failed, expired and uncertain outcomes SHALL preserve their registry code and evidence, and neither reconnect, refresh, page reload nor an uncertain result SHALL resend an action. Existing machine-edit ownership, device holds and one writer per device SHALL remain authoritative.

#### Scenario: One saved editor change
- **WHEN** a controlling user selects an existing element and explicitly swaps its signature or changes its project
- **THEN** one authenticated wall-edit command is tracked through acceptance and completion and the owner's updated view confirms the edit; refreshing the page sends no second command

#### Scenario: Read-only and Origin refusal
- **WHEN** a read-only caller attempts the same edit, or a browser mutation fails the runtime's existing Origin/request check
- **THEN** the runtime refuses it before the owner changes anything, and the read-only page presents no enabled edit controls

#### Scenario: An uncertain action
- **WHEN** an edit's result is uncertain or the connection ends while its result is pending
- **THEN** the page reports uncertainty or pending evidence and uses the shared command lock and recovery behavior without automatically resending the action

### Requirement: Observed Nanoleaf power in the dashboard

The dashboard's existing Nanoleaf device card SHALL display the device record's observed power, keeping it separate from desired power and preserving unknown or stale evidence. An accepted power command or a transmitted write SHALL NOT by itself establish observed power.

#### Scenario: Simulated on and off observations
- **WHEN** the simulated Nanoleaf reports on and then off through the module's device record
- **THEN** the dashboard card shows the matching observed power after each observation and does not substitute a pending desired value
