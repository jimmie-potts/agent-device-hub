## MODIFIED Requirements

### Requirement: Declared pages inside the shell
The dashboard SHALL show navigation only for pages declared by current module metadata and open them inside the existing shell. The destination SHALL be the exact same-origin module page path, with no installed service or private-file fallback. Integrated component pages SHALL render only when both the built frontend contribution and the admitted module catalog declare the same module/page. The shared shell SHALL supply navigation, common UI/style, connection handling and authenticated API facilities. Feature frontend source SHALL remain owned by its module. Trusted bundled editors SHALL use the validated trusted presentation and asset policy; passive HTML SHALL retain its restrictive frame policy.

#### Scenario: Bookmark and keyboard navigation
- **WHEN** a person opens a declared module hash bookmark or activates its navigation link with the keyboard
- **THEN** the existing browser sign-in succeeds and the declared page appears inside the shell, without sending a device command

#### Scenario: Undeclared or external page
- **WHEN** a hash names an undeclared page or metadata contains an external or malformed path
- **THEN** the dashboard opens no such destination and offers no navigation to it

#### Scenario: Declared frontend absent or unavailable
- **WHEN** a module is unavailable or its declared component has no matching built contribution
- **THEN** the shell shows unavailable without importing an arbitrary URL or sending a command

#### Scenario: Opening and editing a feature page
- **WHEN** a person opens a feature page and edits a local draft before explicitly saving
- **THEN** opening and drafting change no device, media or scene; an authorized save sends one tracked command and distinguishes acceptance from its completed or uncertain outcome
