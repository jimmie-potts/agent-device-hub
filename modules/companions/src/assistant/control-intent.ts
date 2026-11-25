import {isDeepStrictEqual} from 'node:util';
import type {CatalogFamily} from '@jimmie-potts/event-contracts/v2/assistant-actions';
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

const actionWords: Readonly<Record<CatalogFamily, RegExp>> = {
  'power-set': /^(?:turn|switch|power|shut)\b/u,
  'brightness-set': /^(?:set|change|dim|brighten)\b/u,
  'device-mode-set': /^(?:set|change|switch)\b/u,
  'lifx-color-set': /^(?:set|change)\b/u,
  'lifx-temperature-set': /^(?:set|change)\b/u,
  'scene-activate': /^(?:activate|use|apply|start)\b/u,
  'moment-play': /^(?:play|start|show)\b/u,
  'media-start': /^(?:play|start|show)\b/u,
  'media-control': /^(?:play|start|stop|pause|resume|skip|next|previous)\b/u,
  'pixoo-media-show': /^(?:play|show|display)\b/u,
  'pixoo-monitor-set': /^(?:set|change|update)\b/u,
  'pixoo-now-playing-set': /^(?:set|change|show|clear)\b/u,
  'pixoo-moments-set': /^(?:set|change|enable|disable)\b/u,
  'pixoo-playlist-change': /^(?:add|remove|rename|delete|edit|create|update|change|reorder)\b/u,
  'pixoo-asset-change': /^(?:add|remove|rename|delete|edit|update|change)\b/u,
  'pixoo-notice-dismiss': /^(?:dismiss|clear)\b/u,
  'nanoleaf-animation-play': /^(?:play|start|show)\b/u,
  'nanoleaf-wall-edit': /^(?:edit|add|remove|delete|update|change|set)\b/u,
  'nanoleaf-machine-edit': /^(?:edit|add|remove|delete|update|change|set)\b/u,
  'nanoleaf-favorite-edit': /^(?:edit|add|remove|delete|update|change|set)\b/u,
  'nanoleaf-notice-acknowledge': /^(?:acknowledge|clear|dismiss)\b/u,
  'nanoleaf-reactive-preset-save': /^(?:save|create|update)\b/u,
  'wemo-hold-release': /^(?:release|clear)\b/u,
  'mode-override-set': /^(?:set|change|switch|enter|put)\b/u,
  'notice-clear': /^(?:clear|acknowledge|dismiss)\b/u,
  'session-label-set': /^(?:name|rename|label|set|clear)\b/u,
  'inbox-handle': /^(?:dismiss|send again|retry)\b/u,
  'home-layout-set': /^(?:set|change|update)\b/u,
  'lighting-layout-set': /^(?:set|change|update)\b/u,
  'playback-layout-set': /^(?:set|change|update)\b/u,
  'art-catalog-edit': /^(?:favorite|unfavorite|delete|reuse|rate)\b/u,
  'playback-control': /^(?:play|stop|pause|resume|skip|next|previous)\b/u,
  'volcano-session-gap': /^(?:set|change)\b/u,
  'art-request': /^$/u,
  'art-show': /^(?:show|display|put)\b/u,
  'nanoleaf-show-save': /^save\b/u,
  'music-lighting-control': /^(?:play|start|stop|pause|resume|seek)\b/u,
};

export const ALL_WEMO_PLUGS = 'all wemo plugs';

