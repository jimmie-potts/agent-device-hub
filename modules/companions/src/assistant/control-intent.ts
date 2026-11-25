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
  readonly draftRevision?: number;
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
function immediateMoment(instruction: string, answer: string): {subject: string; mood: string; durationMs: number; coversStatus: boolean} | undefined {
  const duration = /^(\d+)(?: seconds?)?$/u.exec(answer)?.[1];
  const detail = duration === undefined ? answer : `for ${duration} seconds`;
  const request = /^play (?:an? |the )?([a-z]+) moment on (.+?) for (\d+) seconds?(?: (and keep status visible|and cover status))?$/u.exec(
    `${instruction} ${detail}`.trim());
  return request?.[1] === undefined || request[2] === undefined ? undefined : {
    subject: request[2], mood: request[1], durationMs: Number(request[3]) * 1000, coversStatus: request[4] === 'and cover status',
  };
}

export function requestedMoment(instruction: string, answer: string): ReturnType<typeof immediateMoment> {
  const words = explicitWords(instruction), detail = answer === '' ? '' : explicitWords(answer);
  return words === undefined || detail === undefined ? undefined : immediateMoment(words, detail);
}

export function missingCatalogDetail(family: CatalogFamily, instruction: string): string | undefined {
  const words = explicitWords(instruction);
  if (words === undefined) return undefined;
  switch (family) {
    case 'media-control':
      return /^(?:pause|resume|stop|next|previous) (?:the )?(?:media|playback)$/u.test(words) ? 'Which device should I use?' : undefined;
    case 'pixoo-now-playing-set':
      return /^show (?:the )?now playing (?:card )?on .+$/u.test(words) ? 'Should Now Playing appear as a popup or full screen?' : undefined;
    case 'moment-play':
      if (/^play (?:an? |the )?[a-z]+ moment on .+$/u.test(words) && !/ for \d+ seconds?/u.test(words)) {
        return 'How many seconds should the moment play?';
      }
      return /^play (?:an? |the )?[a-z]+ moment$/u.test(words) ? 'Which display should play the moment, and for how many seconds?' : undefined;
    case 'home-layout-set':
      return /^(?:set|change|update) (?:the )?home layout/u.test(words) ? 'Which cards should be on the desktop and phone layouts, and where?' : undefined;
    case 'lighting-layout-set':
      return /^(?:set|change|update) (?:the )?lighting layout/u.test(words) ? 'Which rooms, lights and groups should the lighting layout contain?' : undefined;
    case 'playback-layout-set':
      return /^(?:set|change|update) (?:the )?playback layout/u.test(words) ? 'Which playback sources should be assigned to each room?' : undefined;
    case 'nanoleaf-reactive-preset-save':
      return /^save (?:a |the )?reactive preset/u.test(words) ? 'Which effect and colors should the preset use, and what should it be called?' : undefined;
    default:
      return undefined;
  }
}

type Setting = {subject?: string; recipients?: readonly string[]};
const optionalArticle = (value: string) => value.replace(/^(?:the|my) /u, '');
const matchNumber = (expression: RegExp, input: string, requested: unknown): Setting | undefined => {
  const match = expression.exec(input);
  return match?.[1] !== undefined && match[2] !== undefined && Number(match[2]) === requested ? {subject: optionalArticle(match[1])} : undefined;
};

