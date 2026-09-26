## ADDED Requirements

### Requirement: Shared Nanoleaf device art
The dashboard SHALL draw each Nanoleaf component with a hub-owned shared device art component that renders the Lines as Prism crystal tubes between hexagonal connectors and the NL22 Panels as triangles in the same material, from the geometry the hub's read-only geometry route supplies and the presentation the component's inputs supply: mode, per-element colors, pending edits, activity, status and labels. The component SHALL issue no request and open no device state; it SHALL keep its own animation clock and selection state, and its Work flow SHALL derive from its activity input only, never from device frames. Reduced motion SHALL stop the flow and the opening assembly while Work, Quiet and Free remain distinguishable. Labels SHALL use element numbers and the controller's neutral identifiers. A device whose geometry is unavailable SHALL be drawn as a schematic strip that says so; a stale or unavailable snapshot SHALL keep the last art marked stale, never an empty device. The dashboard SHALL read the geometry once per component after its first snapshot and again only after a failed read. Maps to Hub #355's acceptance.

#### Scenario: Lines drawn from geometry with project colors
- **WHEN** a Nanoleaf Lines component has a saved layout and its snapshot reserves elements for projects in the project layout style
- **THEN** the component page draws every Line as a crystal tube joined at its connectors, with each reserved element's signature zone in its project color and every element reachable by keyboard with a label naming its number and reservation

#### Scenario: Panels drawn as triangles
- **WHEN** a Nanoleaf Panels component has a saved layout of triangles
- **THEN** the component page draws one triangle per element in the same material, each reachable by keyboard with its number

#### Scenario: Schematic fallback without geometry
- **WHEN** the owner reports no saved layout or predates the geometry route
- **THEN** the component page draws one cell per snapshot element in a strip, says that the physical layout is unavailable, and sends nothing

#### Scenario: Stale snapshot keeps the art
- **WHEN** the controller stops answering after the art was drawn
- **THEN** the art stays visible with a stale marking instead of an empty device

#### Scenario: Status marks and Work flow from inputs
- **WHEN** the component receives per-element status and activity inputs in Work
- **THEN** it colors those elements by status, names the status in their labels and runs the two-second flow on active elements, and stops the flow under reduced motion while the modes stay distinct

#### Scenario: Reads only
- **WHEN** the operator opens, inspects and selects elements in the art
- **THEN** the controllers see only snapshot, integration and geometry reads and no command
