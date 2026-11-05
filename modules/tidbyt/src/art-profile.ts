import {MAX_ART_BYTES} from '@jimmie-potts/event-contracts/v2/art';

export const ART_INSTALLATION = 'bunnyart';
export const ART_PROFILE = Object.freeze({width: 64, height: 32, maxFrames: 20, minDelayMs: 100, maxDelayMs: 800, maxDurationMs: 16_000, maxBytes: MAX_ART_BYTES});
