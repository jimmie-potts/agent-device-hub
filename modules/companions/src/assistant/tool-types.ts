// The tool definition types (Hub #46), apart from the provider contract so the page's tool scope (Hub #2026) can reach
// the catalog's names without the provider's runtime code.

/** A closed JSON schema for a tool's input, as the Messages API's `input_schema` with `strict` takes it. */
type ToolProperty = {type: 'string'; description: string; enum?: readonly string[]}
  | {type: 'boolean' | 'integer'; description: string}
  | {type: 'array'; items: {type: 'string'} | ToolInputSchema; description: string};
export type ToolInputSchema = {type: 'object'; properties: Readonly<Record<string, ToolProperty>>;
  required: readonly string[]; additionalProperties: false};
/** What a tool does when the model calls it: a question, a read, a private draft edit, or an approved command. */
export type ToolEffect = 'question' | 'read' | 'draft' | 'command';
export type ToolDefinition = {readonly name: string; readonly description: string; readonly input: ToolInputSchema; readonly effect: ToolEffect};
