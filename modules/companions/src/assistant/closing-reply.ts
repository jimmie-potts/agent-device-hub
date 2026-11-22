import {Outcome} from '@jimmie-potts/sdk';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Proposal} from './history-contract.js';
import type {Call, Task} from './store.js';

/** Private, already-observed evidence. A later read can describe only an action admitted by this task. */
export type ActionEvidence = {requestId: string; text: string; source: 'operation' | 'effect'};
export type ApprovedAction = {questionId: string; description: string; observed?: Pick<ActionEvidence, 'source' | 'text'>};

export function actionDescription(proposal: Proposal): string {
  switch (proposal.family) {
    case 'mode-set': return `Set the Hub mode to ${proposal.data.mode}`;
    case 'coding-dispatch': return `Delegate to the coding worker in ${proposal.data.repository}`;
    case 'power-set': return `Turn ${proposal.target} ${proposal.data.on ? 'on' : 'off'}`;
    case 'brightness-set': return `Set ${proposal.target} brightness to ${proposal.data.percent}%`;
    case 'catalog-action': {
      const {command, data, target} = proposal;
      if (command === 'art-request') return `Create the ${data.format === 'gif' ? 'animation' : 'image'} “${String(data.description)}”`;
      if (command === 'art-show' && Array.isArray(data.targets)) return `Show the selected artwork on ${data.targets.join(', ')}`;
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

function admission(call: Call): string {
  if (call.action?.observed !== undefined) return call.action.observed.text;
  if (call.status === 'succeeded' && call.result?.startsWith('refused: ') === true) return 'the request was refused';
  if (call.status === 'succeeded' && call.result?.startsWith('accepted: ') === true) return 'the request was accepted. Its final outcome is unconfirmed';
  return 'I cannot confirm whether the request took effect';
}

export function closingReply(task: Task, calls: readonly Call[], cause?: string): string {
  const actions = calls.filter((call): call is Call & {action: ApprovedAction} => call.action !== undefined).sort((a, b) => a.ordinal - b.ordinal);
  const sentences = actions.map(call => `You approved “${call.action.description}”. ${admission(call).replace(/^./, first => first.toUpperCase())}.`);
  const question = task.question;
  if (question?.kind === 'approval' && question.answer === 'approve' && question.proposal !== null &&
      !actions.some(call => call.action.questionId === question.id)) {
    sentences.push(`You approved “${actionDescription(question.proposal)}”. ${task.tracksApprovals === true ? 'The request stopped before dispatch.' : 'I have no confirmed dispatch for that approval.'}`);
  } else if (question?.kind === 'clarification' && question.answer !== null && actions.length === 0) {
    sentences.push('I received your answer, but could not finish the request.');
  }
  const reason = cause ?? (task.code === 'capacity' ? 'A capacity limit stopped this turn.' :
    task.code === 'unauthenticated' ? 'The service could not authenticate the request.' :
    task.code === 'unavailable' ? 'A required service was unavailable.' : undefined);
  if (reason !== undefined) sentences.push(reason);
  if (sentences.length === 0) sentences.push('I could not finish checking your request.');
  return sentences.join(' ');
}
