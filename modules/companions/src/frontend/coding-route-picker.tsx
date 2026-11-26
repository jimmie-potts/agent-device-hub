import React from 'react';
import type {CodingPreference} from '../assistant/history-contract.js';
import {codingChoice, codingDestinationChoice, type CodingChoice, type CodingDestinationChoice} from '../coding/routing.js';

export const defaultCodingPreference: CodingPreference = {harness: 'auto', destination: 'auto'};

export function destinationLabel(destination: CodingDestinationChoice): string {
  if (destination === 'auto') return 'Auto';
  if (destination === 'mac') return 'Mac';
  if (destination === 'pc') return 'PC';
  if (destination === 'cloud') return 'Cloud';
  return `Cloud (${destination.slice('cloud-'.length)})`;
}

export function harnessLabel(harness: CodingChoice): string {
  if (harness === 'auto') return 'Auto';
  return harness === 'codex' ? 'Codex' : 'Claude Code';
}

export function CodingRoutePicker({value, onChange}: {
  value: CodingPreference;
  onChange: (preference: CodingPreference) => void;
}): React.JSX.Element {
  return <>
    <p><label>Coding harness{' '}
      <select value={value.harness} onChange={event => {
        const harness = event.currentTarget.value;
        if (codingChoice(harness)) onChange({...value, harness});
      }}>
        <option value="auto">Auto</option>
        <option value="claude-code">Claude Code</option>
        <option value="codex">Codex</option>
      </select>
    </label></p>
    <p><label>Execution destination{' '}
      <select value={value.destination} onChange={event => {
        const destination = event.currentTarget.value;
        if (codingDestinationChoice(destination)) onChange({...value, destination});
      }}>
        <option value="auto">Auto</option>
        <option value="mac">Mac</option>
        <option value="pc">PC</option>
        <option value="cloud">Cloud</option>
        {value.destination.startsWith('cloud-') && <option value={value.destination}>{destinationLabel(value.destination)}</option>}
      </select>
    </label></p>
  </>;
}
