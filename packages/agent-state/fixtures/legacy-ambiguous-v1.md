# Pre-change ambiguity fixture

`legacy-ambiguous-v1.json` is synthetic state exported by the unchanged reducer
at Hub revision `25590e9c95ce334a516d2de0494584d67ea15a26`, before the #137 fix.
SHA-256: `9b4b4947cbca54c58a35bb002a499ea0a49909db976b1c237606f49f6da60b16`.
It contains no installed state or private metadata. Do not regenerate it with
the new reducer to make a recovery test pass.

The first Desktop session receives an unordered start for `turn-one`, a
correlated approval, its stop, a start for `turn-two`, and an unknown-turn stop.
Its chosen label is `Chosen task`. A separate session receives its own start
and stop. The old export contains ambiguous current activity/turn, retained
known/unknown-turn notices, and independent attention. The consumers are Pixoo
with new-turn clearing and Nanoleaf without it for this core-policy fixture.
Actual Nanoleaf integration uses its existing required clearing policy.

`current-status.test.mjs` checks the bytes before importing, then verifies a
new start recovers the first session while preserving the second, labels,
attention and unknown-turn notices. It validates the resulting snapshot through
both language consumers and reopens the same store after shutdown.
