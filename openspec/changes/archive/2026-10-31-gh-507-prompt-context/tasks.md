## 1. Turn contract and provider rendering

- [x] 1.1 Add the structured prompt context to the turn contract and render it in the Anthropic adapter's system prompt after the fixed instructions, with the owner-data framing sentence; verify with fake-transport tests that the system string carries the persona name and character, each active preference's title and text in order, the framing sentence, and that a preference phrased as an instruction changes no tool definition and no error message carries preference text.

## 2. Engine and module wiring

- [x] 2.1 Add the `preferences` seam to the engine options, read it at each model call with the task profile's persona, and pass the context to the provider; verify with module tests that a scripted provider receives the `bunny` persona and only active preferences, that an edit and a Stop using between two calls change the next call's context, and that knowledge entries and earlier conversation text are absent.
- [x] 2.2 Add `LIMITS.contextBytes` and refuse an over-bound context before reserving usage or dispatching, with a transcript message naming the bound and the `capacity` code; verify with a module test that no provider call is made and the task ends failed with that message, and with the existing diagnostics assertions that no preference text reaches state, outcomes, logs or spans.
- [x] 2.3 Construct the preference engine before the assistant engine in the module and supply the store's active entries through the seam; verify by the module tests above running through `createCompanionsModule` and by the existing companions, knowledge and preference suites passing unchanged.

## 3. Specifications and guides

- [x] 3.1 Update the companions README (conversation prompt contents, preferences automatic-insertion sentence, knowledge context note) and docs/architecture.md's preference paragraph; verify by instruction readback against the implemented behavior and bound.
- [x] 3.2 Run root build, typecheck, lint and the companions suite, then synchronize the three delta specs into the main specs and archive this change on the delivery branch before final review; verify each command exits zero and `openspec validate` passes before archive.
