import React from 'react';
import type {CompanionMessage} from '../knowledge/model.js';

export const meaningLabel = (message: CompanionMessage): string => message.meaning.kind === 'literal' ? message.meaning.text : message.meaning.kind === 'emotion' ? message.meaning.emotion : 'Meaning unknown';
export function MessageMeaning({message}: {message: CompanionMessage}): React.JSX.Element {
  return <>
    {message.speakerId === 'microduck' && <p>Intended meaning / translation. MicroDuck audio is quacks only.</p>}
    {message.meaning.kind === 'emotion' && <p>Emotional expression{message.meaning.intensity === undefined ? '' : ` · intensity ${message.meaning.intensity}`}</p>}
    <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{meaningLabel(message)}</p>
    {message.legacyText !== undefined && <p>Retained legacy text (meaning and audience unqualified): {message.legacyText}</p>}
  </>;
}
export function MessageEvidence({message}: {message: CompanionMessage}): React.JSX.Element {
  return <>
    <p><time dateTime={new Date(message.createdAtMs).toISOString()}>{new Date(message.createdAtMs).toLocaleString()}</time>
      {' · '}{message.provenance.kind === 'synthetic' ? 'Synthetic fiction' : message.provenance.kind}{message.provenance.imported ? ' · imported' : ''}</p>
    <p>Playback unknown. {message.deliveryRefs.length === 0 ? 'No delivery evidence recorded.' : 'Delivery references are recorded; they do not establish playback or hearing.'}</p>
  </>;
}
