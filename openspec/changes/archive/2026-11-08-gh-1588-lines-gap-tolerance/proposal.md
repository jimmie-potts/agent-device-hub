## Why

The first installed #725 trial started a live Music session on the Lines with real Music.app capture. It ended `source-lost` 4.6 seconds after the first frame ([#1588](https://github.com/jimmie-potts/agent-device-hub/issues/1588)). One 100 ms capture window was missed, and the next window carried the producer's discontinuity marker. The module's Music input and renderer both treat any later discontinuity as permanent retirement, so the session ended while capture stayed active and fresh. Real capture misses a window every few seconds, so no live session can last.

The owner decided on 2026-11-09 that, for live Lines sessions, source loss means no fresh feature within the 400 ms validity period, not one missed window. This refines the #40 first-trial policy and changes nothing else in it.

## What Changes

- **Music input:** a later discontinuity whose window starts after the previous accepted window no longer retires the input. Expiry, reversed source time, clock invalidity, overflow and explicit retirement still do.
- **Renderer:** a forward discontinuity no longer retires the renderer. The effect continues across the gap with the elapsed source time, exactly as for an ordinary sequence gap. Reversed source time still retires it.
- **Session:** a live Lines session keeps playing across a missed window and ends `source-lost` only once the input expires or is retired.

## Capabilities

### Modified Capabilities
- `nanoleaf-module`: Music input retirement and source-loss ending for live sessions.

## Impact

Only `modules/nanoleaf` changes (`music-input.ts`, `music-effects.ts`), with its tests and README. The capture contract, core session owner, dashboard and other modules are unchanged. There is no installation, capture or device command; #725 repeats the installed trial after a qualified install.

**No design.md.** The change removes one condition from each of two retirement checks. It adds no concurrency, storage, migration, timing or privacy behavior, and no new interface: the session loop, write pacing, interruption order and restoration are unchanged. The owner's policy decision and its reason are recorded above.
