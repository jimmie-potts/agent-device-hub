// The labelled synthetic provider (Hub #499, #46): a deterministic script behind the same turn contract as a hosted
// provider, with no network call and no paid usage. It walks the question, read and approval paths so the catalog and
// browser journeys exercise the engine without a model account.
import {ASK_OWNER, MODES, READ_FIXTURE, READ_SESSIONS, SET_MODE} from './tools.js';
import {textBytes, type ModelProvider, type TurnInput, type TurnReply} from './provider.js';

export const SYNTHETIC_QUESTION = 'Which detail should the synthetic result emphasize?';
const units = (text: string): number => Math.ceil(textBytes(text) / 4);
const call = (name: string, input: Record<string, unknown>, ordinal: number) => ({id: `synthetic-call-${String(ordinal)}`, name, input});

/**
 * Turn one proposes a mode when the owner names one and the tool is allowed, otherwise asks the fixed question. After the
 * answer it reads the permitted read tool. After any tool result it composes a final text from the evidence it was given.
 */
export class SyntheticProvider implements ModelProvider {
  readonly name = 'synthetic' as const;
  readonly model = 'synthetic';
  turn(input: TurnInput): Promise<TurnReply> {
    const text = JSON.stringify(input.transcript);
    const ordinal = input.transcript.length;
    const allows = (name: string): boolean => input.tools.some(tool => tool.name === name);
    const owner = input.transcript.find(item => item.role === 'owner');
    const tools = input.transcript.filter(item => item.role === 'tool');
    const last = tools.at(-1);
    let reply: TurnReply;
    if (tools.length === 0) {
      const mode = MODES.find(value => new RegExp(`\\b${value}\\b`, 'i').test(owner?.text ?? ''));
      reply = mode !== undefined && allows(SET_MODE) ? {text: `Synthetic proposal: set the Hub mode to ${mode}.`, calls: [call(SET_MODE, {mode}, ordinal)], stop: 'tool', units: units(text)}
        : {text: null, calls: [call(ASK_OWNER, {text: SYNTHETIC_QUESTION}, ordinal)], stop: 'tool', units: units(text)};
    } else if (last?.name === ASK_OWNER) {
      const read = allows(READ_SESSIONS) ? READ_SESSIONS : READ_FIXTURE;
      reply = {text: null, calls: [call(read, {}, ordinal)], stop: 'tool', units: units(text)};
    } else {
      const answer = tools.find(item => item.name === ASK_OWNER)?.result;
      const evidence = last?.name === SET_MODE ? `${last.ok ? 'applied' : 'not applied'}: ${last.result}` : last?.result ?? '';
      reply = {text: `Synthetic result: ${answer === undefined ? '' : `${answer}\n`}${evidence}`, calls: [], stop: 'end', units: units(text)};
    }
    return Promise.resolve(reply);
  }
}
