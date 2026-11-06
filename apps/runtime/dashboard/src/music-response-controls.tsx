import React, {useEffect, useId, useState} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CaptureResponseBinding, CaptureResponseSettings} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import {useAttempt} from './command-control.tsx';
import type {MusicCaptureView} from './music-capture-feed.ts';

type Draft = {settings: CaptureResponseSettings; settingsRevision: number};
const outcomeText = (text: string): string => text.replace('The module observed the result.', 'The core confirmed the result.')
  .replace('Nothing was sent to the device.', 'No settings change was accepted.').replace('No evidence of a device effect.', 'No completed calibration or settings change was confirmed.');
export function MusicResponseControls({view, available, operations, operationsLive}: {
  view: MusicCaptureView; available: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
}): React.JSX.Element {
  const id = useId(), state = view.state, response = state?.response, frame = view.features;
  const [draft, setDraft] = useState<Draft | undefined>();
  useEffect(() => {
    if (response !== undefined && (draft === undefined || (draft.settingsRevision !== response.settingsRevision && JSON.stringify(draft.settings) === JSON.stringify(response.settings))))
      setDraft({settings: structuredClone(response.settings), settingsRevision: response.settingsRevision});
  }, [draft, response]);
  const measure = useAttempt('music', operations, operationsLive, undefined, 'core/music-capture/calibrate');
  const cancel = useAttempt('music', operations, operationsLive, undefined, 'core/music-capture/cancel-calibration');
  const apply = useAttempt('music', operations, operationsLive, undefined, 'core/music-capture/apply-tuning');
  const binding: CaptureResponseBinding | undefined = state?.endpointId !== null && state?.endpointId !== undefined && state.session.status === 'active' &&
    state.session.input === 'microphone' && frame?.input === 'microphone' ? {endpointId: state.endpointId, generation: state.session.generation,
      microphoneId: state.session.microphoneId, sampleRateHz: frame.sampleRateHz, channels: frame.channels} : undefined;
  const attempt = response?.calibration, evidence = response?.evidence;
  const candidate = attempt?.status === 'ready' && evidence?.id === attempt.operationId ? evidence : undefined;
  const ready = available && binding !== undefined && response !== undefined;
  const busy = attempt?.status === 'measuring';
  const savedChanged = draft !== undefined && response !== undefined && draft.settingsRevision !== response.settingsRevision;
  const mayMeasure = ready && !busy && !measure.locked && !cancel.locked && !apply.locked;
  const mayCancel = ready && busy && !cancel.locked;
  const candidateCurrent = draft?.settings.gate.mode !== 'calibrated' || draft.settings.gate.calibrationId === candidate?.id;
  const mayApply = ready && draft !== undefined && candidateCurrent && !busy && !apply.locked && !measure.locked && !cancel.locked && !savedChanged;
  const update = (settings: CaptureResponseSettings): void => {if (draft !== undefined) setDraft({...draft, settings});};
  const number = (label: string, key: string, value: number, min: number, max: number, step: number, changed: (value: number) => void): React.JSX.Element =>
    <label htmlFor={`${id}-${key}`}>{label}<input id={`${id}-${key}`} type="number" min={min} max={max} step={step} value={value}
      onChange={event => {const next = event.currentTarget.valueAsNumber;if (Number.isFinite(next) && next >= min && next <= max) changed(next);}}/></label>;
  return <section className="music-response" aria-label="Microphone response settings">
    <h3>Microphone response</h3>
    <p className="music-note">Measure an interval you consider quiet, then review and apply its gate. This estimates a digital baseline, not acoustic quiet or loudness.</p>
    {!ready && <p className="music-note">Start the selected microphone and wait for fresh input to change response settings.</p>}
    <div className="music-capture-actions">
      <button type="button" disabled={!mayMeasure} onClick={() => {
        if (!mayMeasure || binding === undefined || state === undefined) return;
        void measure.run({family: 'music-capture-control', target: 'music', requestId: crypto.randomUUID(), data: {action: 'calibrate', binding, expectedRevision: state.revision}});
      }}>Measure quiet input</button>
      <button type="button" disabled={!mayCancel} onClick={() => {
        if (!mayCancel || binding === undefined || state === undefined || attempt?.status !== 'measuring') return;
        void cancel.run({family: 'music-capture-control', target: 'music', requestId: crypto.randomUUID(), data: {action: 'cancel-calibration', binding, operationId: attempt.operationId, expectedRevision: state.revision}});
      }}>Cancel quiet measurement</button>
    </div>
    {busy && <p role="status">Measuring five seconds of uninterrupted quiet input. Keep the microphone input quiet. Capture continues if you cancel.</p>}
    {attempt?.status === 'ended' && <p role="status">Quiet measurement is inactive: {attempt.reason.replaceAll('-', ' ')}. Saved settings and prior evidence are retained.</p>}
    {evidence !== undefined && evidence !== null && <p className="music-note">Last measured baseline: 95th percentile {evidence.percentileRms.toFixed(4)} RMS, maximum {evidence.maximumRms.toFixed(4)} RMS over {evidence.windowCount} windows.</p>}
    {candidate !== undefined && <div>
      <p>Suggested gate: {candidate.suggestedThreshold.toFixed(4)} RMS. Twice the observed 95th percentile is a heuristic; review it before applying.</p>
      <button type="button" className="secondary" disabled={!ready || draft === undefined || apply.locked} onClick={() => {
        if (draft === undefined || response === undefined) return;
        setDraft({...draft, settings: {...draft.settings, gate: {mode: 'calibrated', threshold: candidate.suggestedThreshold, calibrationId: candidate.id}}});
      }}>Use suggested gate in draft</button>
    </div>}
    {response !== undefined && response.settings.gate.mode !== 'off' && response.appliedTo === null && <p role="status">Saved gate is inactive for this capture. Measure quiet input again or explicitly apply a manual threshold.</p>}
    {draft !== undefined && <>
      <fieldset disabled={!ready || busy || apply.locked}>
        <legend>Response settings draft</legend>
        <div className="music-response-fields">
          {number('Sensitivity', 'sensitivity', draft.settings.sensitivity, 0.1, 8, 0.1, value => {update({...draft.settings, sensitivity: value});})}
          {number('Smoothing (ms)', 'smoothing', draft.settings.smoothingMs, 0, 2000, 10, value => {update({...draft.settings, smoothingMs: value});})}
          {(['bass', 'mid', 'treble'] as const).map(band => <React.Fragment key={band}>
            {number(`${band[0]?.toUpperCase()}${band.slice(1)} emphasis`, band, draft.settings.emphasis[band], 0, 4, 0.1,
              value => {update({...draft.settings, emphasis: {...draft.settings.emphasis, [band]: value}});})}
          </React.Fragment>)}
          <label htmlFor={`${id}-gate`}>Noise gate<select id={`${id}-gate`} value={draft.settings.gate.mode} onChange={event => {
            const mode = event.currentTarget.value;
            if (mode === 'off') update({...draft.settings, gate: {mode}});
            else if (mode === 'manual') update({...draft.settings, gate: {mode, threshold: draft.settings.gate.mode === 'off' ? 0 : draft.settings.gate.threshold}});
            else if (mode === 'calibrated' && candidate !== undefined) update({...draft.settings, gate: {mode, threshold: candidate.suggestedThreshold, calibrationId: candidate.id}});
          }}><option value="off">Off, uncalibrated</option><option value="manual">Manual, uncalibrated threshold</option><option value="calibrated" disabled={candidate === undefined}>Measured candidate</option></select></label>
          {draft.settings.gate.mode !== 'off' && number('Gate threshold (linear RMS)', 'threshold', draft.settings.gate.threshold, 0, 16, 0.0001,
            value => {if (draft.settings.gate.mode !== 'off') update({...draft.settings, gate: {...draft.settings.gate, threshold: value}});})}
        </div>
      </fieldset>
      {savedChanged && response !== undefined && <div role="status">
        <p>Saved settings changed. Current sensitivity is {response.settings.sensitivity}, smoothing is {response.settings.smoothingMs} ms and the gate is {response.settings.gate.mode}. Your draft is retained.</p>
        <button type="button" className="secondary" disabled={!ready || apply.locked} onClick={() => {setDraft({...draft, settingsRevision: response.settingsRevision});}}>Keep my draft</button>
        <button type="button" className="secondary" disabled={apply.locked} onClick={() => {setDraft({settings: structuredClone(response.settings), settingsRevision: response.settingsRevision});}}>Load saved settings</button>
      </div>}
      <button type="button" disabled={!mayApply} onClick={() => {
        if (!mayApply || binding === undefined || state === undefined) return;
        void apply.run({family: 'music-capture-control', target: 'music', requestId: crypto.randomUUID(), data: {action: 'apply-tuning', binding,
          expectedRevision: state.revision, expectedSettingsRevision: draft.settingsRevision, settings: draft.settings}});
      }}>Apply response settings</button>
    </>}
    {measure.requestId !== undefined && <p role="status">Quiet measurement: {outcomeText(measure.text)}</p>}
    {cancel.requestId !== undefined && <p role="status">Cancel: {outcomeText(cancel.text)}</p>}
    {apply.requestId !== undefined && <p role="status">Apply: {outcomeText(apply.text)}</p>}
    <div className="music-input-level">
      <label htmlFor={`${id}-preview`}>Response preview</label>
      {view.response === undefined ? <p>Response preview unavailable.</p> : <>
        <meter id={`${id}-preview`} min={0} max={1} value={view.response.level}/>
        <p>Level {(view.response.level * 100).toFixed(1)}% · Bass {(view.response.bass * 100).toFixed(1)}% · Mid {(view.response.mid * 100).toFixed(1)}% · Treble {(view.response.treble * 100).toFixed(1)}%</p>
        <p className="music-note">{response?.settings.gate.mode === 'off' ? 'Gate off. Preview is uncalibrated.' : response?.settings.gate.mode === 'manual' ? 'Manual threshold, uncalibrated.' : 'Gate uses the applied measured candidate.'} {response?.settings.gate.mode !== 'off' && (view.response.gateOpen ? 'Gate open.' : 'Gate closed; smoothing may still decay.')}</p>
      </>}
      <p className="music-note">Numerical response only. The raw input meter is unchanged. Lights are not connected.</p>
    </div>
  </section>;
}