function explicitWords(text: string): string | undefined {
  const addressed = normalizedControlText(text).replace(/^(?:hey )?(?:b u n n y|bunny|reachy|microduck) /u, '');
  const request = /^(?:(?:please|could you|would you|can you|will you) )+/u;
  if (text.trimEnd().endsWith('?') && !request.test(addressed)) return undefined;
  const words = addressed.replace(request, '');
  if (/\b(?:if|hypothetically|example|suggest|whether|should|not|never|don t|instead of|would happen|tomorrow|later|after|when|unless|before|either|or|minus|negative)\b/u.test(words)
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
const namedNumber = (input: string): number | undefined => {
  const matches = [...input.matchAll(/(?:^| )(\d+)(?= |$)/gu)];
  return matches.length === 1 ? Number(matches[0]?.[1]) : undefined;
};
const authorityFields = new Set(['guards', 'generation', 'heldRequestId', 'expectedRevision', 'expectedVersion', 'timeline']);
function literalMatches(input: string, data: unknown): boolean {
  if (typeof data === 'string' || typeof data === 'number') return containsControlValue(input, String(data));
  if (typeof data === 'boolean') return containsControlValue(input, String(data));
  if (Array.isArray(data)) return data.length > 0 && data.every(value => literalMatches(input, value));
  if (typeof data !== 'object' || data === null) return false;
  return Object.entries(data).every(([key, value]) => authorityFields.has(key) || literalMatches(input, value));
}

function settingMatches(instruction: string, answer: string, proposal: BoundControl['proposal'], knownArtwork: boolean): boolean {
  const data: Readonly<Record<string, unknown>> = proposal.data;
  const input = `${instruction} ${answer}`.trim();
  const family = proposal.family === 'catalog-action' ? proposal.command : proposal.family;
  if (family === 'power-set') return typeof data.on === 'boolean' && requestedPower(instruction)?.on === data.on;
  if (family === 'mode-set' || family === 'mode-override-set') {
    if (family === 'mode-set') {
      const explicit = /^(?:set|change|switch|enter|put) (?:(?:the )?hub )?(?:mode )?(?:to |in |into )?(work|free|quiet)(?: mode)?(?: now| please)?$/u.exec(input);
      return explicit?.[1] === data.mode;
    }
    const possibilities = ['work', 'free', 'quiet'].filter(mode => containsControlValue(input, mode));
    return possibilities.length === 1 && possibilities[0] === data.mode;
  }
  if (family === 'brightness-set') {
    if (/\b(?:by|less|more|higher|lower|brighter|dimmer)\b/u.test(input)) return false;
    const explicit = /\b(?:to|at) (\d+)(?: percent)?(?: please| now)?$/u.exec(input);
    return (explicit?.[1] === undefined ? namedNumber(input) : Number(explicit[1])) === data.percent;
  }
  if (family === 'lifx-temperature-set') return namedNumber(input) === data.kelvin;
  if (family === 'volcano-session-gap') return namedNumber(input) === data.gapMinutes;
  if (family === 'session-label-set' && data.label === null) return /^(?:clear|remove)\b/u.test(input) && containsControlValue(input, 'label');
  if (family === 'inbox-handle' && data.action === 'send-again') return /^(?:send again|retry)\b/u.test(input);
  if (family === 'wemo-hold-release') return containsControlValue(input, 'hold');
  if (family === 'art-show') return typeof data.artworkId === 'string' &&
    (containsControlValue(input, data.artworkId) || (knownArtwork && /\b(?:it|that (?:artwork|animation|image|picture)|this (?:artwork|animation|image|picture))\b/u.test(input)));
  if (family === 'nanoleaf-show-save') return typeof data.name === 'string' && containsControlValue(input, data.name) &&
    typeof data.versionName === 'string' && containsControlValue(input, data.versionName);
  if (family === 'playback-control') return typeof data.action === 'string' && input.startsWith(data.action.replaceAll('-', ' '));
  if (family === 'music-lighting-control') {
    if (typeof data.action !== 'string' || !containsControlValue(input, data.action.replace(/-show$/u, ''))) return false;
    if (data.action === 'start-show') return literalMatches(input, {showId: data.showId, version: data.version}) &&
      (data.positionMs === 0 || literalMatches(input, data.positionMs)) && (data.startDelayMs === 0 || literalMatches(input, data.startDelayMs));
    return data.action !== 'seek-show' || literalMatches(input, data.positionMs);
  }
  return literalMatches(input, data);
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
  const action = proposal.family === 'mode-set' ? /^(?:set|change|switch|enter|put)\b/u
    : actionWords[proposal.family === 'catalog-action' ? proposal.command : proposal.family];
  if (!action.test(words) || !settingMatches(words, choice, proposal, knownArtwork)) return false;
  const power = proposal.family === 'power-set' || (proposal.family === 'catalog-action' && proposal.command === 'power-set')
    ? requestedPower(words) : undefined;
  if (power?.subject === ALL_WEMO_PLUGS) return explicitGroup && proposal.family === 'power-set' && 'owner' in proposal;
  const namesTarget = (name: string): boolean => power === undefined ? containsControlValue(words, name) : power.subject === normalizedControlText(name);
  if (targets.every(names => names.some(name => namesTarget(name) || containsControlValue(choice, name)))) {
    const named = knownTargets.filter(names => names.some(namesTarget));
    if (named.length > 0 && targets.some(target => !named.some(names => names[0] === target[0]))) return false;
    const matchingChoice = knownTargets.filter(names => names.some(name => choice === normalizedControlText(name) || choice === `the ${normalizedControlText(name)}`));
    if (matchingChoice.length > 0) return matchingChoice.length === targets.length &&
      matchingChoice.every(names => targets.some(target => target[0] === names[0]));
    return named.length <= targets.length;
  }
  if (targets.length !== 1 || (power === undefined ? !/\b(?:it|that one|this one|the same)\b/u.test(words)
    : !/^(?:it|that one|this one|the same)$/u.test(power.subject))) return false;
  if (knownTargets.some(names => names.some(name => containsControlValue(words, name)))) return false;
  const referenced = knownTargets.filter(names => names.some(name => containsControlValue(precedingOwnerText, name)));
  return referenced.length === 1 && referenced[0]?.[0] === targets[0]?.[0];
}
