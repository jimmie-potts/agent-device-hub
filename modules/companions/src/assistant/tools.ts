// The tools a turn may call (Hub #46): the built-in owner question, the two first permitted tools and the synthetic
// read fixture. The private section's allowlist selects the permitted ones; the engine checks membership again when a
// call executes, so a changed section cannot widen an effect.
import {ASSISTANT_LIGHT_OWNER, ASSISTANT_WEMO_OWNER, type AssistantDeviceOwner} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import {catalogTools, isCatalogTool} from './catalog-tools.js';
import {textBytes, TOOL_NAME, type ToolDefinition} from './provider.js';

export const ASK_OWNER = 'ask_owner';
export const READ_SESSIONS = 'read_sessions';
export const SET_MODE = 'set_mode';
export const READ_FIXTURE = 'read_fixture';
export const DELEGATE_CODING = 'delegate_coding';
export const READ_LIFX = 'read_lifx';
export const SET_LIFX_POWER = 'set_lifx_power';
export const SET_LIFX_BRIGHTNESS = 'set_lifx_brightness';
export const READ_WEMO = 'read_wemo';
export const SET_WEMO_POWER = 'set_wemo_power';
export function deviceToolOwner(name: string): AssistantDeviceOwner | undefined {
  switch (name) {
    case READ_LIFX: case SET_LIFX_POWER: case SET_LIFX_BRIGHTNESS: return ASSISTANT_LIGHT_OWNER;
    case READ_WEMO: case SET_WEMO_POWER: return ASSISTANT_WEMO_OWNER;
    default: return undefined;
  }
}
const plugName = {type: 'string' as const, description: 'The Wemo plug name from the owner or an exact plug ID from read_wemo.'};
const deviceName = {type: 'string' as const, description: 'The light name from the owner or an exact device ID from read_lifx.'};
/** A repository name the worker's private allowlist may carry, and the brief's bound; both are checked again by the contract. */
export const REPOSITORY = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;
export const BRIEF_BYTES = 4096;
export const MODES = ['work', 'free', 'quiet'] as const;
/** The largest read result a tool returns to the model, well under the 8 KiB call result bound. */
export const READ_BYTES = 4096;
const MAX_SESSIONS = 16;

export const TOOLS: readonly ToolDefinition[] = [
  {name: ASK_OWNER, effect: 'question', description: 'Ask the owner one short clarifying question and wait for the answer. Use it only when the request cannot be answered or acted on without it.',
    input: {type: 'object', properties: {text: {type: 'string', description: 'The question, one or two sentences.'}}, required: ['text'], additionalProperties: false}},
  {name: READ_SESSIONS, effect: 'read', description: 'Read what the coding agents are doing: each known session with its provider, label, shared status, work confirmation and attention. Reads need no approval.',
    input: {type: 'object', properties: {}, required: [], additionalProperties: false}},
  {name: SET_MODE, effect: 'command', description: 'Propose setting the Hub mode to work, free or quiet. The owner must approve the proposal before it is applied; report the result the tool returns, never assume it was applied.',
    input: {type: 'object', properties: {mode: {type: 'string', description: 'The requested Hub mode.', enum: MODES}}, required: ['mode'], additionalProperties: false}},
  {name: READ_LIFX, effect: 'read', description: 'Read LIFX observed status and available controls. Use an empty device name to list lights.',
    input: {type: 'object', properties: {device: deviceName}, required: ['device'], additionalProperties: false}},
  {name: SET_LIFX_POWER, effect: 'command', description: 'Propose switching a LIFX light on or off. Requires owner approval.',
    input: {type: 'object', properties: {device: deviceName, on: {type: 'boolean', description: 'True to turn on, false to turn off.'}}, required: ['device', 'on'], additionalProperties: false}},
  {name: SET_LIFX_BRIGHTNESS, effect: 'command', description: 'Propose setting a LIFX light to a specific brightness from 0 to 100 percent. Requires owner approval.',
    input: {type: 'object', properties: {device: deviceName, percent: {type: 'integer', description: 'Brightness as a whole percentage from 0 to 100.'}}, required: ['device', 'percent'], additionalProperties: false}},
  {name: READ_WEMO, effect: 'read', description: 'Read Wemo plug power observations and availability. Use an empty device name to list plugs.',
    input: {type: 'object', properties: {device: plugName}, required: ['device'], additionalProperties: false}},
  {name: SET_WEMO_POWER, effect: 'command', description: 'Propose switching one Wemo plug on or off. Requires owner approval and respects the plug hold and maximum-on policy.',
    input: {type: 'object', properties: {device: plugName, on: {type: 'boolean', description: 'True to turn on, false to turn off.'}}, required: ['device', 'on'], additionalProperties: false}},
  ...catalogTools,
  {name: READ_FIXTURE, effect: 'read', description: 'Read the immutable synthetic fixture. Only the synthetic provider sees this tool.',
    input: {type: 'object', properties: {}, required: [], additionalProperties: false}},
  {name: DELEGATE_CODING, effect: 'command', description: 'Propose handing one bounded coding task to the coding worker on the owner\'s computer: name an allowlisted repository and write a brief. The owner must approve the proposal; the worker then runs in a fresh worktree and its structured result arrives as this tool\'s result later. Never claim work was done before that result.',
    input: {type: 'object', properties: {repository: {type: 'string', description: 'The repository name from the worker\'s allowlist, such as agent-device-hub.'},
      brief: {type: 'string', description: 'What to change and how to verify it, in a few sentences.'}}, required: ['repository', 'brief'], additionalProperties: false}},
];
/** The permitted tool definitions for one turn: the built-in question plus the allowlisted names, in catalog order. */
export function permittedTools(allowed: readonly string[], synthetic: boolean, devices = true): ToolDefinition[] {
  return TOOLS.filter(tool => tool.name === ASK_OWNER || (tool.name === READ_FIXTURE ? synthetic : allowed.includes(tool.name) && (devices || deviceToolOwner(tool.name) === undefined && !isCatalogTool(tool.name))));
}
/** Whether `name` is a tool name the private section may list: a permitted tool other than the built-in question and the synthetic fixture. */
export const allowlistable = (name: unknown): name is string => typeof name === 'string' && TOOL_NAME.test(name) && TOOLS.some(tool => tool.name === name && tool.name !== ASK_OWNER && tool.name !== READ_FIXTURE);
export const definition = (name: string): ToolDefinition | undefined => TOOLS.find(tool => tool.name === name);

