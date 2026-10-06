## Why

PROMPTI (the owner's name for the CHOMPI agent controller) leaves its volume knob and its ten second-row black keys (controls 16-25) without an action. On 2026-10-06 the owner chose the first slice of [#744](https://github.com/jimmie-potts/agent-device-hub/issues/744): the volume knob controls the computer's volume and its click mutes, and one black key jumps to whichever task waits for the owner, across task pages, without acknowledging it. The profile gains an optional black-key map that later #744 slices plug into. Owning issue: [#865](https://github.com/jimmie-potts/agent-device-hub/issues/865).

## What Changes

- **Profile (`schemaVersion` stays 1):**
  - An optional `keys` map from black-key controls 16-25 to `attention` or `back`. Absent, it is `{"16": "attention"}`, from one constant in code, so the installed owner profile gets the Attention key without edits. A control already mapped elsewhere is rejected; an earlier profile that already maps control 16 keeps it, and the default stands aside.
  - An optional `volume` section: `stepCounts` (encoder counts per volume key, default 1) and `invert`. The volume knob's turn (46) and click (34) are reserved when the section is present; an earlier profile without it that maps them keeps its mapping, with the volume knob off.
  - An optional `timing.attentionRepeatMs` (default 4000 ms).
- **Attention key:**
  - It opens the assigned task the bridge first saw waiting (question, input or approval), through the slot key's open and verify path, and shows that task's page. Hub attention carries no time, so the order lives in bridge memory and restarts with the bridge.
  - A press within the repeat window moves on to the next waiting task. With nothing waiting, or a feed that is not current, it refuses with a red flash on its key.
  - It acknowledges nothing and changes no Hub state. Its light shows the attention color while any task waits, and is off otherwise.
- **Back key:** a black key mapped to `back` does what Loop does.
- **Volume knob:** each detent sends one Windows volume-up or volume-down key, and the click toggles mute. The keys target no window and type nothing into a client; Windows handles them as a system app command, which the installed check confirms against Codex and Claude. While Record holds the dictation chord the knob is ignored, with a red flash on its LED, so a volume key never joins the chord.
- **OS adapter:** interface version 4 adds `sendVolumeKey` for `VK_VOLUME_UP`, `VK_VOLUME_DOWN` and `VK_VOLUME_MUTE`. It is refused while the adapter holds any key. The simulated desktop implements it with a synthetic system volume. The native check covers the keys through the guarded `SendInput`, with zero attempts.
- **Verification harness (#853):** the `attention-key` and `volume-knob` catalog scenarios for both tiers, light roles for the Attention key and the volume knob, and volume key presses and the synthetic system volume on the control page.
- **Docs:** the bridge README, the verification README, the qualification report (control map and installed checks for #745) and the development guide.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: the profile's `keys`, `volume` and repeat window, the Attention key and volume knob lights, release on loss for pending volume keys, and new requirements for the Attention key and the volume knob.
- `chompi-bridge`: OS adapter contract version 4 with the system volume keys, and the simulated desktop at version 4.
- `chompi-bridge-verification`: the control page's volume log and light roles, and the two new catalog scenarios.

## Impact

This changes the bridge package only. The profile stays at `schemaVersion` 1, and the slot file is unchanged. An earlier bridge rejects the new optional profile fields as unknown, so a rollback removes them (README). The OS adapter version is internal to one installation: the bridge and its adapters ship together. Delivery is source-only; #745 owns the installation and the physical checks.
