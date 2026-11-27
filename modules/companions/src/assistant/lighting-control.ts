import {ASSISTANT_LIGHT_OWNER, type AssistantDeviceAction} from '@jimmie-potts/event-contracts/v2/assistant';
import {assistantRoutes, type CatalogProposal, type ObservationBasis} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {catalogCommand} from './catalog-tools.js';
import {containsControlValue, controlExclusion, explicitWords, normalizedControlText, ownerCancelled, ownerRequestClauses} from './control-intent.js';
import {currentObservationBasis, deviceLabel, type LifxDeviceFacts, type OwnedDevice} from '@jimmie-potts/sdk';
import {controlReferenceIds, exactControlIds, resolveModelControl, type ControlReference, type ControlResolution, type ModelControlScope} from './model-control.js';
import {SET_LIFX_BRIGHTNESS, SET_LIFX_POWER} from './tool-scope.js';
import type {ToolCall} from './provider.js';

type Family = 'power-set' | 'brightness-set' | 'lifx-color-set' | 'lifx-temperature-set';
type Settings = {family: 'power-set'; data: {on: boolean}}
  | {family: 'brightness-set'; data: {percent: number}}
  | {family: 'lifx-color-set'; data: {hue: number; saturation: number}}
  | {family: 'lifx-temperature-set'; data: {kelvin: number}};
export type LightingDevice = OwnedDevice & {light?: LifxDeviceFacts};

export const LIGHTING_OWNERS = [...new Set([ASSISTANT_LIGHT_OWNER, ...assistantRoutes['power-set'].owners,
  ...assistantRoutes['brightness-set'].owners])];

export function lightingFamily(name: string): Family | undefined {
  if (name === SET_LIFX_POWER) return 'power-set';
  if (name === SET_LIFX_BRIGHTNESS) return 'brightness-set';
  const family = catalogCommand(name);
  return family === 'power-set' || family === 'brightness-set' || family === 'lifx-color-set' || family === 'lifx-temperature-set' ? family : undefined;
}

const integerIn = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

type SettingIntent = {family: 'power-set'; on: boolean}
  | {family: 'brightness-set' | 'lifx-temperature-set'; quantity: Quantity}
  | {family: 'lifx-color-set'; hue: NumericQuantity; saturation?: NumericQuantity};

function settings(family: Family, data: Record<string, unknown>): SettingIntent | undefined {
  const {on, percent, hue, saturation, kelvin} = data;
  const count = Object.keys(data).length;
  switch (family) {
    case 'power-set': return count === 1 && typeof on === 'boolean' ? {family, on} : undefined;
    case 'brightness-set':
    case 'lifx-temperature-set': {
      const requested = quantity(family === 'brightness-set' ? percent : kelvin);
      return count === 1 && requested !== undefined && (family === 'brightness-set' || requested.kind !== 'missing')
        ? {family, quantity: requested} : undefined;
    }
    case 'lifx-color-set': {
      const angle = quantity(hue);
      const strength = quantity(saturation);
      if (angle?.kind !== 'absolute') return undefined;
      if (count === 1) return {family, hue: angle};
      return count === 2 && strength?.kind === 'absolute' ? {family, hue: angle, saturation: strength} : undefined;
    }
  }
}

export function lightingReference({owner, device, light}: LightingDevice, allowed: boolean): ControlReference {
  return {id: device.id, label: deviceLabel(device), allowed, eligible: false, binding: JSON.stringify([owner,
    device.configurationRevision, device.generation, device.capabilities.power, device.capabilities.brightness, light?.capabilities])};
}

export type LightingControlScope = ModelControlScope & {
  readonly qualifiedTargets?: ReadonlySet<string>;
  readonly ambiguousHistory?: ReadonlySet<string>;
};

export function qualifiedLightingOwner(rows: readonly LightingDevice[], text: string): string | undefined {
  const matches = new Set(rows.flatMap(({owner, device}) => {
    const name = owner.split('/').at(-1);
    return name !== undefined && [device.id, deviceLabel(device)].some(label => containsControlValue(text, `${name} ${label}`))
      ? [owner] : [];
  }));
  return matches.size === 1 ? [...matches][0] : undefined;
}

/** Keep collisions in an owner excerpt, independently of the model's proposed selector. */
export function updateLightingGrounding(ambiguous: Set<string>, rows: readonly LightingDevice[], text: string): void {
  const explicit = exactControlIds(text);
  const owner = qualifiedLightingOwner(rows, text);
  const candidates = rows.filter(row => owner === undefined || row.owner === owner);
  const keys = (device: DeviceRecord) => new Set([device.id, deviceLabel(device)].map(normalizedControlText));
  const byName = new Map<string, string[]>();
  const names = explicit.reduce((grounded, id) => grounded.replaceAll(`id:${id}`, ' '), text);
  for (const {device} of candidates) {
    if (explicit.includes(device.id)) ambiguous.delete(device.id);
    for (const key of keys(device)) {
      if (!containsControlValue(names, key)) continue;
      byName.set(key, [...(byName.get(key) ?? []), device.id]);
    }
  }
  for (const ids of byName.values()) for (const id of ids) ambiguous.delete(id);
  for (const ids of byName.values()) {
    if (ids.length > 1) for (const id of ids) if (!explicit.includes(id)) ambiguous.add(id);
  }
}

