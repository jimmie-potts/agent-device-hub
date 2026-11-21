## ADDED Requirements

### Requirement: Group cards on the unit grid

When a lighting save groups cards on Home, the core SHALL, in the same transaction, replace the members' Home cards (a light's light card, a plug's device card) with one group card at the first member's place in the Wide shape, hidden only when every member was hidden. When a group is removed, its card SHALL become each member's own card at that place in the Small square shape. A group that holds a plug SHALL offer only the Wide shape. In the built-in layout a plug in a Home group SHALL show only in its group's card. A refused or failed lighting save SHALL change neither record.

#### Scenario: Group and ungroup a light with a plug
- **WHEN** the operator groups a light and a plug on Home and later ungroups them
- **THEN** one Wide group card takes the light's place, and ungrouping puts the light and the plug back there as Small squares
