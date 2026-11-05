// The exact-artwork handoff (Hub #679, docs/art-generation-qualification.md). `modules/art` may import only the SDK and
// the contracts, so it asks the core to forward its commands to the display modules. A job starts from `art-request`, for
// the owner, or `art-auto`, which the core's automation sends; the family decides, never `origin` or `purpose`. A display
// keeps its own private copy of a staged composition and later plays it by `compositionId` under `moment-play/2.1`. The
// in-process bus checks no sender. Art families bind requesters at the gateway and tracker; every responder must check
// its sender. The tracker does not gate moment-play's requester, so automation owns art-moment arbitration.
import {createHash} from 'node:crypto';
import {errorBody, type ErrorBody} from './errors.js';
import type {Message, MessageValidator, PayloadCheck} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

/** The only source the core forwards `art-dispatch` from, and the `requestedBy` of what it forwards. */
export const ART_MODULE_SOURCE = 'bunny/modules/art';
/** The subject and routing token of `art-request`, `art-auto` and `art-dispatch`. */
export const ART_SUBJECT = 'art';
/** The largest composition a stage carries, decoded: 160 KiB, which leaves a stage inside the 256 KiB message cap. */
export const MAX_ART_BYTES = 163_840;

export type ArtFormat = 'png' | 'gif';
export type ArtPurpose = 'request' | 'ambient' | 'appearance' | 'variation';
export type ArtTarget = 'ui' | 'tidbyt' | 'pixoo';
/** Descriptive only: the job's owner comes from its command family. */
export type ArtOrigin = {kind: 'owner' | 'schedule' | 'weather'; reference?: string};
/** Condition words only. There is no member for a location. */
export type ArtContext = {time?: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'; season?: 'spring' | 'summer' | 'autumn' | 'winter'; weather?: string};
export type ArtAutoStart = {requestId: string; action: 'start'; purpose: ArtPurpose; origin: ArtOrigin; context?: ArtContext; targets: ArtTarget[]; variationOf?: string};
export type ArtCancel = {requestId: string; action: 'cancel'; jobRequestId: string};
/** `org.bunny.art.request.requested`: the owner starts a job, or cancels any job, automatic or not. A cancel admits no work. */
export type ArtRequest = (ArtAutoStart & {text?: string}) | ArtCancel;
/** `org.bunny.art.auto.requested`: the core starts an automatic job. The automatic limits always apply. The owner cancels with `art-request`. */
export type ArtAuto = ArtAutoStart;
/** What a stage says about the one rendition it carries. */
export type ArtStageContent = {
  compositionId: string; format: ArtFormat; width: number; height: number; frames: number; durationMs: number;
  /** The SHA-256 of the decoded bytes, which the validator checks. */
  sha256: string;
  base64: string;
  /** How long the device keeps the copy, from when it admits this stage. Staging again renews it. */
  lifetimeMs: number;
};
/** `org.bunny.art.stage.requested`: a device validates the bytes and keeps a private copy, with no display effect. */
export type ArtStageRequest = ArtStageContent & {requestId: string};
export type ArtAmbientContent = {compositionId: string | null};
/** `org.bunny.art-ambient.set.requested`: a device's ambient tile shows this composition, or none when null. No takeover. */
export type ArtAmbientSetRequest = ArtAmbientContent & {requestId: string};
/** `org.bunny.art.dispatch.requested`: the art module asks the core to forward one tracked command. Never a moment. */
export type ArtDispatch = {requestId: string; target: string} & (
  | {family: 'art-stage'; data: ArtStageContent}
  | {family: 'art-ambient-set'; data: ArtAmbientContent}
);
/** The dispatchable families, each with the type and schema the core forwards it under. */
export const ART_FORWARDED = Object.freeze({
  'art-stage': Object.freeze({type: 'org.bunny.art.stage.requested', dataschema: 'https://bunny.invalid/events/art-stage/2.0'}),
  'art-ambient-set': Object.freeze({type: 'org.bunny.art-ambient.set.requested', dataschema: 'https://bunny.invalid/events/art-ambient-set/2.0'}),
});

/** A device's own record of a copy it holds. */
export type ArtCopy = {compositionId: string; sha256: string; expiresAtMs: number};
/**
 * What a device does with a stage: `store` a new copy or `reuse` the one it holds, in either case with the copy's renewed
 * record, or the refusal for the same ID with other bytes. An expired copy counts as no copy. `compositionId` is the
 * device's key, and a held copy is immutable.
 */
export function artStageDecision(held: ArtCopy | undefined, stage: Pick<ArtStageRequest, 'compositionId' | 'sha256' | 'lifetimeMs'>, nowMs: number): {action: 'store' | 'reuse'; copy: ArtCopy} | ErrorBody {
  const copy: ArtCopy = {compositionId: stage.compositionId, sha256: stage.sha256, expiresAtMs: nowMs + stage.lifetimeMs};
  if (held === undefined || held.expiresAtMs <= nowMs) return {action: 'store', copy};
  return held.sha256 === stage.sha256 ? {action: 'reuse', copy} : errorBody('duplicate-conflict', {detail: 'this device holds that composition with other bytes'});
}
/**
 * Why a device refuses a reference, before any effect: `not-found` for a copy it does not hold or one past its lifetime,
 * whose detail says so. Never `expired`: the tracker reads that code as a command that did not reach its owner, and this
 * one did. Undefined admits it. Admission is the only check: once a moment starts, the device keeps its copy for it.
 */
export function artReferenceRefusal(held: ArtCopy | undefined, nowMs: number): ErrorBody | undefined {
  if (held === undefined) return errorBody('not-found', {detail: 'this device holds no copy of that composition'});
  return held.expiresAtMs <= nowMs ? errorBody('not-found', {detail: 'this device\'s copy of that composition has lapsed; stage it again'}) : undefined;
}
/**
 * Why an art responder refuses a command's sender: `art-stage`, `art-ambient-set`, a moment naming art, `art-request` and
 * `art-auto` come only from the core's dispatcher, whatever `requestedBy` the tracker recorded. Undefined admits it.
 */
export function artCommandRefusal(source: string): ErrorBody | undefined {
  return source === 'bunny/core' ? undefined : errorBody('forbidden', {detail: 'art commands reach a responder only from the core'});
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The width and height the bytes' own header declares, or undefined when they are not that format. */
function headerSize(format: ArtFormat, bytes: Buffer): {width: number; height: number} | undefined {
  if (format === 'png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
    return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
  }
  const version = bytes.toString('latin1', 0, 6);
  if (bytes.length < 10 || (version !== 'GIF87a' && version !== 'GIF89a')) return undefined;
  return {width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8)};
}
/** Checks a stage's bytes against what it says, from their headers, with no image decoder on the bus thread. */
function stageIssue(stage: ArtStageContent): string | undefined {
  const bytes = Buffer.from(stage.base64, 'base64');
  if (bytes.toString('base64') !== stage.base64) return 'payload /base64 not canonical base64';
  if (bytes.length === 0 || bytes.length > MAX_ART_BYTES) return `payload /base64 not 1 to ${MAX_ART_BYTES} bytes`;
  if (createHash('sha256').update(bytes).digest('hex') !== stage.sha256) return 'payload /sha256 not the bytes\' hash';
  const size = headerSize(stage.format, bytes);
  if (size === undefined) return 'payload /format not the bytes\' format';
  if (size.width !== stage.width || size.height !== stage.height) return 'payload /width or /height not the bytes\' dimensions';
  return stage.frames > 1 && stage.durationMs === 0 ? 'payload /durationMs zero for several frames' : undefined;
}

const artSubject = (message: Message): string | undefined => message.subject === ART_SUBJECT ? undefined : `envelope /subject must be ${ART_SUBJECT}`;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const checkJob: PayloadCheck = message => {
  const data = message.data as ArtRequest;
  if (data.action !== 'start') return artSubject(message);
  if ((data.purpose === 'variation') !== (data.variationOf !== undefined)) return 'payload /variationOf only and always for a variation';
  if (data.text !== undefined && (data.text.trim() === '' || LONE_SURROGATE.test(data.text))) return 'payload /text blank or not Unicode scalar values';
  return artSubject(message);
};
const checkStage: PayloadCheck = message => routedSubject('device')(message) ?? stageIssue(message.data as ArtStageRequest);
const checkDispatch: PayloadCheck = message => {
  const data = message.data as ArtDispatch;
  return artSubject(message) ?? (data.family === 'art-stage' ? stageIssue(data.data) : undefined);
};

/** In registration order: `art-auto` and `art-dispatch` use definitions of the families before them. */
export const artFamilies = [
  defineFamily('art-request', 'command', 'org.bunny.art.request.requested', checkJob),
  defineFamily('art-auto', 'command', 'org.bunny.art.auto.requested', checkJob),
  defineFamily('art-stage', 'command', 'org.bunny.art.stage.requested', checkStage),
  defineFamily('art-ambient-set', 'command', 'org.bunny.art-ambient.set.requested', routedSubject('device')),
  defineFamily('art-dispatch', 'command', 'org.bunny.art.dispatch.requested', checkDispatch),
] as const;
export const artSchemas: Readonly<Record<string, object>> = Object.fromEntries(artFamilies.map(family => [family.dataschema, family.schema]));
export function registerArtFamilies(validator: MessageValidator): void { registerFamilies(validator, artFamilies); }
