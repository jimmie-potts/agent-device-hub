import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2/errors';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome} from './evidence.js';

/** Browser command evidence, separate from desired device state or transport acceptance. */
export type FrontendCommandPhase =
  | {readonly kind: 'none'}
  | {readonly kind: 'not-sent'; readonly reason: string}
  | {readonly kind: 'requested'}
  | {readonly kind: 'accepted'}
  | {readonly kind: 'restored'}
  | {readonly kind: 'refused'; readonly code: ErrorDetail['code'] | undefined}
  | {readonly kind: 'expired'}
  | {readonly kind: 'uncertain'}
  | {readonly kind: 'conflict'}
  | {readonly kind: 'completed'; readonly result: 'succeeded' | 'failed' | undefined; readonly family: string;
      readonly code: ErrorDetail['code'] | undefined; readonly evidence: OperationRecord['evidence']};

export type FrontendCommandView = {readonly phase: FrontendCommandPhase; readonly text: string; readonly locked: boolean};

/** Optional evidence wording for a surface whose command does not act directly on a device. */
export type FrontendCommandWording = {
  readonly expiredEffect?: string;
  readonly observed?: string;
  readonly transmitted?: string;
  readonly noEvidence?: string;
};

/** Render the standard receipt and lock from one phase. Wording can describe a surface's evidence without changing either decision. */
export function frontendCommandView(phase: FrontendCommandPhase, wording: FrontendCommandWording = {}): FrontendCommandView {
  switch (phase.kind) {
    case 'none': return {phase, text: 'No command sent from this page.', locked: false};
    case 'not-sent': return {phase, text: `Not sent: ${phase.reason}. Nothing was sent.`, locked: false};
    case 'requested': return {phase, text: 'Requested. Waiting for acceptance.', locked: true};
    case 'accepted': return {phase, text: 'Accepted. Waiting for completion.', locked: true};
    case 'restored': return {phase, text: 'Previous request has no confirmed result yet. It was not sent again.', locked: true};
    case 'refused': return {phase, text: `Refused${phase.code === undefined ? '' : ` (${phase.code})`} without changing state.`, locked: false};
    case 'expired': return {phase, text: `Expired before the command reached its owner. ${wording.expiredEffect ?? 'Nothing was sent to the device.'}`, locked: false};
    case 'uncertain': return {phase, text: 'Uncertain result. The command may have taken effect; it was not sent again.', locked: true};
    case 'conflict': return {phase, text: 'Conflicting outcomes. Controls are locked until the operation is resolved.', locked: true};
    case 'completed': {
      if (phase.result === Outcome.succeeded && (phase.family === 'mode-set' || phase.family === 'mode-override-set'))
        return {phase, text: 'Choice saved. Device results are separate.', locked: false};
      if (phase.result === Outcome.succeeded && phase.family === 'art-show')
        return {phase, text: 'Show handed off. Each surface has its own result below.', locked: false};
      const effect = phase.evidence === Outcome.observed ? wording.observed ?? 'The module observed the result.'
        : phase.evidence === Outcome.transmitted ? wording.transmitted ?? 'Transmitted; physical effect was not observed.'
        : wording.noEvidence ?? 'No evidence of a device effect.';
      return {phase, text: `Completed: ${phase.result ?? 'unknown'}${phase.code === undefined ? '' : ` (${phase.code})`}. ${effect}`, locked: false};
    }
  }
}