export function resolveLightingTarget(scope: LightingControlScope, target: string): ControlResolution<null> {
  const qualified = scope.qualifiedTargets;
  const references = qualified === undefined ? scope.references : scope.references.filter(reference => qualified.has(reference.id));
  const named = controlReferenceIds(references, scope.request.text);
  const answered = references.find(reference => reference.id === scope.answer?.text.trim());
  if (scope.exactTargets.length === 0 && named.length > 1 && answered === undefined) {
    return {kind: 'clarify', targets: references.filter(reference => reference.allowed && named.includes(reference.id)).map(reference => reference.id)};
  }
  const result = resolveModelControl({...scope, references}, {requestId: scope.request.id,
    selection: {kind: 'references', targets: [target], contextTargets: []}, settings: null}, false, 1);
  const resolved = result.kind === 'ready' ? result.targets[0] : undefined;
  if (resolved !== undefined && scope.exactTargets.length === 0 && !named.includes(resolved) && answered?.id !== resolved &&
      scope.ambiguousHistory?.has(resolved) === true) {
    return {kind: 'clarify', targets: [], exactIds: true};
  }
  return result;
}

export function lightingControl(call: ToolCall, family: Family) {
  const native = call.name === SET_LIFX_POWER || call.name === SET_LIFX_BRIGHTNESS;
  const target = native ? call.input.device : call.input.target;
  const owner = native ? ASSISTANT_LIGHT_OWNER : call.input.owner;
  if (typeof target !== 'string' || target.length === 0 || target.length > 131 || typeof owner !== 'string') return undefined;
  let data: unknown;
  if (native) {
    const {device: _, ...value} = call.input;
    if (family === 'brightness-set' && 'operation' in value) {
      const {operation, percent, literal, startingLiteral} = value;
      if (Object.keys(value).length !== 4 || typeof literal !== 'string' || typeof startingLiteral !== 'string') return undefined;
      if (operation === 'minimum' || operation === 'maximum' || operation === 'missing') {
        if (percent !== 0 || startingLiteral !== '' || operation === 'missing' && literal !== '') return undefined;
        data = {percent: {kind: operation, ...(literal === '' ? {} : {literal})}};
      } else {
        data = {percent: {kind: operation, amount: percent, ...(literal === '' ? {} : {literal}), ...(startingLiteral === '' ? {} : {startingLiteral})}};
      }
    } else data = value;
  } else {
    if (typeof call.input.arguments !== 'string' || call.input.arguments.length > 256 || Object.keys(call.input).length !== 3) return undefined;
    try {data = JSON.parse(call.input.arguments);} catch {return undefined;}
  }
  if (!object(data)) return undefined;
  const setting = settings(family, data);
  return setting === undefined ? undefined : {owner, target, setting};
}

type QuantityUnit = 'percent' | 'percentage points' | 'kelvin' | 'degrees';
const NUMERIC_OPERATIONS = ['absolute', 'increase', 'decrease', 'increase-percent', 'decrease-percent'] as const;
type NumericOperation = typeof NUMERIC_OPERATIONS[number];
type NumericQuantity = {kind: NumericOperation; amount: number; literal?: string; startingLiteral?: string; unit?: string};
type Quantity = NumericQuantity | {kind: 'minimum' | 'maximum'; literal?: string} | {kind: 'missing'; literal?: never};

