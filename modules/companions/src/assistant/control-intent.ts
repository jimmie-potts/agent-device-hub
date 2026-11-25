import {isDeepStrictEqual} from 'node:util';
import type {Proposal} from './history-contract.js';

export type BoundControl = {
  readonly requestId: string;
  readonly ownerMessageIds: readonly string[];
  readonly proposal: Exclude<Proposal, {family: 'coding-dispatch'}>;
  readonly additional?: readonly Exclude<Proposal, {family: 'coding-dispatch'}>[];
  readonly text: string;
  readonly call: string;
};

export const normalizedControlText = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const containsControlValue = (input: string, value: string): boolean =>
  normalizedControlText(value) !== '' && ` ${normalizedControlText(input)} `.includes(` ${normalizedControlText(value)} `);

export const ALL_WEMO_PLUGS = 'all wemo plugs';

function explicitWords(text: string): string | undefined {
  const addressed = normalizedControlText(text).replace(/^(?:hey )?(?:b u n n y|bunny|reachy|microduck) /u, '');
  const request = /^(?:(?:please|could you|would you|can you|will you) )+/u;
  if (text.trimEnd().endsWith('?') && !request.test(addressed)) return undefined;
  const words = addressed.replace(request, '');
  if (/\b(?:if|hypothetically|example|suggest|whether|should|not|never|don t|instead of|would happen|tomorrow|later|after|when|unless|before|either|or|minus|negative|except|without|other than|avoid)\b/u.test(words)
    || /["“”`]|(?:^|\s)[-−]\d/u.test(text)) return undefined;
  return words;
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

export function missingMode(text: string): boolean {
  const words = explicitWords(text);
  return words !== undefined && /^(?:set|change|switch) (?:the )?(?:hub )?mode(?: to)?$/u.test(words);
}

export function missingBrightness(text: string): boolean {
  const words = explicitWords(text);
  return words !== undefined && /^(?:set|change) .+ brightness(?: to| at)?$/u.test(words);
}
type Setting = {subject?: string; recipients?: readonly string[]};
const optionalArticle = (value: string) => value.replace(/^(?:the|my) /u, '');
const matchNumber = (expression: RegExp, input: string, requested: unknown): Setting | undefined => {
  const match = expression.exec(input);
  return match?.[1] !== undefined && match[2] !== undefined && Number(match[2]) === requested ? {subject: optionalArticle(match[1])} : undefined;
};

function setting(instruction: string, answer: string, rawInstruction: string, rawAnswer: string, proposal: BoundControl['proposal'], knownArtwork: boolean): Setting | undefined {
  const data: Readonly<Record<string, unknown>> = proposal.data;
  const input = `${instruction} ${answer}`.trim();
  const family = proposal.family === 'catalog-action' ? proposal.command : proposal.family;
  switch (family) {
    case 'power-set': {
      const power = requestedPower(instruction);
      return power !== undefined && power.on === data.on ? {subject: power.subject} : undefined;
    }
    case 'mode-set': {
      const mode = /^(?:set|change|switch|enter|put) (?:(?:the )?hub )?(?:mode )?(?:to |in |into )?(work|free|quiet)(?: mode)?(?: now| please)?$/u.exec(input);
      return mode?.[1] !== undefined && mode[1] === data.mode ? {} : undefined;
    }
    case 'mode-override-set':
    case 'device-mode-set': {
      const mode = /^(?:set|change|switch) (.+?) (?:mode to|to) ([a-z]+) mode(?: now| please)?$/u.exec(input)
        ?? /^(?:set|change|switch) (.+?) mode to ([a-z]+)(?: now| please)?$/u.exec(input);
      return mode?.[1] !== undefined && mode[2] === data.mode ? {subject: optionalArticle(mode[1])} : undefined;
    }
    case 'brightness-set':
      return matchNumber(/^(?:set|change) (.+?) brightness (?:to|at) (\d+)(?: percent)?(?: now| please)?$/u, instruction, data.percent)
        ?? matchNumber(/^(?:set|change) (?:the )?brightness (?:of|on|for) (.+?) (?:to|at) (\d+)(?: percent)?(?: now| please)?$/u, instruction, data.percent)
        ?? matchNumber(/^(?:set|change) (.+?) brightness (?:to )?(\d+)(?: percent)?$/u, input, data.percent);
    case 'lifx-temperature-set':
      return matchNumber(/^(?:set|change) (.+?) (?:color )?temperature to (\d+) kelvin(?: now| please)?$/u, input, data.kelvin);
    case 'volcano-session-gap':
      return matchNumber(/^(?:set|change) (.+?) session gap to (\d+) minutes?(?: now| please)?$/u, input, data.gapMinutes);
    case 'lifx-color-set': {
      const color = /^(?:set|change) (.+?) (?:color )?to hue (\d+)(?: degrees?)? (?:and )?saturation (\d+)(?: percent)?(?: now| please)?$/u.exec(input);
      return color?.[1] !== undefined && Number(color[2]) === data.hue && Number(color[3]) === data.saturation ? {subject: optionalArticle(color[1])} : undefined;
    }
    case 'session-label-set': {
      if (data.label === null) {
        const clear = /^(?:clear|remove) (?:the )?label (?:on|for|of) (?:session )?(.+)$/u.exec(instruction);
        return clear?.[1] === undefined ? undefined : {subject: optionalArticle(clear[1])};
      }
      const raw = rawAnswer === '' ? rawInstruction : `${rawInstruction} ${rawAnswer}`;
      const rename = /^(?:(?:please|could you|would you|can you) )*(?:rename|label) (?:the )?session (.+?) (?:to|as) (.+?)[.?!]?$/iu.exec(raw.trim());
      return rename?.[1] !== undefined && rename[2] === data.label ? {subject: optionalArticle(normalizedControlText(rename[1]))} : undefined;
    }
    case 'inbox-handle': {
      const request = /^(dismiss|send again|retry) (?:the )?(?:inbox (?:item|operation) )?(.+)$/u.exec(instruction);
      const action = request?.[1] === 'dismiss' ? 'dismiss' : 'send-again';
      return request?.[2] !== undefined && action === data.action ? {subject: request[2]} : undefined;
    }
    case 'wemo-hold-release': {
      const request = /^(?:release|clear) (?:the )?hold (?:on|for) (.+)$/u.exec(instruction);
      return request?.[1] === undefined ? undefined : {subject: optionalArticle(request[1])};
    }
    case 'art-show': {
      const keepStatus = /(?: and)? keep status visible$/u;
      const requestedKeep = keepStatus.test(instruction);
      const request = /^(?:show|display|put) (.+?) (?:on|in) (.+)$/u.exec(instruction.replace(keepStatus, ''));
      if (request?.[1] === undefined || request[2] === undefined || typeof data.artworkId !== 'string' ||
        (data.coversStatus === false) !== requestedKeep) return undefined;
      const artwork = request[1];
      if (normalizedControlText(data.artworkId) !== optionalArticle(artwork) &&
        !(knownArtwork && /^(?:it|(?:this|that) (?:artwork|animation|image|picture))$/u.test(artwork))) return undefined;
      const recipients = request[2].split(' and ').map(optionalArticle);
      return {recipients};
    }
    case 'nanoleaf-show-save': {
      const request = /^(?:please )?save draft (.+?) (?:revision \d+ )?as (.+)$/iu.exec(rawInstruction.trim());
      return request?.[1] !== undefined && typeof data.name === 'string' && containsControlValue(request[1], data.name)
        && request[2] === data.versionName ? {} : undefined;
    }
    case 'scene-activate':
    case 'nanoleaf-animation-play':
    case 'media-start': {
      const content = /^(?:activate|use|play|start|show) (?:the )?(scene|animation|playlist) (.+?) on (.+)$/u.exec(instruction);
      if (content?.[2] === undefined || content[3] === undefined) return undefined;
      const selected = family === 'scene-activate' && content[1] === 'scene' ? data.sceneId
        : family === 'nanoleaf-animation-play' && content[1] === 'animation' ? data.animation
          : family === 'media-start' && content[1] === 'playlist' ? data.playlistId : undefined;
      return typeof selected === 'string' && normalizedControlText(selected) === content[2] ? {subject: optionalArticle(content[3])} : undefined;
    }
    case 'playback-control': {
      const request = /^(play|stop|pause|resume|next|previous) (?:the )?(?:playback on )?(.+)$/u.exec(instruction);
      return request?.[2] !== undefined && request[1] === data.action ? {subject: optionalArticle(request[2])} : undefined;
    }
    case 'music-lighting-control': {
      const request = /^(stop|pause|resume) (?:the )?light show on (.+)$/u.exec(instruction);
      const verb = request?.[1];
      return request?.[2] !== undefined && (verb === 'stop' ? verb : `${verb}-show`) === data.action ? {subject: optionalArticle(request[2])} : undefined;
    }
    // Structured edits require named fields. A list of matching words cannot bind their effect.
    case 'art-catalog-edit':
    case 'art-request':
    case 'home-layout-set':
    case 'lighting-layout-set':
    case 'media-control':
    case 'moment-play':
    case 'nanoleaf-favorite-edit':
    case 'nanoleaf-machine-edit':
    case 'nanoleaf-notice-acknowledge':
    case 'nanoleaf-reactive-preset-save':
    case 'nanoleaf-wall-edit':
    case 'notice-clear':
    case 'pixoo-asset-change':
    case 'pixoo-media-show':
    case 'pixoo-moments-set':
    case 'pixoo-monitor-set':
    case 'pixoo-notice-dismiss':
    case 'pixoo-now-playing-set':
    case 'pixoo-playlist-change':
    case 'playback-layout-set':
      return undefined;
  }
}

function exactCatalogRequest(proposal: BoundControl['proposal'], instruction: string): boolean {
  if (proposal.family !== 'catalog-action') return false;
  const selected = /^run ([a-z0-9-]+) on ([a-z0-9-]+) with (\{[^\r\n]*\})$/iu.exec(instruction.trim());
  if (selected?.[1]?.toLowerCase() !== proposal.command || selected[2]?.toLowerCase() !== proposal.target || selected[3] === undefined) return false;
  try {
    const requested: unknown = JSON.parse(selected[3]);
    if (isDeepStrictEqual(requested, proposal.data)) return true;
    if (proposal.command === 'art-show') {
      const {guards: _, ...effect} = proposal.data;
      return isDeepStrictEqual(requested, effect);
    }
    if (proposal.command === 'music-lighting-control') {
      const {generation: _, ...effect} = proposal.data;
      return isDeepStrictEqual(requested, effect);
    }
    return false;
  } catch {return false;}
}

export function namedControlTargets(proposal: BoundControl['proposal'], instruction: string, targets: readonly (readonly string[])[]): readonly (readonly string[])[] {
  const words = explicitWords(instruction);
  const subject = words === undefined ? undefined : setting(words, '', instruction, '', proposal, false)?.subject;
  return subject === undefined ? [] : targets.filter(aliases => aliases.some(name => normalizedControlText(name) === subject));
}

/** The current owner supplies the action and setting. A clarification can resolve a detail in that request. */
export function authorizesControl(proposal: BoundControl['proposal'], instruction: string, answer: string,
  targets: readonly (readonly string[])[], precedingOwnerText: string, knownTargets: readonly (readonly string[])[] = [], knownArtwork = false, explicitGroup = false): boolean {
  if (exactCatalogRequest(proposal, instruction)) return true;
  const requested = explicitWords(instruction);
  if (requested === undefined) return false;
  const words = knownArtwork && proposal.family === 'catalog-action' && proposal.command === 'art-show'
    ? /\band ((?:show|display|put) .+)$/u.exec(requested)?.[1] ?? requested : requested;
  const choice = answer === '' ? '' : explicitWords(answer);
  if (choice === undefined) return false;
  const selected = setting(words, choice, instruction, answer, proposal, knownArtwork);
  if (selected === undefined) return false;
  if (selected.recipients !== undefined) {
    const names = selected.recipients;
    if (names.length !== targets.length) return false;
    if (names.length === 1 && choice !== '') return targets[0]?.some(name => normalizedControlText(name) === optionalArticle(choice)) === true;
    return names.every(requestedName => targets.filter(aliases => aliases.some(name => normalizedControlText(name) === requestedName)).length === 1)
      && targets.every(aliases => aliases.some(name => names.includes(normalizedControlText(name))));
  }
  if (selected.subject === ALL_WEMO_PLUGS) return explicitGroup && proposal.family === 'power-set' && 'owner' in proposal;
  const namesTarget = (name: string): boolean => selected.subject === undefined ? containsControlValue(words, name) : selected.subject === normalizedControlText(name);
  if (targets.every(names => names.some(name => namesTarget(name) || containsControlValue(choice, name)))) {
    const named = knownTargets.filter(names => names.some(namesTarget));
    if (named.length > 0 && targets.some(target => !named.some(names => names[0] === target[0]))) return false;
    const matchingChoice = knownTargets.filter(names => names.some(name => choice === normalizedControlText(name) || choice === `the ${normalizedControlText(name)}`));
    if (matchingChoice.length > 0) return matchingChoice.length === targets.length &&
      matchingChoice.every(names => targets.some(target => target[0] === names[0]));
    return named.length <= targets.length;
  }
  if (targets.length !== 1 || selected.subject === undefined ||
    !/^(?:it|that one|this one|the same)$/u.test(selected.subject)) return false;
  if (knownTargets.some(names => names.some(name => containsControlValue(words, name)))) return false;
  const referenced = knownTargets.filter(names => names.some(name => containsControlValue(precedingOwnerText, name)));
  return referenced.length === 1 && referenced[0]?.[0] === targets[0]?.[0];
}
