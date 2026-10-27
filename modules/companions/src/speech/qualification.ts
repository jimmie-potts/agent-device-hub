import {closeSync, constants, fstatSync, openSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {speechQualification, type SpeechQualification} from '../speech-qualification.js';
export const SPEECH_QUALIFICATION_FILE = 'speech-qualification.json';
const MAX_BYTES = 4096;

/** This private installation receipt supplies a selected identity, never session availability. */
export function readSpeechQualification(directory: string): SpeechQualification | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(join(directory, SPEECH_QUALIFICATION_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES || stat.uid !== process.getuid?.()) return undefined;
    const buffer = Buffer.alloc(MAX_BYTES + 1), bytes = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    if (bytes > MAX_BYTES) return undefined;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytes)));
    return speechQualification(value);
  } catch {return undefined;}
  finally {if (descriptor !== undefined) closeSync(descriptor);}
}