const QUANTITY_UNITS: Record<string, QuantityUnit | undefined> = {
  '%': 'percent', percent: 'percent', k: 'kelvin', kelvin: 'kelvin',
  '°': 'degrees', degree: 'degrees', degrees: 'degrees',
  'percentage point': 'percentage points', 'percentage points': 'percentage points', pp: 'percentage points',
};
const UNIT_SPELLING = String.raw`%|percentage points?\b|pp\b|percent\b|kelvin\b|k\b|°(?!\p{L})|degrees?\b`;
const QUANTITY_TOKEN = new RegExp(String.raw`(?<![\p{L}\p{N}_])((?:\p{N}[\p{N}.,]*(?:\p{Zs}+\p{N}[\p{N}.,]*)*|\.\p{N}+)(?:(?:\s*[/⁄∕／]\s*|[eE][+\-−]?)\p{N}[\p{N}.,]*)?)(?:\s*(${UNIT_SPELLING}))?`, 'giu');
const WHOLE_NUMBER = /^(?:\d+|\d{1,3}(?:(?:,\d{3})+|(?:\p{Zs}\d{3})+))(?:\.\d+)?$/u;
const SIGN_TOKEN = /(\b(?:(?:plus\s+or\s+minus|minus\s+or\s+plus)|minus|negative|plus|positive)\b|\+\s*[/⁄∕／]\s*[−﹣－–—-]|[−﹣－–—-]\s*[/⁄∕／]\s*\+|[±∓+−﹣－–—-])\s*/giu;
const POSITIVE_SIGN = /^(?:plus|positive|\+)$/iu;
const NEGATIVE_SIGN = /^(?:minus|negative|[−﹣－–—-])$/iu;
const ATTACHED_SIGN = /[\p{L}\p{N}_]$/u;
const ATTACHED_QUANTITY = /^(?:[\p{N}\p{Cf}_]|[+−﹣－–—-][+−﹣－–—\p{N}-]|\s*[/⁄∕／])/u;
const BARE_QUANTITY_END = /^(?:\s*$|\s*[.,;!?)\]](?:\s|$)|\s+(?:to|on|for|at|from|and|or|then|brighter|dimmer|warmer|cooler|brightness|saturation|please|now)\b|\s+in\s+(?:the|my|our|your|this|that)\b|\s+of\s+(?:(?:the|its|current)\s+)*(?:brightness|temperature|level|setting|maximum|minimum)\b)/iu;
const NUMBER_WORDS: Readonly<Record<string, number | undefined>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000, dozen: 12,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');
const WRITTEN_NUMBER = new RegExp(String.raw`\b(?:${NUMBER_WORD})(?:(?:[ -]| and )(?:${NUMBER_WORD}))*\b`, 'giu');
const STATED_UNIT = new RegExp(String.raw`^\s*(${UNIT_SPELLING})`, 'iu');
const UNIT_INTRODUCER = /^\s+in\s+/iu;
const LOCATION = /^(?:the|my|our|your|this|that)\b/iu;
const PROPERTY_UNIT = /\b(?:brightness|temperature|hue|saturation)\s+in\s+([^.!?;]+?)(?=\s+(?:to|by|at)\b|[.!?;]|$)/giu;
const QUALITATIVE_AMOUNT = /\b(?:half|(?:(?:a|one|two|three|four) )?quarters?|a (?:bit|few|couple))\b/giu;

type QuantityToken = {literal: string; value: number; unit?: QuantityUnit | 'unsupported' | undefined; conflictingSign?: true};
type Sign = {start: number; factor: -1 | 1 | 'conflict' | 'malformed'};

function signSpans(text: string): ReadonlyMap<number, Sign> {
  const spans = new Map<number, Sign>();
  let end = -1;
  for (const match of text.matchAll(SIGN_TOKEN)) {
    const prior = match.index === end ? spans.get(end) : undefined;
    const sign = match[1] ?? '';
    const start = prior?.start ?? match.index;
    const attached = ATTACHED_SIGN.test(text.slice(Math.max(0, start - 2), start));
    const factor = attached ? 'malformed' : prior !== undefined ? 'conflict' : NEGATIVE_SIGN.test(sign) ? -1
      : POSITIVE_SIGN.test(sign) ? 1 : 'conflict';
    end = match.index + match[0].length;
    // A run is scanned independently of the amount that may follow it.
    spans.set(end, {start, factor});
  }
  return spans;
}

function signedQuantity(text: string, start: number, literal: string, value: number, signs: ReadonlyMap<number, Sign>): Pick<QuantityToken, 'literal' | 'value' | 'conflictingSign'> {
  const sign = signs.get(start);
  if (sign === undefined) return {literal, value};
  const complete = text.slice(sign.start, start) + literal;
  if (sign.factor === 'malformed') return {literal: complete, value: Number.NaN};
  return sign.factor === 'conflict' ? {literal: complete, value: Number.NaN, conflictingSign: true}
    : {literal: complete, value: sign.factor * value};
}

function writtenValue(words: string): number {
  let total = 0, group = 0, tail = 0, largestRemainingScale = Number.POSITIVE_INFINITY;
  for (const word of words.toLowerCase().split(/ and |[ -]/u)) {
    const value = NUMBER_WORDS[word];
    if (value === undefined) return Number.NaN;
    if (value >= 1000) {
      if (value >= largestRemainingScale || group + tail === 0) return Number.NaN;
      total += (group + tail) * value;
      largestRemainingScale = value;
      group = 0;
      tail = 0;
    } else if (value === 100) {
      if (group !== 0 || tail < 1 || tail > 9) return Number.NaN;
      group = tail * 100;
      tail = 0;
    } else {
      if (tail !== 0 && (tail < 20 || tail % 10 !== 0 || value > 9)) return Number.NaN;
      tail += value;
    }
  }
  return total + group + tail;
}

function followingUnit(suffix: string): {literal: string; unit: QuantityToken['unit']} {
  const introduced = UNIT_INTRODUCER.exec(suffix)?.[0] ?? '';
  const introducer = LOCATION.test(suffix.slice(introduced.length).trimStart()) ? '' : introduced;
  const known = STATED_UNIT.exec(suffix.slice(introducer.length));
  const literal = introducer + (known?.[0] ?? '');
  const end = suffix.slice(literal.length);
  if (introducer !== '' && known === null ||
      !BARE_QUANTITY_END.test(end) && !/^\s+(?:(?:the|its) )?brightness\b/iu.test(end)) {
    return {literal, unit: 'unsupported'};
  }
  return {literal, unit: known?.[1] === undefined ? undefined : QUANTITY_UNITS[known[1].toLowerCase()]};
}

