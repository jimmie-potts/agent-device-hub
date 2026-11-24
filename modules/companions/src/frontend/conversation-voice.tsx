import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {playbackLabels, SpeechRecovery, type SpeechControlsSession} from './speech.js';

export function stopSpeakingButton(speech: SpeechControlsSession): React.JSX.Element | null {
  const {local, selected} = speech;
  const canStop = selected && (local.playback?.status === 'started' || local.playback?.status === 'dispatching');
  return canStop
    ? <button type="button" className="secondary" disabled={local.busy} onClick={() => {void speech.stop();}}>Stop speaking</button>
    : null;
}

export function ConversationVoice({context, speech, open, onOpenChange, stopSpeaking}: {
  context: FrontendContext; speech: SpeechControlsSession; open: boolean;
  onOpenChange: (open: boolean) => void; stopSpeaking: React.JSX.Element | null;
}): React.JSX.Element {
  const [recoveredOperation, setRecoveredOperation] = useState<string>();
  const panelId = useId();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((): void => {
    onOpenChange(false);
    trigger.current?.focus();
  }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current !== null && !root.current.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [open, close, onOpenChange]);
  const {local, qualification, ready, selected, synced} = speech;
  const remote = context.connected && synced ? speech.remote : undefined;
  const playing = selected && local.playback?.status === 'started';
  const recoveryId = remote?.recoveryOperationId;
  const unresolvedPlayback = remote?.availability === 'unavailable' && remote.playback?.status === 'uncertain';
  const needsAttention = recoveryId !== undefined || unresolvedPlayback;
  const other = remote?.availability === 'available' && speech.other;
  const selectedHere = selected && remote?.availability === 'available';
  const locked = !context.connected ? 'Reconnect to enable voice.'
    : !context.control ? 'Voice controls require operator access.'
    : !context.operationsLive ? 'Tracked operations are unavailable.'
    : qualification === undefined ? 'Voice requires qualified Google Chrome on macOS and the exact local English voice.'
    : !ready ? 'Current companion, speech or Hub state is unavailable.'
    : undefined;
  const unavailable = locked !== undefined || other || remote?.availability === 'unavailable' || local.availability === 'unavailable';
  const state = playing ? 'Speaking' : needsAttention ? 'Needs attention' : selectedHere ? 'Voice on' : unavailable ? 'Unavailable' : 'Voice off';
  const refusal = locked ?? (other ? 'Another tab is the selected speaker.'
    : recoveryId !== undefined ? 'Recover the earlier playback reservation before enabling voice.'
    : unresolvedPlayback ? 'Earlier playback is unresolved. Voice stays off until recovery is available.'
    : remote?.availability === 'unavailable' ? 'The previous endpoint is unavailable. Enable again when this tab is ready.'
    : local.availability === 'enabling' ? 'Checking the qualified local voice.'
    : local.availability === 'unavailable' ? 'Enable did not establish the qualified local voice or a current endpoint.'
    : undefined);
  const canEnable = locked === undefined && !other && !needsAttention && !local.busy;
  const mayMute = selected || local.availability === 'enabling';
  const playback = local.playback ?? remote?.playback;
  const recover = async (operationId: string, revision: number): Promise<boolean> => {
    if (locked !== undefined || !await speech.recover(operationId, revision)) return false;
    setRecoveredOperation(operationId);
    return true;
  };

  return <div className="conversation-voice-actions" ref={root}>
    <button type="button" className="secondary conversation-voice-toggle" ref={trigger}
      data-tone={needsAttention ? 'attention' : selectedHere ? 'on' : undefined} aria-expanded={open} aria-controls={panelId}
      onClick={() => {onOpenChange(!open);}}>
      {state.startsWith('Voice ') ? state : `Voice · ${state}`}
    </button>
    {stopSpeaking}
    <section id={panelId} className="conversation-voice-panel" aria-labelledby={titleId} hidden={!open}>
      {open && <>
        <header className="conversation-voice-heading">
          <h3 id={titleId}>Spoken replies</h3>
          <button type="button" className="secondary" aria-label="Close spoken replies" onClick={close}>Close</button>
        </header>
        <p>This tab becomes the one speaker for B.U.N.N.Y.’s and Reachy’s conversation replies and eligible Reachy alerts. MicroDuck’s replies are never spoken: its audio is quacks only. Voice uses audio output only.</p>
        <p className="conversation-voice-note">Mute before calls or media. The browser cannot detect them.</p>
        <div className="conversation-voice-actions">
          {mayMute
            ? <button type="button" className="secondary" onClick={() => {void speech.mute();}}>Mute</button>
            : <button type="button" disabled={!canEnable} onClick={() => {if (canEnable) void speech.enable();}}>Enable</button>}
        </div>
        {refusal !== undefined && <p role="status">{refusal}</p>}
        {context.core?.mode === 'quiet' && <p>Quiet mode suppresses spoken replies.</p>}
        {remote !== undefined && recoveryId !== undefined && <SpeechRecovery key={`${recoveryId}:${remote.revision}`}
          operationId={recoveryId} revision={remote.revision} ready={locked === undefined && !local.busy}
          recoverVoice={recover}/>}
        <details>
          <summary>Voice requirements and playback evidence</summary>
          <p>Enable selects this connected tab. Reload or reconnect requires a fresh Enable. Missed speech is never replayed.</p>
          {qualification !== undefined && <p>Qualified local voice: {qualification.voice.name} ({qualification.voice.lang}). Qualification recorded in Chrome {qualification.browserVersion} on {qualification.qualifiedAt.slice(0, 10)}.</p>}
          <p>Stop speaking ends playback and leaves the task unchanged. Playback reports do not establish whether anyone heard it.</p>
          <p role="status">Playback: {playback == null ? 'No playback reported.' : playbackLabels[playback.status]}</p>
          {recoveredOperation !== undefined && <p>Recovery acknowledged. The earlier playback remains uncertain.</p>}
          {speech.operation !== undefined && <p>Tracked operation: {context.operationsLive ? speech.operation.result ?? speech.operation.status : 'unavailable'}.</p>}
        </details>
      </>}
    </section>
  </div>;
}
