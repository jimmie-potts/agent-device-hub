## MODIFIED Requirements

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret or with an unsupported provider. The `bunny` profile alone SHALL use the configured provider; other profiles SHALL keep the synthetic provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context: the task profile's curated persona and the owner's currently active explicit preferences, read from the module's own records at each model call and rendered as owner data that grants no tool, permission or device authority. No knowledge entry, conversation history, other task, inactive or historical preference or private context document SHALL enter the prompt. When the rendered prompt context exceeds 16 KiB the model call SHALL be refused before dispatch with a capacity outcome whose transcript message names the cause; nothing SHALL be truncated silently. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Public state SHALL carry the provider, model and allowed tool names.

#### Scenario: Synthetic default
- **WHEN** the module starts with an empty companions section or with one that names no provider
- **THEN** public state shows the synthetic provider, no outbound request is made, and a task completes through the same question, tool and approval path

#### Scenario: Configured hosted provider
- **WHEN** the section names the Anthropic provider, its model and its key secret
- **THEN** a `bunny` task sends one request per model call to the Messages API with that model, the fixed instructions, the prompt context, the transcript and the permitted tools; usage tokens are recorded on the call; and the key appears in no record, state, log or page

#### Scenario: Persona and active preferences enter the prompt
- **WHEN** the owner has active and inactive explicit preferences and starts a `bunny` task, then edits a preference and stops using another before the next model call
- **THEN** the first call's prompt carries the `bunny` persona and only the then-active preferences by title and text, the next call reflects the edit and omits the stopped entry, no knowledge entry or earlier conversation appears, and the prompt text reaches no public state, outcome, log or span

#### Scenario: Prompt context over its bound
- **WHEN** the owner's active preferences render larger than 16 KiB
- **THEN** the model call is refused before dispatch, the task ends with the capacity code and a transcript message naming the preference bound, and no request is sent

#### Scenario: Provider failure
- **WHEN** the provider answers with a refusal, an authentication or rate-limit error, is unreachable or exceeds its deadline
- **THEN** the task ends failed or unavailable with the registry code, or uncertain after a lost answer, no second model is tried, and the dashboard's mode controls keep working
