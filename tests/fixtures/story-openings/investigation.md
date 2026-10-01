## Find a usable button for desk presets

- Compare the chosen button's available press events.
- Check whether a held button can be counted as one press.
- Identify what keeps normal mouse controls working.
- Report which options fit the existing Hub.
- Leave the button choice and installation pending until the findings are reviewed.

## Outcome and real setup

Give one operator findings about the chosen desktop button's suitability for
requesting desk presets. The supported event source and final button choice are
unresolved. This local investigation sample promises a decision aid, not a
working shortcut, an installed listener or device behavior.

## Smallest useful implementation

Read available event-interface documentation and compare bounded local fixture
traces for press, hold and release. Document normal mouse-control behavior,
existing Hub integration options and any missing evidence. Required issues: none
for this sample; no product implementation is included.

## Behavior and protections to preserve

Do not rebind live buttons, install a listener or send preset/device commands.
Keep normal mouse controls and the Hub's existing device writers unchanged.

## Observable acceptance and planned evidence

Delivery target: source-only

Provide an evidence table covering event availability, one-press handling and
normal controls, plus a recommendation or explicit insufficient-evidence result.
Record unsupported or untested options as unknown. Button selection and any
installation remain pending the owner's review of the findings.

## Meaningful deferrals

Live button testing, implementation and desk-preset requests need separately
authorized follow-up work. Continue using existing controls in the meantime.

## Guide

**Topic:** desktop-controls
**Note:** Local investigation sample; the implementation choice remains open.
