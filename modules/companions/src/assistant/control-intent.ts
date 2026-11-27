import {isDeepStrictEqual} from 'node:util';
import type {ObservationBasis} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {Proposal} from './history-contract.js';

export type SceneReceipt = {readonly requestId: string; readonly revision: number; readonly sceneId: string};

export type BoundControl = {
  readonly requestId: string;
  readonly ownerMessageIds: readonly string[];
  readonly proposal: Exclude<Proposal, {family: 'coding-dispatch'}>;
  readonly additional?: readonly Exclude<Proposal, {family: 'coding-dispatch'}>[];
  readonly text: string;
  readonly call: string;
  readonly draftRevision?: number;
  readonly observationBasis?: ObservationBasis;
  readonly sceneReceipt?: SceneReceipt;
  readonly modelCallId?: string;
  readonly contextTargets?: readonly string[];
};

export const normalizedControlText = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const containsControlValue = (input: string, value: string): boolean =>
  normalizedControlText(value) !== '' && ` ${normalizedControlText(input)} `.includes(` ${normalizedControlText(value)} `);

function explicitWords(text: string): string | undefined {
  const addressed = normalizedControlText(text).replace(/^(?:hey )?(?:b u n n y|bunny|reachy|microduck) /u, '');
  const request = /^(?:(?:please|could you|would you|can you|will you) )+/u;
  if (text.trimEnd().endsWith('?') && !request.test(addressed)) return undefined;
  const words = addressed.replace(request, '');
  if (/\b(?:if|hypothetically|example|suggest|whether|should|not|never|don t|instead of|would happen|tomorrow|later|after|when|unless|before|either|or|minus|negative|except|without|other than|avoid)\b/u.test(words)
    || /["“”`]|(?:^|\s)[-−]\d/u.test(text)) return undefined;
  return words;
}

export function missingMode(text: string): boolean {
  const words = explicitWords(text);
  return words !== undefined && /^(?:set|change|switch) (?:the )?(?:hub )?mode(?: to)?$/u.test(words);
}

export function authorizesHubMode(instruction: string, mode: string): boolean {
  const words = explicitWords(instruction);
  if (words === undefined) return false;
  const requested = /^(?:set|change|switch|enter|put) (?:(?:the )?hub )?(?:mode )?(?:to |in |into )?(work|free|quiet)(?: mode)?(?: now| please)?$/u
    .exec(words);
  return requested?.[1] === mode;
}

export function hubModeChoice(answer: string): string | undefined {
  if (!/^[a-z,.!\s]+$/iu.test(answer)) return undefined;
  return /^(?:please )?(work|free|quiet)(?: mode)?(?: please)?$/u.exec(normalizedControlText(answer))?.[1];
}

function requestedPower(input: string): {on: boolean; subject: string} | undefined {
  const prefix = /^(?:turn|switch|power|shut) (on|off) (?:(?:the|my) )?(.+?)(?: now| please)?$/u.exec(input);
  const suffix = /^(?:turn|switch|power|shut) (?:(?:the|my) )?(.+?) (on|off)(?: now| please)?$/u.exec(input);
  if (prefix?.[2] !== undefined) return {on: prefix[1] === 'on', subject: prefix[2]};
  if (suffix?.[1] !== undefined) return {on: suffix[2] === 'on', subject: suffix[1]};
  return undefined;
}

export function powerSubject(text: string): string | undefined {
  const words = explicitWords(text);
  return words === undefined ? undefined : requestedPower(words)?.subject;
}

const brightnessAfterTarget = /^(?:set|change) (.+?) brightness (?:to|at) (\d+)(?: percent)?(?: now| please)?$/u;
const brightnessBeforeTarget = /^(?:set|change) (?:the )?brightness (?:of|on|for) (.+?) (?:to|at) (\d+)(?: percent)?(?: now| please)?$/u;
const brightnessWithDetail = /^(?:set|change) (.+?) brightness (?:to )?(\d+)(?: percent)?$/u;

// A tool's explicit ID selects by ID only. An empty or malformed suffix cannot match a configured ID.
export function literalToolDeviceId(target: unknown): string | undefined {
  if (typeof target !== 'string') return undefined;
  const value = target.trim();
  return value.startsWith('id:') ? value.slice(3) : undefined;
}

export const literalDeviceId = (value: string): string | undefined => /^id:([a-z0-9-]{1,128})$/u.exec(value.trim())?.[1];

/** Keep an explicit ID only when it accounts for the entire subject of the recognized instruction or read. */
export function literalDeviceSubject(text: string, subject: string): string {
  const tokens = text.matchAll(/(?:^|\s)(id:[a-z0-9-]{1,128})(?=\s|[?!.;,]?$)/gu);
  return [...tokens].find(item => normalizedControlText(item[1] ?? '') === subject)?.[1] ?? subject;
}

export function brightnessSubject(text: string): string | undefined {
  const words = explicitWords(text);
  if (words === undefined) return undefined;
  const match = brightnessAfterTarget.exec(words) ?? brightnessBeforeTarget.exec(words) ?? brightnessWithDetail.exec(words);
  if (match?.[1] === undefined || match[2] === undefined || Number(match[2]) > 100) return undefined;
  const subject = optionalArticle(match[1]);
  return literalDeviceSubject(text, subject);
}

export function missingBrightness(text: string): boolean {
  const words = explicitWords(text);
  return words !== undefined && /^(?:set|change) .+ brightness(?: to| at)?$/u.test(words);
}
const optionalArticle = (value: string) => value.replace(/^(?:the|my) /u, '');
const matchNumber = (expression: RegExp, input: string, requested: unknown): {subject: string} | undefined => {
  const match = expression.exec(input);
  return match?.[1] !== undefined && match[2] !== undefined && Number(match[2]) === requested ? {subject: optionalArticle(match[1])} : undefined;
};

function setting(instruction: string, answer: string, proposal: BoundControl['proposal']): {subject: string} | undefined {
  const data: Readonly<Record<string, unknown>> = proposal.data;
  const input = `${instruction} ${answer}`.trim();
  const family = proposal.family === 'catalog-action' ? proposal.command : proposal.family;
  if (family !== 'power-set' && family !== 'brightness-set' && family !== 'lifx-temperature-set' && family !== 'lifx-color-set') return undefined;
  switch (family) {
    case 'power-set': {
      const power = requestedPower(instruction);
      return power !== undefined && power.on === data.on ? {subject: power.subject} : undefined;
    }
    case 'brightness-set':
      return matchNumber(brightnessAfterTarget, instruction, data.percent)
        ?? matchNumber(brightnessBeforeTarget, instruction, data.percent)
        ?? matchNumber(brightnessWithDetail, input, data.percent);
    case 'lifx-temperature-set':
      return matchNumber(/^(?:set|change) (.+?) (?:color )?temperature to (\d+) kelvin(?: now| please)?$/u, input, data.kelvin);
    case 'lifx-color-set': {
      const color = /^(?:set|change) (.+?) (?:color )?to hue (\d+)(?: degrees?)? (?:and )?saturation (\d+)(?: percent)?(?: now| please)?$/u.exec(input);
      return color?.[1] !== undefined && Number(color[2]) === data.hue && Number(color[3]) === data.saturation ? {subject: optionalArticle(color[1])} : undefined;
    }
  }
}

function exactCatalogRequest(proposal: BoundControl['proposal'], instruction: string): boolean {
  if (proposal.family !== 'catalog-action') return false;
  const selected = /^run ([a-z0-9-]+) on ([a-z0-9-]+) with (\{[^\r\n]*\})$/iu.exec(instruction.trim());
  if (selected?.[1]?.toLowerCase() !== proposal.command || selected[2]?.toLowerCase() !== proposal.target || selected[3] === undefined) return false;
  try {
    const requested: unknown = JSON.parse(selected[3]);
    return isDeepStrictEqual(requested, proposal.data);
  } catch {return false;}
}

export function namedControlTargets(proposal: BoundControl['proposal'], instruction: string, targets: readonly (readonly string[])[]): readonly (readonly string[])[] {
  const words = explicitWords(instruction);
  const subject = words === undefined ? undefined : setting(words, '', proposal)?.subject;
  const brightness = proposal.family === 'brightness-set' || proposal.family === 'catalog-action' && proposal.command === 'brightness-set';
  const literal = brightness ? literalDeviceId(brightnessSubject(instruction) ?? '') : undefined;
  if (subject === undefined) return [];
  return targets.filter(aliases => literal === undefined ? aliases.some(name => normalizedControlText(name) === subject) : aliases[0] === literal);
}

/** The current owner supplies the action and setting. A clarification can resolve a detail in that request. */
export function authorizesControl(proposal: BoundControl['proposal'], instruction: string, answer: string,
  targets: readonly (readonly string[])[], precedingOwnerText: string, knownTargets: readonly (readonly string[])[] = []): boolean {
  if (exactCatalogRequest(proposal, instruction)) return true;
  const words = explicitWords(instruction), choice = answer === '' ? '' : explicitWords(answer);
  if (words === undefined || choice === undefined) return false;
  const selected = setting(words, choice, proposal);
  if (selected === undefined) return false;
  if (proposal.family === 'brightness-set' || proposal.family === 'catalog-action' && proposal.command === 'brightness-set') {
    const directId = literalDeviceId(brightnessSubject(instruction) ?? ''), answerId = literalDeviceId(answer);
    if (directId !== undefined || answerId !== undefined) {
      return targets.length === 1 && targets[0]?.[0] === proposal.target &&
        (directId === undefined ? targets[0].some(name => normalizedControlText(name) === selected.subject) : directId === proposal.target) &&
        (answerId === undefined || answerId === proposal.target);
    }
  }
  const namesTarget = (name: string): boolean => selected.subject === normalizedControlText(name);
  if (targets.every(names => names.some(name => namesTarget(name) || containsControlValue(choice, name)))) {
    const named = knownTargets.filter(names => names.some(namesTarget));
    if (named.length > 0 && targets.some(target => !named.some(names => names[0] === target[0]))) return false;
    const matchingChoice = knownTargets.filter(names => names.some(name => choice === normalizedControlText(name) || choice === `the ${normalizedControlText(name)}`));
    if (matchingChoice.length > 0) return matchingChoice.length === targets.length &&
      matchingChoice.every(names => targets.some(target => target[0] === names[0]));
    return named.length <= targets.length;
  }
  if (targets.length !== 1 ||
    !/^(?:it|that one|this one|the same)$/u.test(selected.subject)) return false;
  if (knownTargets.some(names => names.some(name => containsControlValue(words, name)))) return false;
  const referenced = knownTargets.filter(names => names.some(name => containsControlValue(precedingOwnerText, name)));
  return referenced.length === 1 && referenced[0]?.[0] === targets[0]?.[0];
}
