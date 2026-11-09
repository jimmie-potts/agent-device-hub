## Why

The Pixoo is the only Hub-mode participant with its own mode vocabulary. Work and Quiet both mapped to Monitor, Free to Media, and the Pixoo's mode also chose the content and paused the player on every change. On 2026-11-08 a Hub switch to Free left the Pixoo in Media, paused with nothing loaded, and the scheduled art appearance was refused as if the owner had paused it. [Issue #1574](https://github.com/jimmie-potts/agent-device-hub/issues/1574), decided in [ADR 0014](../../../docs/decisions/0014-pixoo-follows-the-hub-mode.md).

## What Changes

- The Pixoo advertises and takes Work, Free and Quiet as its native modes; the Monitor/Media mapping is removed from `HUB_MODE_TABLE`.
- A mode is policy only. The status dashboard rests on the display whenever the player holds no item; a started playlist or rendition holds it until stopped or cleared. No mode change pauses the player.
- Work admits status, the Now Playing pop-up, and moments or art allowed to cover status; it refuses playback starts and the whole Now Playing takeover, and selecting Work stops playback with no automatic resume.
- Quiet applies the owner's Quiet brightness and restores the remembered brightness on leaving; otherwise it admits what Free admits.
- Moments and art are admitted per base: attention or a stale source refuses over status, cover-status permission is required in Work only, a playing item pauses and resumes, a paused item refuses. The empty-pause rule is withdrawn.
- **BREAKING** for `pixoo-display`: a new minor 2.1 reports `mode` in the Hub's vocabulary, `base` and `moments.overStatus`; the module stops publishing 2.0. The runtime dashboard is the only reader and follows in #1575.
- **BREAKING** for `requireMode`: the Pixoo refuses a command carrying it with `invalid-request`; `pixoo-media-show` drops the member; routines carry an optional Hub-mode precondition checked by the core instead.
- Presentation setting version 1 keeps accepting a `mode` member and ignores it; the installed `runtime.json` needs no edit.

## Capabilities

### Modified Capabilities

- `bunny-pixoo-module`: configuration (Quiet brightness, ignored presentation mode), owned state (last Hub mode, remembered brightness), the two bases and Now Playing, commands and outcomes (Hub-mode values, Work refusal, `requireMode` refusal), device state (advertised modes, `pixoo-display/2.1`), dashboard pages, moment interludes and exact-art moments on the two bases, and a new Work set and Quiet brightness requirement.
- `bunny-message-profile`: the Hub-mode table maps the Pixoo one to one.
- `bunny-power-schedules`: the content-mode precondition becomes an optional Hub-mode precondition checked by the core; `requireMode` is no longer sent.
- `runtime-hub-mode`: the fan-out mapping is one to one for both participants.
- `bunny-runtime`: the art policy's "Empty Media remains eligible" scenario becomes "the status base remains eligible".
- `runtime-dashboard`: the dashboard reads the Pixoo's mode and base from the advertised Hub mode and `pixoo-display/2.1` and gates content controls by Work instead of Media; this reader adaptation ships with #1574 so main never pairs a module and a dashboard that disagree, while the visible redesign is #1575.

## Impact

Pixoo owns the writer, presentation and library; the core owns the Hub mode, routines and automation; event-contracts owns the shared table and schemas. Source verification uses the simulated Pixoo and synthetic records. Legacy 1.x surfaces are untouched. Installed and physical acceptance belong to #1576.
