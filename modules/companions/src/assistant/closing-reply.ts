import {Outcome} from '@jimmie-potts/sdk';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {BoundControl} from './control-intent.js';
import type {Proposal} from './history-contract.js';
import type {Call, Task} from './store.js';

/** Private, already-observed evidence. A later read can describe only an action admitted by this task. */
type Summary = {source: 'operation'; revision: number; text: string} | {source: 'effect'; text: string};
type Phase = {phaseId: string; revision: number; text: string};
export type ActionEvidence = {requestId: string} & (Summary | ({source: 'phase'} & Phase));
export type ApprovedAction = {questionId: string; description: string; control?: BoundControl; observed?: Summary; phases?: Phase[]};

export function actionDescription(proposal: Proposal, approvalText: string): string {
  switch (proposal.family) {
    case 'mode-set': return `Set the Hub mode to ${proposal.data.mode}`;
    case 'coding-dispatch': return `Delegate to the coding worker in ${proposal.data.repository}`;
    case 'power-set': return `Turn ${proposal.target} ${proposal.data.on ? 'on' : 'off'}`;
    case 'brightness-set': return `Set ${proposal.target} brightness to ${proposal.data.percent}%`;
    case 'catalog-action': {
      const {command, data, target} = proposal;
      if (command === 'art-request') return `Create the ${data.format === 'gif' ? 'animation' : 'image'} “${String(data.description)}”`;
      if (command === 'art-show' && Array.isArray(data.targets)) {
        if (Array.isArray(data.guards)) return approvalText.replace(/\?$/, '');
        return `Show the selected artwork on ${data.targets.join(', ')}`;
      }
      if (command === 'brightness-set') return `Set ${target} brightness to ${String(data.percent)}%`;
      return `${command.replaceAll('-', ' ')} on ${target}`;
    }
  }
}

export function operationOutcome(operation: Pick<OperationRecord, 'status' | 'result' | 'evidence'>): string {
  switch (operation.status) {
    case 'completed':
      if (operation.result === Outcome.succeeded && operation.evidence === Outcome.observed) return 'the service observed a successful outcome';
      if (operation.result === Outcome.succeeded && operation.evidence === Outcome.transmitted) return 'the command was transmitted. Its effect is unconfirmed';
      if (operation.result === Outcome.succeeded) return 'the operation reported success';
      return operation.result === Outcome.failed ? 'the operation failed' : 'the outcome is unknown';
    case 'accepted': return 'the request was accepted. Its effect is unconfirmed';
    case 'sent': return 'the request was sent. Its effect is unconfirmed';
    case 'rejected': return 'the request was rejected';
    case 'expired': return 'the request expired';
    case 'conflict': return 'the operation reported a conflict';
    case 'uncertain': return 'the outcome is unknown';
  }
}

function actionOutcome(call: Call & {action: ApprovedAction}): string {
  if (call.status === 'succeeded' && call.result?.startsWith('refused: ') === true) return 'The request was refused.';
  const phases = call.action.phases ?? [];
  const accepted = call.status === 'succeeded' && call.result?.startsWith('accepted: ') === true;
  const summary = call.action.observed?.text ?? (accepted
    ? phases.length > 0 ? 'the request was accepted' : 'the request was accepted. Its final outcome is unconfirmed'
    : 'I cannot confirm whether the request took effect');
  return [summary, ...phases.map(phase => phase.text)].map(text => text.charAt(0).toUpperCase() + text.slice(1) + '.').join(' ');
}

export function closingReply(task: Task, calls: readonly Call[], cause?: string): string {
  const actions = calls.filter((call): call is Call & {action: ApprovedAction} => call.action !== undefined).sort((a, b) => a.ordinal - b.ordinal);
  const sentences = actions.map(call => `You ${call.action.control === undefined ? 'approved' : 'requested'} “${call.action.description}”. ${actionOutcome(call)}`);
  const question = task.question;
  if (question?.kind === 'approval' && question.answer === 'approve' && question.proposal !== null &&
      !actions.some(call => call.action.questionId === question.id)) {
    sentences.push(`You approved “${actionDescription(question.proposal, question.text)}”. ${task.tracksApprovals === true ? 'The request stopped before dispatch.' : 'I have no confirmed dispatch for that approval.'}`);
  } else if (question?.kind === 'clarification' && question.answer !== null && actions.length === 0) {
    sentences.push('I received your answer, but could not finish the request.');
  }
  const reason = cause ?? (task.code === 'capacity' ? 'A capacity limit stopped this turn.' :
    task.code === 'unauthenticated' ? 'The service could not authenticate the request.' :
    task.code === 'unavailable' ? 'A required service was unavailable.' : undefined);
  if (reason !== undefined) sentences.push(reason);
  else if (task.status === 'uncertain') sentences.push('The turn stopped before I could confirm the outcome.');
  else sentences.push('The turn stopped before I could finish. The cause is unknown.');
  return sentences.join(' ');
}
