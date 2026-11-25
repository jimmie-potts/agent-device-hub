## Context

The worker owns private checkout paths, executable paths, login profiles and its current writer. The Hub owns private job and attempt discovery grants. Existing terminal results survive client handoff.

## Goals

- Request a named action for the owner-visible latest terminal attempt and send it once to its selected worker.
- Continue its native UUID on the original host and checkout. Keep the native launch plan on that host.
- Distinguish a handed-off writer, its release, and a launcher acknowledgement.

## Decisions

The coding worker advertises capabilities after it has verified an eligible isolated successor or positive release of the original checkout, and has a usable saved UUID. Jobs uses the existing authenticated staged input path. Before sending, the module checks the owner’s current job grant and validates the selection and capability again. The worker reserves the attempt before checking the current checkout, client profile and subscription. It refuses a competing native client or automated continuation while write authority is reserved.

The terminal helper waits over an owner-only Unix socket. The worker sends exact arguments and a filtered environment to that one local foreground process. The helper reports exit. Processes can leave the foreground group, so exit does not release writer authority. Loss after dispatch leaves ownership uncertain. Claude Desktop takes the same saved UUID through the documented launcher. An exact launcher receipt transfers write authority to Desktop. Returning from Desktop needs independent release evidence, so this path is one-way.

A qualified Codex 0.163.0 partial attempt can resume its exact thread in the #2112 independent successor. A reverse host boundary probe and no-turn native preflight confirm the successor and the restricted subscription profile. Claude terminal and Desktop remain unavailable in production until the original checkout has positive release evidence.

Claude background mode supplies a short attach identity, but cannot run with the print mode that supplies this worker's stdin prompt, authenticated event stream, structured result and turn and spending caps. Codex worker app-server is a private process and Codex Desktop cannot yet confirm the worker profile's exact target thread. Installed qualification remains with [Hub #2115](https://github.com/jimmie-potts/agent-device-hub/issues/2115).
