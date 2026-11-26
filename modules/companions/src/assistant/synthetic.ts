// The labelled synthetic provider (Hub #499, #46): a deterministic script behind the same turn contract as a hosted
// provider, with no network call and no paid usage. It walks the question, read and approval paths so the catalog and
// browser journeys exercise the engine without a model account.
import {ASK_OWNER, DELEGATE_CODING, MODES, READ_FIXTURE, READ_LIFX, READ_SESSIONS, SET_LIFX_BRIGHTNESS, SET_LIFX_POWER, SET_MODE, READ_WEMO, SET_WEMO_POWER} from './tools.js';
import {catalogTool, isCatalogTool, SAVE_SHOW} from './catalog-tools.js';
import {catalogFamily, catalogRoute} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {textBytes, type ModelProvider, type TurnInput, type TurnReply} from './provider.js';

export const SYNTHETIC_QUESTION = 'Which detail should the synthetic result emphasize?';
const units = (text: string): number => Math.ceil(textBytes(text) / 4);
const call = (name: string, input: Record<string, unknown>, ordinal: number) => ({id: `synthetic-call-${String(ordinal)}`, name, input});

function catalogInput(text: string): {name: string; input: Record<string, unknown>} | undefined {
  const command = /^Run ([a-z0-9-]+) on ([a-z0-9-]+) with (\{[^\r\n]*\})$/iu.exec(text);
  if (command?.[2] !== undefined && command[3] !== undefined && catalogFamily(command[1])) {
    const route = catalogRoute(command[1]);
    return {name: catalogTool(command[1]), input: {owner: route.binding === 'device' ? 'auto' : route.owner, target: command[2], arguments: command[3]}};
  }
  const save = /^Save draft .+ \((show-[a-z0-9-]+)\) revision ([0-9]+) as (.+)$/iu.exec(text);
  if (save?.[1] !== undefined && save[3] !== undefined) {
    return {name: SAVE_SHOW, input: {draftId: save[1], revision: Number(save[2]), versionName: save[3]}};
  }
  const prefix = 'SYNTHETIC_CATALOG ';
  if (!text.startsWith(prefix)) return undefined;
  try {
    const candidate: unknown = JSON.parse(text.slice(prefix.length));
    if (typeof candidate !== 'object' || candidate === null || !('name' in candidate) || !('input' in candidate)) return undefined;
    const {name, input} = candidate;
    if (typeof name !== 'string' || !isCatalogTool(name) || typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
    return {name, input: Object.fromEntries(Object.entries(input))};
  } catch {return undefined;}
}

/**
 * Turn one requests a mode when the owner names one and the tool is allowed, otherwise asks the fixed question. After the
 * answer it reads the permitted read tool. After any tool result it composes a final text from the evidence it was given.
 */
export class SyntheticProvider implements ModelProvider {
  readonly name = 'synthetic' as const;
  readonly model = 'synthetic';
  turn(input: TurnInput): Promise<TurnReply> {
    const text = JSON.stringify(input.transcript);
    const ordinal = input.transcript.length;
    const wemoArgs = (device: string, on: boolean) => ({selection: 'references', targets: [device], on});
    const allows = (name: string): boolean => input.tools.some(tool => tool.name === name);
    const owner = input.transcript.find(item => item.role === 'owner');
    const tools = input.transcript.filter(item => item.role === 'tool');
    const last = tools.at(-1);
    let reply: TurnReply;
    const catalog = catalogInput(owner?.text ?? '');
    if (tools.length === 0 && catalog !== undefined && allows(catalog.name)) {
      return Promise.resolve({text: null, calls: [call(catalog.name, catalog.input, ordinal)], stop: 'tool', units: units(text)});
    }
    const light = /^SYNTHETIC_LIFX (status|power|brightness) (\S+)(?: (\S+))?$/.exec(owner?.text ?? '');
    const brightness = /^Set ([a-z0-9-]+) brightness to ([0-9]+)%$/iu.exec(owner?.text ?? '');
    if (tools.length === 0 && brightness?.[1] !== undefined && allows(SET_LIFX_BRIGHTNESS)) {
      return Promise.resolve({text: null, calls: [call(SET_LIFX_BRIGHTNESS, {device: brightness[1], percent: Number(brightness[2])}, ordinal)], stop: 'tool', units: units(text)});
    }
    const direct = /^(?:Please )?turn (on|off) (?:the )?([a-z0-9-]+)$/iu.exec(owner?.text ?? '');
    if (tools.length === 0 && direct?.[2] !== undefined) {
      const tool = allows(SET_LIFX_POWER) ? SET_LIFX_POWER : allows(SET_WEMO_POWER) ? SET_WEMO_POWER : undefined;
      if (tool !== undefined) return Promise.resolve({text: null, calls: [call(tool, tool === SET_WEMO_POWER ? wemoArgs(direct[2], direct[1]?.toLowerCase() === 'on') : {device: direct[2], on: direct[1]?.toLowerCase() === 'on'}, ordinal)], stop: 'tool', units: units(text)});
    }
    const plug = /^SYNTHETIC_WEMO (status|power) (\S+)(?: (on|off))?$/.exec(owner?.text ?? '');
    if (tools.length === 0 && plug !== null) {
      const [, action, device, value] = plug;
      const name = action === 'status' ? READ_WEMO : SET_WEMO_POWER;
      const args = action === 'status' || device === undefined ? {device} : wemoArgs(device, value === 'on');
      if (allows(name)) return Promise.resolve({text: null, calls: [call(name, args, ordinal)], stop: 'tool', units: units(text)});
    }
    if (tools.length === 0 && light !== null) {
      const [, action, device, value] = light;
      const name = action === 'status' ? READ_LIFX : action === 'power' ? SET_LIFX_POWER : SET_LIFX_BRIGHTNESS;
      const args = action === 'status' ? {device} : action === 'power' ? {device, on: value === 'on'} : {device, percent: Number(value)};
      if (allows(name)) return Promise.resolve({text: null, calls: [call(name, args, ordinal)], stop: 'tool', units: units(text)});
    }
    if (tools.length === 0) {
      const mode = MODES.find(value => new RegExp(`\\b${value}\\b`, 'i').test(owner?.text ?? ''));
      // "delegate" proposes a coding task for the allowlisted repository when the tool is allowed (Hub #502); the worker's word comes back as its result.
      const delegate = /\bdelegate\b/i.test(owner?.text ?? '') && allows(DELEGATE_CODING);
      reply = delegate ? {text: 'Synthetic proposal: delegate the brief to the coding worker.', calls: [call(DELEGATE_CODING, {repository: 'agent-device-hub', brief: (owner?.text ?? '').slice(0, 512)}, ordinal)], stop: 'tool', units: units(text)}
        : mode !== undefined && allows(SET_MODE) ? {text: `Synthetic request: set the Hub mode to ${mode}.`, calls: [call(SET_MODE, {mode}, ordinal)], stop: 'tool', units: units(text)}
        : {text: null, calls: [call(ASK_OWNER, {text: SYNTHETIC_QUESTION}, ordinal)], stop: 'tool', units: units(text)};
    } else if (last?.name === ASK_OWNER) {
      const read = allows(READ_SESSIONS) ? READ_SESSIONS : READ_FIXTURE;
      reply = {text: null, calls: [call(read, {}, ordinal)], stop: 'tool', units: units(text)};
    } else {
      const answer = tools.find(item => item.name === ASK_OWNER)?.result;
      // The module knows only what the dispatcher answered; whether the mode took effect is the core's outcome, reported separately.
      const evidence = last?.name === SET_MODE ? `${last.ok ? 'accepted by the core, outcome tracked separately' : 'not applied'}: ${last.result}`
        : last?.name === DELEGATE_CODING ? `coding worker: ${last.result}` : last?.result ?? '';
      reply = {text: `Synthetic result: ${answer === undefined ? '' : `${answer}\n`}${evidence}`, calls: [], stop: 'end', units: units(text)};
    }
    return Promise.resolve(reply);
  }
}
