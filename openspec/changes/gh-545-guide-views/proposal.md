## Why

Ask the guide composes temporary views from existing issue cards and sub-guides.
It needs a small, validated component catalog and view shape so that Jev can
choose presentation without inventing facts, and so the full guide stays the
default. [Hub #545](https://github.com/jimmie-potts/agent-device-hub/issues/545)
owns this definition. It consumes the approved `guide-records/1.0` records from
#543.

## What Changes

- Define `guide-views/1.0`: a component catalog, a versioned view schema and a
  field-ownership dictionary.
- Define stable component-instance IDs, supported kinds, groups, reason codes
  with evidence references, layouts, motion presets and tree bounds.
- Specify validation before rendering: compatibility, membership,
  duplicates, cycles, bounds and allowed links, with stable rejection codes.
- Specify the deterministic Full guide default, with its region inventory,
  default disclosure and browsing features, and a reduced-motion equivalent for
  every preset.
- Supply an offline reference, success and failure fixtures, a cross-interface
  journey and CI execution of the fixtures.

## Capabilities

### New Capabilities

- `guide-views`: Validated guide component catalog, composed views and the Full guide default.

### Modified Capabilities

None.

## Impact

The owning guide gains definition artifacts and tests under
`docs/work-guide/contracts/guide-views/`. No production renderer, endpoint,
state store or model integration consumes them in this delivery. The approved
guide-records bundle is unchanged. There is no device contract change, new
package, service or dependency. Human approval of the exact definition precedes
adoption.