function setting(instruction: string, answer: string, rawInstruction: string, rawAnswer: string, proposal: BoundControl['proposal'], knownArtwork: boolean, draftRevision?: number): Setting | undefined {
  const data: Readonly<Record<string, unknown>> = proposal.data;
  const input = `${instruction} ${answer}`.trim();
  const matchesEdit = (subject: string, proposalData: unknown): Setting | undefined =>
    isDeepStrictEqual(data, proposalData) ? {subject: optionalArticle(subject)} : undefined;
  const raw = rawAnswer === '' ? rawInstruction.trim() : `${rawInstruction.trim()} ${rawAnswer.trim()}`;
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
      const request = /^(?:please )?save draft (.+?)(?: revision (\d+))? as (.+)$/iu.exec(rawInstruction.trim());
      return request?.[1] !== undefined && typeof data.name === 'string' && containsControlValue(request[1], data.name)
        && (request[2] === undefined || Number(request[2]) === draftRevision) && request[3] === data.versionName ? {} : undefined;
    }
    case 'scene-activate':
    case 'nanoleaf-animation-play':
    case 'media-start': {
      const content = /^(?:activate|use|play|start|show) (?:the )?(scene|animation|playlist) (.+?) on (.+)$/u.exec(instruction);
      if (content?.[2] === undefined || content[3] === undefined) return undefined;
      const selected = family === 'scene-activate' && content[1] === 'scene' ? data.sceneId
        : family === 'nanoleaf-animation-play' && content[1] === 'animation' && typeof data.animation === 'object'
          && data.animation !== null && 'preset' in data.animation && Object.keys(data.animation).length === 1 ? data.animation.preset
          : family === 'media-start' && content[1] === 'playlist' ? data.playlistId : undefined;
      return typeof selected === 'string' && normalizedControlText(selected) === content[2] ? {subject: optionalArticle(content[3])} : undefined;
    }
    case 'media-control': {
      const request = /^(pause|resume|stop|next|previous) (?:the )?(?:media|playback)(?: on (.+))?$/u.exec(instruction)
        ?? /^(?:skip to )?(next|previous) (?:track|item) on (.+)$/u.exec(instruction);
      const subject = request?.[2] ?? answer;
      return request?.[1] !== undefined && request[1] === data.action && subject !== '' ? {subject: optionalArticle(subject)} : undefined;
    }
    case 'pixoo-moments-set': {
      const request = /^(allow|enable|disable|block) moments (?:over|to cover) status on (.+)$/u.exec(instruction);
      return request?.[2] !== undefined && data.overStatus === (request[1] === 'allow' || request[1] === 'enable')
        ? {subject: optionalArticle(request[2])} : undefined;
    }
    case 'pixoo-now-playing-set': {
      const request = /^(show|hide|turn off) (?:the )?now playing (?:card )?on (.+)$/u.exec(instruction);
      if (request?.[2] !== undefined && request[1] !== 'show') return matchesEdit(request[2], {media: 'off'});
      const display = /^show (?:the )?now playing (?:card )?(as a popup|full screen) on (.+)$/u.exec(instruction);
      if (display?.[2] !== undefined) return matchesEdit(display[2], {media: display[1] === 'as a popup' ? 'popup' : 'whole'});
      return request?.[2] === undefined || !['popup', 'full screen'].includes(answer) ? undefined
        : matchesEdit(request[2], {media: answer === 'popup' ? 'popup' : 'whole'});
    }
    case 'pixoo-monitor-set': {
      const request = /^show (all sessions|codex sessions|claude sessions) on (.+?) (?:every (\d+) milliseconds?|every (\d+) seconds?)$/u.exec(input);
      if (request?.[2] === undefined) return undefined;
      const filter = request[1] === 'all sessions' ? {} : {provider: request[1]?.split(' ')[0]};
      return matchesEdit(request[2], {filter, cadenceMs: request[3] === undefined ? Number(request[4]) * 1000 : Number(request[3])});
    }
    case 'notice-clear': {
      const clear = /^(?:clear|dismiss) (?:all )?(?:the )?notices (?:for|on) (?:the )?session (.+)$/u.exec(instruction);
      if (clear?.[1] !== undefined && data.noticeId === null) return {subject: optionalArticle(clear[1])};
      const notice = /^(?:clear|dismiss) (?:the )?notice (.+?) (?:for|on) (?:the )?session (.+)$/u.exec(instruction);
      return notice?.[1] !== undefined && notice[2] !== undefined && typeof data.noticeId === 'string' &&
        notice[1] === normalizedControlText(data.noticeId) ? {subject: optionalArticle(notice[2])} : undefined;
    }
    case 'pixoo-notice-dismiss':
    case 'nanoleaf-notice-acknowledge': {
      const notice = /^(?:clear|dismiss|acknowledge) notice (.+?) for (session|task) (.+?) on (.+)$/u.exec(instruction);
      if (notice?.[1] === undefined || notice[3] === undefined || notice[4] === undefined || typeof data.noticeId !== 'string') return undefined;
      const owner = family === 'pixoo-notice-dismiss' && notice[2] === 'session' ? data.session
        : family === 'nanoleaf-notice-acknowledge' && notice[2] === 'task' ? data.task : undefined;
      return typeof owner === 'string' && normalizedControlText(owner) === notice[3] && normalizedControlText(data.noticeId) === notice[1]
        ? {subject: optionalArticle(notice[4])} : undefined;
    }
    case 'art-catalog-edit': {
      const art = /^(favorite|unfavorite|delete) (?:the )?(?:saved )?artwork (.+)$/u.exec(instruction);
      if (art?.[2] === undefined || typeof data.artworkId !== 'string' || normalizedControlText(data.artworkId) !== art[2]) return undefined;
      if (art[1] === 'delete') return isDeepStrictEqual(data, {action: 'delete', artworkId: data.artworkId}) ? {} : undefined;
      return isDeepStrictEqual(data, {action: 'favorite', artworkId: data.artworkId, favorite: art[1] === 'favorite'}) ? {} : undefined;
    }
    case 'playback-control': {
      const request = /^(play|stop|pause|resume|next|previous) (?:the )?(?:playback on )?(.+)$/u.exec(instruction);
      return request?.[2] !== undefined && request[1] === data.action ? {subject: optionalArticle(request[2])} : undefined;
    }
    case 'music-lighting-control': {
      const start = /^(?:start|play) (?:the )?light show (.+?) version (\d+) on (.+)$/u.exec(input);
      if (start?.[3] !== undefined && typeof data.showId === 'string' && normalizedControlText(data.showId) === start[1]) {
        return matchesEdit(start[3], {action: 'start-show', showId: data.showId, version: Number(start[2]), positionMs: 0, startDelayMs: 0});
      }
      const request = /^(stop|pause|resume) (?:the )?light show on (.+)$/u.exec(instruction);
      const verb = request?.[1];
      return request?.[2] !== undefined && (verb === 'stop' ? verb : `${verb}-show`) === data.action ? {subject: optionalArticle(request[2])} : undefined;
    }
    case 'moment-play': {
      const immediate = immediateMoment(instruction, answer);
      if (immediate !== undefined) return matchesEdit(immediate.subject, {
        momentId: data.momentId, mood: immediate.mood, durationMs: immediate.durationMs, priorityClass: 'flourish',
        coversStatus: immediate.coversStatus, startAtMs: data.startAtMs, toleranceMs: 2000,
      });
      const moment = /^play (?:a |the )?([a-z]+) moment (.+?) on (.+?) for (\d+) seconds? as (?:an? )?(event|flourish) starting at (\d+) milliseconds? with (\d+) milliseconds? tolerance(?: (and keep status visible|and cover status))?$/u.exec(input);
      if (moment?.[3] === undefined || typeof data.momentId !== 'string' || normalizedControlText(data.momentId) !== moment[2]) return undefined;
      return matchesEdit(moment[3], {momentId: data.momentId, mood: moment[1], durationMs: Number(moment[4]) * 1000,
        priorityClass: moment[5], startAtMs: Number(moment[6]), toleranceMs: Number(moment[7]), coversStatus: moment[8] === 'and cover status'});
    }
    case 'nanoleaf-favorite-edit': {
      const rename = /^rename (?:the )?favorite (.+?) to (.+?) on (.+)$/iu.exec(raw);
      if (rename?.[3] !== undefined) return matchesEdit(normalizedControlText(rename[3]), {edit: {kind: 'rename', name: rename[1], newName: rename[2]}});
      const forget = /^(?:remove|forget) (?:the )?favorite (.+?) on (.+)$/iu.exec(raw);
      if (forget?.[2] !== undefined) return matchesEdit(normalizedControlText(forget[2]), {edit: {kind: 'forget', name: forget[1]}});
      const save = /^save (?:the )?([a-z0-9-]+) animation as favorite (.+?) on (.+)$/iu.exec(raw);
      return save?.[3] === undefined ? undefined : matchesEdit(normalizedControlText(save[3]), {edit: {kind: 'save', name: save[2], animation: {preset: save[1]}}});
    }
    case 'nanoleaf-machine-edit':
    case 'nanoleaf-wall-edit': {
      const surface = family === 'nanoleaf-machine-edit' ? 'machine' : 'wall';
      const style = /^set (.+?) (machine|wall) style to (classic|project)$/u.exec(input);
      if (style?.[1] !== undefined && style[2] === surface) return matchesEdit(style[1], {edit: {kind: 'settings', settings: {style: style[3]}}});
      const coverage = /^set (.+?) (machine|wall) coverage to (whole|status)$/u.exec(input);
      if (coverage?.[1] !== undefined && coverage[2] === surface) return matchesEdit(coverage[1], {edit: {kind: 'settings', settings: {coverage: coverage[3]}}});
      const rotate = /^rotate (.+?) wall (?:to )?(0|90|180|270) degrees?$/u.exec(input);
      return rotate?.[1] === undefined || surface !== 'wall' ? undefined
        : matchesEdit(rotate[1], {edit: {kind: 'settings', settings: {rotation: Number(rotate[2])}}});
    }
    case 'pixoo-playlist-change': {
      const rename = /^rename playlist ([a-f0-9-]+) revision (\d+) to (.+?) on (.+)$/iu.exec(raw);
      if (rename?.[4] !== undefined) return matchesEdit(normalizedControlText(rename[4]),
        {change: {operation: 'rename', playlistId: rename[1], revision: Number(rename[2]), name: rename[3]}});
      const remove = /^delete playlist ([a-f0-9-]+) revision (\d+) on (.+)$/iu.exec(raw);
      if (remove?.[3] !== undefined) return matchesEdit(normalizedControlText(remove[3]),
        {change: {operation: 'delete', playlistId: remove[1], revision: Number(remove[2])}});
      const request = /^create (?:a )?playlist (?:named |called )?(.+?) on (.+)$/iu.exec(raw);
      return request?.[2] === undefined ? undefined
        : matchesEdit(normalizedControlText(request[2]), {change: {operation: 'create', name: request[1]}});
    }
    case 'pixoo-asset-change': {
      const request = /^(render|delete) (?:the )?asset ([a-f0-9-]+) on (.+)$/iu.exec(raw);
      return request?.[3] === undefined ? undefined
        : matchesEdit(normalizedControlText(request[3]), {change: {operation: request[1]?.toLowerCase(), assetId: request[2]}});
    }
    case 'pixoo-media-show': {
      const request = /^play (?:the )?rendition ([a-f0-9]+) on (.+?) (once|twice|\d+ times)$/iu.exec(raw);
      return request?.[2] === undefined ? undefined : matchesEdit(normalizedControlText(request[2]), {renditionId: request[1],
        playback: {mode: 'plays', totalPlays: request[3] === 'once' ? 1 : request[3] === 'twice' ? 2 : Number(request[3]?.split(' ')[0])}});
    }
    case 'home-layout-set': {
      const clear = /^clear (?:all )?(?:the )?(?:desktop and phone|phone and desktop) home cards$/u.test(input);
      if (clear) return matchesEdit('home', {layouts: {desktop: [], phone: []}});
      const single = /^set (?:the )?home layout to only a (small|medium|large) ([a-z0-9-]+) card on desktop and phone$/iu.exec(raw);
      if (single?.[2] === undefined) return undefined;
      const card = {widget: single[2], size: single[1]?.toLowerCase(), hidden: false};
      return matchesEdit('home', {layouts: {desktop: [card], phone: [card]}});
    }
    case 'lighting-layout-set':
      return /^clear all lighting rooms groups and assignments and show all lights on home$/u.test(input)
        ? matchesEdit('lighting', {layout: {rooms: [], assignments: [], groups: [], home: null}}) : undefined;
    case 'playback-layout-set': {
      if (/^clear all playback room assignments$/u.test(input)) return matchesEdit('playback', {assignments: []});
      const placement = /^replace all playback room assignments with ([a-z0-9-]+) in ([a-z0-9-]+(?: and [a-z0-9-]+)*)$/iu.exec(raw);
      return placement?.[2] === undefined ? undefined : matchesEdit('playback', {
        assignments: [{playback: placement[1], rooms: placement[2].split(/ and /iu)}],
      });
    }
    case 'nanoleaf-reactive-preset-save': {
      const request = /^save reactive preset ([a-z0-9-]+) at library revision (\d+) as (.+?) with (ambient|level-glow) and colors (#[a-f0-9]{6}(?: and #[a-f0-9]{6})*)$/iu.exec(raw);
      return request?.[5] === undefined ? undefined : matchesEdit('reactive-presets', {
        presetId: request[1], expectedRevision: Number(request[2]), name: request[3],
        recipe: {rendererVersion: 1, effect: request[4]?.toLowerCase(), palette: request[5].toLowerCase().split(' and ')},
      });
    }
    case 'art-request':
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

export function requestedArtRecipients(instruction: string, data: CatalogArtEffect): readonly string[] | undefined {
  const words = explicitWords(instruction);
  if (words === undefined) return undefined;
  const show = /\band ((?:show|display|put) .+)$/u.exec(words)?.[1] ?? words;
  const keepStatus = /(?: and)? keep status visible$/u;
  if (keepStatus.test(show) !== (data.coversStatus === false)) return undefined;
  const targetList = /^(?:show|display|put) .+? (?:on|in) (.+)$/u.exec(show.replace(keepStatus, ''))?.[1];
  const exactIds = [...instruction.matchAll(/\bid:([a-z0-9-]+)/giu)].map(match => match[1] ?? '');
  return targetList?.split(' and ').map(value => {
    const name = optionalArticle(value);
    const id = exactIds.find(candidate => name === `id ${normalizedControlText(candidate)}`);
    return id === undefined ? name : `id:${id.toLowerCase()}`;
  });
}
type CatalogArtEffect = Readonly<Record<string, unknown>>;

export function namedControlTargets(proposal: BoundControl['proposal'], instruction: string, targets: readonly (readonly string[])[]): readonly (readonly string[])[] {
  const words = explicitWords(instruction);
  const subject = words === undefined ? undefined : setting(words, '', instruction, '', proposal, false)?.subject;
  return subject === undefined ? [] : targets.filter(aliases => aliases.some(name => normalizedControlText(name) === subject));
}

/** The current owner supplies the action and setting. A clarification can resolve a detail in that request. */
export function authorizesControl(proposal: BoundControl['proposal'], instruction: string, answer: string,
  targets: readonly (readonly string[])[], precedingOwnerText: string, knownTargets: readonly (readonly string[])[] = [], knownArtwork = false, explicitGroup = false, draftRevision?: number, artRecipientsBound = false): boolean {
  if (exactCatalogRequest(proposal, instruction)) return true;
  const requested = explicitWords(instruction);
  if (requested === undefined) return false;
  const words = knownArtwork && proposal.family === 'catalog-action' && proposal.command === 'art-show'
    ? /\band ((?:show|display|put) .+)$/u.exec(requested)?.[1] ?? requested : requested;
  const choice = answer === '' ? '' : explicitWords(answer);
  if (choice === undefined) return false;
  const selected = setting(words, choice, instruction, answer, proposal, knownArtwork, draftRevision);
  if (selected === undefined) return false;
  if (selected.recipients !== undefined) {
    if (artRecipientsBound) return true;
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
