import React, {createContext, useContext} from 'react';
import type {Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {ModeDeviceView} from './mode-exceptions.ts';
import {effectiveMode} from '@jimmie-potts/event-contracts/v2/mode';
import {useAttempt} from './command-control.tsx';
import {ModeIcon} from './hub-mode-hero.tsx';
import {modeName} from './hub-mode.ts';

type ModeContext = {record: ModeState | undefined; live: boolean; control: boolean; operations: readonly OperationRecord[];
  operationsLive: boolean; devices: readonly ModeDeviceView[]};
const context = createContext<ModeContext>({record: undefined, live: false, control: false, operations: [], operationsLive: false, devices: []});
/** Shares the shell's current copies; it opens no subscription and stores no selected mode. */
export const DeviceModesProvider = context.Provider;

const modeDevice = (state: ModeContext, target: string): ModeDeviceView | undefined => state.devices.find(item => item.record.id === target &&
  (item.record.kind === 'nanoleaf' && item.owner === 'bunny/modules/nanoleaf' || item.record.kind === 'pixoo' && item.owner === 'bunny/modules/pixoo'));
function modeNote(state: ModeContext, target: string): {text: string; selected: Mode | undefined} {
  const selected = effectiveMode(state.record, target, state.live);
  const overridden = state.record?.overrides?.some(choice => choice.target === target) === true;
  return {selected, text: selected === undefined ? 'Saved mode unavailable' : overridden ? `${modeName(selected)} · individual exception` : `Following Hub ${modeName(selected)}`};
}
/** The saved-mode line for a device that follows the hub mode, as the mode choice shows it; undefined for others. */
export function useDeviceModeNote(target: string | undefined): string | undefined {
  const state = useContext(context);
  return target === undefined || modeDevice(state, target) === undefined ? undefined : modeNote(state, target).text;
}

/** Same deliberate saved-mode control inside shared lighting/Pixoo and advanced device cards. */
export function DeviceModeChoice({target}: {target: string}): React.JSX.Element | null {
  const state = useContext(context);
  const attempt = useAttempt(target, state.operations, state.operationsLive);
  const device = modeDevice(state, target);
  if (device === undefined) return null;
  const record = state.record;
  const {selected, text} = modeNote(state, target);
  const disabled = !state.control || !state.live || record === undefined || !state.operationsLive || attempt.locked;
  const select = (mode: Mode): void => {
    if (disabled || record === undefined) return;
    void attempt.run({family: 'mode-override-set', target, requestId: crypto.randomUUID(), data: {mode, expectedRevision: record.revision}});
  };
  return <div className="device-mode-choice" data-mode-target={target}>
    <p className="light-note">{text}</p>
    {state.control && <div className="hub-mode-choices" role="group" aria-label={`Saved mode for ${device.record.label ?? target}`}>
      {(['work', 'free', 'quiet'] as const).map(mode => <button type="button" className="secondary" key={mode} disabled={disabled}
        aria-pressed={selected === mode} onClick={() => {select(mode);}}><ModeIcon mode={mode}/><span>{modeName(mode)}</span></button>)}
    </div>}
  </div>;
}