/** What the module's synced copy of the core holds when a read runs: each session as the shared read function reads it. */
export type CoreCopy = {readonly sessions: readonly SessionView[]; readonly mode: ModeState | undefined; readonly synced: boolean};
export const FIXTURE_TEXT = 'Read-only fixture: blue is the selected synthetic sample.';

const label = (record: SessionView): string => record.label?.value ?? record.title?.value ?? `${record.identity.provider} ${record.identity.client} session ${record.id.slice(0, 8)}`;
const age = (record: SessionView, now: number): string => {
  const seconds = Math.max(0, Math.round((now - record.lastEvidenceAtMs) / 1000));
  return seconds < 60 ? `${String(seconds)} s ago` : seconds < 3600 ? `${String(Math.round(seconds / 60))} min ago` : `${String(Math.round(seconds / 3600))} h ago`;
};
/**
 * The coding sessions as bounded text for the model: display metadata the lifecycle policy already shares, never a
 * prompt, a transcript or a path. Each session reports the hub's shared status class and detail, its work state and
 * confirmation, and its attention (Hub #1865). An unsynced copy says so instead of pretending the list is current.
 */
export function summarizeSessions(copy: CoreCopy, now: number): string {
  if (!copy.synced) return 'The session list is not synced with the core right now; what the agents are doing is unknown.';
  const records = [...copy.sessions].sort((a, b) => b.lastEvidenceAtMs - a.lastEvidenceAtMs);
  if (records.length === 0) return 'No coding agent session is known to the core right now.';
  const lines = records.slice(0, MAX_SESSIONS).map(record => {
    const attention = record.attention.items.map(item => item.kind);
    const status = `${record.status.class} (${record.status.detail}); work ${record.work.state}, ${record.work.confidence}`;
    const waiting = attention.length === 0 ? '' : `; waiting for ${attention.join(', ')}`;
    return `- ${label(record)} (${record.identity.provider}, ${record.identity.client}): ${status}${waiting}; last evidence ${age(record, now)}`;
  });
  if (records.length > MAX_SESSIONS) lines.push(`- ${String(records.length - MAX_SESSIONS)} more session(s) not listed`);
  let text = `${String(records.length)} coding agent session(s):\n${lines.join('\n')}`;
  while (textBytes(text) > READ_BYTES && lines.length > 1) {lines.pop(); text = `${String(records.length)} coding agent session(s), list truncated:\n${lines.join('\n')}`;}
  return text;
}