function writtenQuantities(text: string, signs: ReadonlyMap<number, Sign>): QuantityToken[] {
  return [...text.matchAll(WRITTEN_NUMBER)].flatMap(match => {
    const [words] = match;
    const suffix = text.slice(match.index + words.length);
    if (/^\s+quarters?\b/iu.test(suffix)) return [];
    // In these references “one” identifies the light. It does not supply its setting.
    if (words.toLowerCase() === 'one' && !signs.has(match.index) &&
        /\b(?:the|this|that|which|another)\s+$/iu.test(text.slice(0, match.index)) && !STATED_UNIT.test(suffix)) return [];
    const {literal, unit} = followingUnit(suffix);
    return [{...signedQuantity(text, match.index, words + literal, writtenValue(words), signs), unit}];
  });
}

function withoutLightingName(device: DeviceRecord, text: string, settingEvidence = false): string {
  if (!settingEvidence && exactControlIds(text).includes(device.id)) return text;
  for (const reference of new Set([device.id, deviceLabel(device)])) {
    const name = normalizedControlText(reference);
    if (!/\p{L}/u.test(name) || !settingEvidence && !/\p{N}/u.test(name)) continue;
    const words = name.split(' ').join('[^\\p{L}\\p{N}]+');
    const mention = new RegExp(`(?<![\\p{L}\\p{N}_])${words}(?![\\p{L}\\p{N}_])`, 'giu');
    // Keep a number when the spelling could be part of a requested quantity rather than the target alone.
    text = text.replace(mention, (matched: string, offset: number, whole: string) => {
      const after = whole.slice(offset + matched.length).replace(/^["'”’]/u, '');
      return followingUnit(after).unit === undefined ? ' ' : matched;
    });
  }
  return text;
}

function quantityTokens(text: string): QuantityToken[] {
  // Exact device selectors can contain numbers. The model selects quantities from the rest of the owner message.
  const clean = text.replace(/\bid:[^\s]+/giu, ' ');
  const signs = signSpans(clean);
  let end = 0;
  const tokens = [...clean.matchAll(QUANTITY_TOKEN)].flatMap(match => {
    const [, number, suffix] = match;
    if (number === undefined) return [];
    const skippedNumber = /\p{N}/u.test(clean.slice(end, match.index));
    end = match.index + match[0].length;
    const raw = suffix === undefined ? number.trim().replace(/[.,]$/u, '') : number.trim();
    const remainder = clean.slice(end);
    const malformed = skippedNumber || !WHOLE_NUMBER.test(raw) || ATTACHED_QUANTITY.test(remainder) ||
      suffix !== undefined && /^[\p{L}\p{S}%‰‱_]/u.test(remainder);
    const rest = suffix === undefined && /[.,]$/u.test(number) && !/^\S/u.test(remainder)
      ? {literal: '', unit: undefined} : followingUnit(remainder);
    const unit = suffix === undefined ? rest.unit : rest.unit === undefined ? QUANTITY_UNITS[suffix.toLowerCase()] : 'unsupported';
    const literal = suffix === undefined ? raw + rest.literal : match[0].trim();
    const value = malformed ? Number.NaN : Number(raw.replace(/[,\p{Zs}]/gu, ''));
    return [{...signedQuantity(clean, match.index, literal, value, signs), unit}];
  });
  if (/\p{N}/u.test(clean.slice(end))) tokens.push({literal: '', unit: undefined, value: Number.NaN});
  return [...tokens, ...writtenQuantities(clean, signs)];
}

function numericOperation(value: unknown): value is NumericOperation {
  return NUMERIC_OPERATIONS.some(operation => operation === value);
}

function quantity(value: unknown): Quantity | undefined {
  if (typeof value === 'number') return {kind: 'absolute', amount: value};
  if (!object(value)) return undefined;
  const {kind, amount, literal, startingLiteral, unit} = value;
  const size = Object.keys(value).length;
  const citation = (source: unknown): source is string => typeof source === 'string' && source.length > 0 && source.length <= 48;
  if (kind === 'missing') return size === 1 ? {kind} : undefined;
  if (kind === 'minimum' || kind === 'maximum') {
    if (size === 1) return {kind};
    return size === 2 && citation(literal) ? {kind, literal} : undefined;
  }
  if (!numericOperation(kind) || typeof amount !== 'number' || !Number.isSafeInteger(amount) ||
      literal !== undefined && !citation(literal) ||
      startingLiteral !== undefined && (kind !== 'absolute' || literal === undefined || !citation(startingLiteral)) ||
      unit !== undefined && !citation(unit) ||
      size !== 2 + Number(literal !== undefined) + Number(startingLiteral !== undefined) + Number(unit !== undefined)) return undefined;
  return {kind, amount, ...(literal === undefined ? {} : {literal}), ...(startingLiteral === undefined ? {} : {startingLiteral}), ...(unit === undefined ? {} : {unit})};
}

function supportsQuantity(tokens: ReturnType<typeof quantityTokens>, unit: QuantityUnit, requested: Quantity, answerOnly = false,
  otherColor?: {unit: 'degrees' | 'percent'; amount: number | undefined}): boolean {
  const available = otherColor === undefined ? tokens : tokens.filter(token => token.unit !== otherColor.unit);
  if (available.some(token => token.unit !== undefined && token.unit !== unit || !Number.isSafeInteger(token.value))) return false;
  // An unqualified hue or saturation can accompany the other field's explicit unit.
  const companion = otherColor?.amount !== undefined && available.some(token => token.unit === unit) &&
    !tokens.some(token => token.unit === otherColor.unit)
    ? available.filter(token => token.unit === undefined && token.value === otherColor.amount) : [];
  const candidates = companion.length === 1 ? available.filter(token => token !== companion[0]) : available;
  if (!('amount' in requested)) return candidates.length === 0;
  if (requested.unit !== undefined && QUANTITY_UNITS[requested.unit.toLowerCase()] !== unit) return false;
  if (answerOnly && candidates.length !== 1) return false;
  if (requested.startingLiteral !== undefined) {
    return candidates.length === 2 && candidates.some(token => token.literal === requested.startingLiteral) &&
      requested.startingLiteral !== requested.literal &&
      candidates.some(token => token.literal === requested.literal && token.value === requested.amount);
  }
  if (candidates.length === 0) return !answerOnly && requested.literal === undefined;
  return candidates.length === 1 && candidates[0]?.value === requested.amount &&
    (requested.literal === undefined || candidates[0].literal === requested.literal);
}

type LightingValue = {kind: 'ready'; setting: Settings; observationBasis?: ObservationBasis}
  | {kind: 'refused'; code: ErrorCode}
  | {kind: 'unchanged'; value: number; unit: QuantityUnit; atBoundary: boolean}
  | {kind: 'missing-saturation'; hue: number; unsupportedUnit?: true}
  | {kind: 'quantity-clarification'; unit: QuantityUnit; operation: Quantity['kind'] | 'color'; reason: 'unit' | 'sign' | 'missing'};

export function lightingValue(row: LightingDevice, scope: ModelControlScope, intent: SettingIntent, now: number,
  previous?: LightingClarification): LightingValue {
  const {family} = intent;
  if (family === 'power-set') return {kind: 'ready', setting: {family, data: {on: intent.on}}};
  const invalid = {kind: 'refused', code: 'invalid-request'} as const;
  const brightness = family === 'brightness-set';
  const ownerRequest = brightness ? brightnessSource(scope.request.text) : {text: scope.request.text, replacement: false};
  const ownerAnswer = scope.answer === undefined ? undefined
    : brightness ? brightnessSource(scope.answer.text) : {text: scope.answer.text, replacement: false};
  if (ownerRequest === undefined || scope.answer !== undefined && ownerAnswer === undefined) return invalid;
  const request = withoutLightingName(row.device, ownerRequest.text);
  const answer = ownerAnswer === undefined ? undefined : withoutLightingName(row.device, ownerAnswer.text);
  if (family === 'lifx-color-set') {
    const {hue, saturation} = intent;
    const color = previous?.kind === 'quantity-clarification' ? answer : request;
    if (color === undefined) return invalid;
    let hueTokens = quantityTokens(color);
    if (hueTokens.some(token => token.conflictingSign)) return {kind: 'quantity-clarification', unit: 'degrees', operation: 'color', reason: 'sign'};
    if (!integerIn(hue.amount, 0, 360)) return invalid;
    if (hasUnsupportedUnit(color, hueTokens, 'degrees', 'percent')) {
      const degrees = hueTokens.filter(token => token.unit === 'degrees');
      if (degrees.length !== 1 || !supportsQuantity(degrees, 'degrees', hue)) {
        return {kind: 'quantity-clarification', unit: 'degrees', operation: 'color', reason: 'unit'};
      }
      if (previous?.kind !== 'missing-saturation') return {kind: 'missing-saturation', hue: hue.amount, unsupportedUnit: true};
      hueTokens = degrees;
    }
    if (!supportsQuantity(hueTokens, 'degrees', hue,
      previous?.kind === 'quantity-clarification', {unit: 'percent', amount: saturation?.amount})) return invalid;
    if (saturation === undefined) return {kind: 'missing-saturation', hue: hue.amount};
    const source = previous?.kind === 'missing-saturation' ? answer : color;
    if (source === undefined || !integerIn(saturation.amount, 0, 100)) return invalid;
    const saturationTokens = source === color ? hueTokens : quantityTokens(source);
    if (previous?.kind === 'missing-saturation' &&
        (saturationTokens.some(token => token.conflictingSign) || hasUnsupportedUnit(source, saturationTokens, 'percent'))) {
      return {kind: 'missing-saturation', hue: previous.hue, unsupportedUnit: true};
    }
    if (!supportsQuantity(saturationTokens, 'percent', saturation, previous !== undefined,
      previous?.kind === 'missing-saturation' ? undefined : {unit: 'degrees', amount: hue.amount})) return invalid;
    return {kind: 'ready', setting: {family, data: {hue: hue.amount, saturation: saturation.amount}}};
  }
  if (!('quantity' in intent)) return invalid;
  const {quantity: requested} = intent;
  const unit = brightness ? 'percent' : 'kelvin';
  const range = brightness ? row.device.capabilities.brightness : row.light?.capabilities.temperature;
  if (range === undefined) return {kind: 'refused', code: 'unavailable'};
  if (!range.supported) return {kind: 'refused', code: 'unsupported-capability'};
  const {minimum, maximum} = range;
  const supplied = answer === undefined ? [] : quantityTokens(answer);
  const answering = previous?.kind === 'quantity-clarification';
  const useAnswer = answer !== undefined && (answering || !brightness && supplied.length > 0);
  const source = useAnswer ? answer : request;
  const brightnessEvidence = useAnswer ? ownerAnswer : ownerRequest;
  const stated = brightness && brightnessEvidence !== undefined
    ? statedBrightness(row.device, brightnessEvidence.text, maximum, answering || brightnessEvidence.replacement) : undefined;
  if (stated?.kind === 'invalid') return invalid;
  if (stated !== undefined) {
    if (propertyUnits(source).some(unit => unit !== 'percent') ||
        answering && (previous.unit !== 'percent' || previous.operation !== 'absolute')) return invalid;
    if (stated.kind === 'fraction-of-current') {
      if (answering) return invalid;
      const basis = currentObservationBasis(row, 'brightness', now, row.light);
      if (basis === undefined || !integerIn(basis.value, minimum, maximum)) return {kind: 'refused', code: 'unavailable'};
      return relativeLightingValue(family, basis, basis.value * stated.amount, minimum, maximum);
    }
    const value = stated.kind === 'absolute' ? stated.amount : stated.kind === 'minimum' ? minimum : maximum;
    return integerIn(value, minimum, maximum) ? {kind: 'ready', setting: {family: 'brightness-set', data: {percent: value}}} : invalid;
  }
  const tokens = useAnswer ? supplied : quantityTokens(request);
  if (requested.kind === 'missing') {
    return answering ? invalid : {kind: 'quantity-clarification', unit, operation: 'absolute', reason: 'missing'};
  }
  const relative = 'amount' in requested && requested.kind !== 'absolute';
  const proportional = 'amount' in requested && (requested.kind === 'increase-percent' || requested.kind === 'decrease-percent');
  if (proportional && !brightness) return invalid;
  const requestedUnit = brightness && relative && !proportional ? 'percentage points' : unit;
  if (previous?.kind === 'quantity-clarification' &&
      (answer === undefined || previous.unit !== requestedUnit || previous.operation !== requested.kind)) return invalid;
  if (tokens.some(token => token.conflictingSign)) {
    return {kind: 'quantity-clarification', unit: requestedUnit, operation: requested.kind, reason: 'sign'};
  }
  if (hasUnsupportedUnit(source, tokens, unit, brightness ? 'percentage points' : undefined)) {
    return {kind: 'quantity-clarification', unit: requestedUnit, operation: requested.kind, reason: 'unit'};
  }
  const qualitative = !brightness && tokens.length === 0 && previous === undefined && qualitativeSetting(row.device, scope.request.text, requested);
  if (tokens.length === 0 && previous === undefined && !qualitative) {
    return {kind: 'quantity-clarification', unit: requestedUnit, operation: 'amount' in requested ? requested.kind : 'absolute', reason: 'missing'};
  }
  const supported = qualitative
    ? !('unit' in requested) || requested.unit === undefined || QUANTITY_UNITS[requested.unit.toLowerCase()] === requestedUnit
    : (!brightness || 'amount' in requested) && supportsQuantity(tokens, requestedUnit, requested, answering);
  if (!supported || propertyUnits(source).some(stated => stated !== requestedUnit)) return invalid;
  if (!('amount' in requested)) return numericLightingValue(family, requested.kind === 'minimum' ? minimum : maximum);
  if (requested.kind === 'absolute') {
    return integerIn(requested.amount, minimum, maximum) ? numericLightingValue(family, requested.amount) : invalid;
  }
  if (!integerIn(requested.amount, 1, proportional ? 100 : maximum - minimum)) return invalid;
  const basis = currentObservationBasis(row, brightness ? 'brightness' : 'temperature', now, row.light);
  if (basis === undefined || !integerIn(basis.value, minimum, maximum)) return {kind: 'refused', code: 'unavailable'};
  const delta = proportional ? basis.value * requested.amount / 100 : requested.amount;
  const next = requested.kind === 'increase' || requested.kind === 'increase-percent' ? basis.value + delta : basis.value - delta;
  return relativeLightingValue(family, basis, next, minimum, maximum);
}

function numericLightingValue(family: 'brightness-set' | 'lifx-temperature-set', value: number): Extract<LightingValue, {kind: 'ready'}> {
  return {kind: 'ready', setting: family === 'brightness-set' ? {family, data: {percent: value}} : {family, data: {kelvin: value}}};
}

function relativeLightingValue(family: 'brightness-set' | 'lifx-temperature-set', basis: ObservationBasis,
  next: number, minimum: number, maximum: number): LightingValue {
  const value = Math.max(minimum, Math.min(maximum, Math.round(next)));
  return value === basis.value ? {kind: 'unchanged', value, unit: family === 'brightness-set' ? 'percent' : 'kelvin',
    atBoundary: next < minimum || next > maximum} : {...numericLightingValue(family, value), observationBasis: basis};
}

export type LightingQuestion = {
  requestId: string; owner: string; target: string;
  reference: string; modeRevision: number | null;
} & ({kind: 'missing-saturation'; hue: number; unitClarified?: true}
  | {kind: 'quantity-clarification'; family: Family; unit: QuantityUnit; operation: Quantity['kind'] | 'color'});

export type LightingClarification = LightingQuestion & {questionId: string};

type StatedBrightness = {kind: 'absolute' | 'fraction-of-current'; amount: number} | {kind: 'minimum' | 'maximum' | 'invalid'};

function brightnessSource(text: string): {text: string; replacement: boolean} | undefined {
  if (ownerCancelled.test(text)) return undefined;
  const clauses = ownerRequestClauses(text);
  const correction = /^\s*(?:actually|instead)\b(?!\s+of)/iu;
  const revised = clauses.map(clause => correction.test(clause)).lastIndexOf(true);
  const affirmative = clauses.slice(Math.max(0, revised)).map(clause =>
    controlExclusion(clause.replace(/^\s*(?:actually|instead)\b[,:]?\s*/iu, '')).affirmative.trim()).filter(Boolean);
  return affirmative.length === 0 ? undefined : {text: affirmative.join(' '), replacement: revised >= 0};
}

const fractionWords: Readonly<Record<string, number | undefined>> = {half: 2, third: 3, quarter: 4, fourth: 4, fifth: 5, eighth: 8};

function statedBrightness(device: DeviceRecord, text: string, maximum: number, answering: boolean): StatedBrightness | undefined {
  const source = withoutLightingName(device, text.replace(/\b(?:use\s+)?id:[^\s]+/giu, ' '), true);
  const words = explicitWords(source);
  if (words === undefined || /(?:^|[\s(])['‘][^'’]+['’](?=$|[\s.,!?])/u.test(source)) return undefined;
  if (/^halve (?:the |its )?(?:current )?brightness(?: (?:of|on|for))?$/u.test(words)) return {kind: 'fraction-of-current', amount: 0.5};

  // Parse a complete setting or answer. A bound mentioned in a comparison
  // such as "anything below maximum" is not the selected setting.
  const operative = /^(?:set|change|make) (?:.+? )?to (.+)$/u.exec(words);
  const operand = operative === null ? undefined : operative[1];
  const direct = /^(?:use|set) (?:the )?(minimum|min|maximum|max|full) brightness(?: please)?$/u.exec(words)?.[1];
  const bound = direct ?? /^(?:the )?(minimum|min|maximum|max|full)(?: brightness)?(?: please)?$/u
    .exec(operand !== undefined && !/\bup to\b/u.test(words) ? operand : answering ? words : '')?.[1];
  if (bound !== undefined) return {kind: bound === 'minimum' || bound === 'min' ? 'minimum' : 'maximum'};
  const extreme = /^(?:make|set) .+ as (bright|dim) as possible(?: please)?$/u.exec(words)?.[1];
  if (extreme !== undefined) return {kind: extreme === 'bright' ? 'maximum' : 'minimum'};

  const fractions = [...source.matchAll(/(?<![\p{L}\p{N}_+−-])((?:(?:a|one|two|three|four|five|six|seven)[ -])?(?:half|thirds?|quarters?|fourths?|fifths?|eighths?)|[¼-¾⅐-⅞]|\d+\s*[/⁄∕／]\s*\d+)(?:\s*(%|percent\b))?(?:\s+(of (?:the )?(?:(?:maximum|current)(?: brightness)?|brightness)))?/giu)];
  if (fractions.length !== 1) return fractions.length > 1 ? {kind: 'invalid'} : undefined;
  const [match] = fractions;
  if (match === undefined || match[1] === undefined) return {kind: 'invalid'};
  const [literal, fraction, percent, basis] = match;
  const before = source.slice(0, match.index), tail = source.slice(match.index + literal.length).trim();
  const complete = /^(?:brightness(?: please)?|please)?[.!?]?$/iu.test(tail);
  const exactAnswer = answering && before.trim() === '' && complete;
  const slot = /^\s*(?:set|change|make|use)\b/iu.test(before) && complete &&
    (basis !== undefined || /^brightness\b/iu.test(tail) || /\bbrightness\s+to\s*$/iu.test(before));
  if (!exactAnswer && !slot && percent === undefined) return undefined;
  if (!complete || quantityTokens(before).length > 0 || signSpans(source).get(match.index) !== undefined ||
      percent !== undefined && basis !== undefined) return {kind: 'invalid'};
  const [word, denominatorWord] = fraction.toLowerCase().split(/[ -]/u);
  const wordDenominator = fractionWords[(denominatorWord ?? word ?? '').replace(/s$/u, '')];
  const [numerator, denominator] = wordDenominator === undefined ? fraction.normalize('NFKC').split(/[/⁄∕／]/u).map(Number)
    : [denominatorWord === undefined || word === 'a' ? 1 : NUMBER_WORDS[word ?? ''], wordDenominator];
  if (numerator === undefined || denominator === undefined || !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0 ||
      percent === undefined && numerator > denominator) return {kind: 'invalid'};
  const reference = basis?.toLowerCase() ?? '';
  if (reference.includes('current')) return {kind: 'fraction-of-current', amount: numerator / denominator};
  const scale = percent !== undefined ? 1 : reference.includes('maximum') ? maximum : 100;
  const scaled = numerator * scale;
  return Number.isSafeInteger(scaled) && scaled % denominator === 0
    ? {kind: 'absolute', amount: scaled / denominator} : {kind: 'invalid'};
}

function qualitativeSetting(device: DeviceRecord, request: string, proposed: Quantity): boolean {
  const source = withoutLightingName(device, request, true).replace(/\bid:[^\s]+/giu, ' ');
  const words = normalizedControlText(source);
  const evidence = proposed.literal;
  if (!('amount' in proposed)) {
    const other = proposed.kind === 'maximum' ? 'minimum' : 'maximum';
    if (containsControlValue(words, other)) return false;
    if (containsControlValue(words, proposed.kind) || /\bas [^,.!?;]+ as possible\b/iu.test(source)) return true;
  }
  if ('amount' in proposed && evidence === undefined && [...source.matchAll(QUALITATIVE_AMOUNT)].length > 0) return true;
  if (evidence === undefined || !/^[\p{L}][\p{L}\p{Zs}-]*$/u.test(evidence) || BARE_QUANTITY_END.test(` ${evidence}`)) return false;
  const value = normalizedControlText(evidence);
  return value !== '' && [...source.matchAll(/\b(?:to|at|by)\s+([^,.;!?]+?)(?=[,.;!?]|$)/giu)].some(match => {
    const setting = normalizedControlText(match[1] ?? '');
    return setting === value || setting.startsWith(`${value} `);
  });
}

function propertyUnits(text: string): Exclude<QuantityToken['unit'], undefined>[] {
  return [...text.matchAll(PROPERTY_UNIT)].flatMap(match => {
    const unit = match[1]?.trim();
    return unit === undefined || LOCATION.test(unit) ? [] : [QUANTITY_UNITS[unit.toLowerCase()] ?? 'unsupported'];
  });
}

function hasUnsupportedUnit(text: string, tokens: ReturnType<typeof quantityTokens>, unit: QuantityUnit,
  other?: QuantityUnit): boolean {
  const unsupported = (candidate: QuantityUnit | 'unsupported' | undefined) =>
    candidate !== undefined && candidate !== unit && candidate !== other;
  if (tokens.some(token => !Number.isSafeInteger(token.value))) return false;
  if (tokens.some(token => unsupported(token.unit))) return true;
  if (propertyUnits(text).some(unsupported)) return true;
  const clean = text.replace(/\bid:[^\s]+/giu, ' ');
  return [...clean.matchAll(QUALITATIVE_AMOUNT)].some(match =>
    unsupported(followingUnit(clean.slice(match.index + match[0].length)).unit));
}

export function lightingRefusal({owner, device, light}: LightingDevice, family: Family, native: boolean): ErrorCode | undefined {
  if (native ? owner !== ASSISTANT_LIGHT_OWNER : !assistantRoutes[family].owners.some(source => source === owner)) return 'unsupported-capability';
  if (device.availability !== 'available' || device.held !== undefined) return 'unavailable';
  switch (family) {
    case 'power-set': return device.capabilities.power.supported ? undefined : 'unsupported-capability';
    case 'brightness-set': return device.capabilities.brightness.supported ? undefined : 'unsupported-capability';
    case 'lifx-color-set': return light === undefined ? 'unavailable' : light.capabilities.color.supported ? undefined : 'unsupported-capability';
    case 'lifx-temperature-set': return light === undefined ? 'unavailable' : light.capabilities.temperature.supported ? undefined : 'unsupported-capability';
  }
}

export function planLightingControl(row: LightingDevice, setting: Settings, native: boolean): CatalogProposal | AssistantDeviceAction {
  const {owner, device: {id: target, configurationRevision, generation}} = row;
  if (native) {
    const guards = {expectedConfigurationRevision: configurationRevision, expectedGeneration: generation};
    if (setting.family === 'power-set') return {family: setting.family, target, data: {...setting.data, ...guards}};
    if (setting.family === 'brightness-set') return {family: setting.family, target, data: {...setting.data, ...guards}};
  }
  return {family: 'catalog-action', target, command: setting.family,
    binding: {kind: 'device', owner, target, configurationRevision, generation}, data: setting.data};
}
