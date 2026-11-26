## ADDED Requirements

### Requirement: Owner-local scene identity lookup

The Nanoleaf module SHALL accept a Runtime-local `scene-id-by-name` content request with the selected device ID and a bounded scene name. It SHALL compare the name with the selected light's saved scene list and return only the opaque scene ID for a unique match. It SHALL refuse missing or ambiguous matches. The read SHALL send no device request, write no owner state, and publish no scene name.

#### Scenario: Resolve one identified light's saved scene

- **WHEN** the Runtime asks for a scene by name on one configured light
- **THEN** the module returns the unique scene ID it already associates with that light and name, or a refusal
