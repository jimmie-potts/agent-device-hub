## ADDED Requirements

### Requirement: Retain local artwork only after save

Art SHALL bound the bytes, decoded pixels and frames of a local upload and supply private browser and device renditions. Art SHALL keep display-only uploads temporary and save at most one durable item for an upload when the owner chooses Save.

#### Scenario: Save an animation for later

- **WHEN** the owner saves a valid animated upload without choosing a display
- **THEN** the library contains one durable item with its animation preserved and the save issues zero display commands

#### Scenario: Display temporary artwork

- **WHEN** the owner confirms display only
- **THEN** the selected display uses the temporary media reference and the Art library gains no item
