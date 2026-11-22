import React, {useEffect, useState} from 'react';
import {ART_SHOW_BROWSER, artShowSurfaces, isArtShowGuard, type ArtShowEffects, type ArtShowGuard, type ArtShowSurface} from '@jimmie-potts/event-contracts/v2/art-show';
import type {ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {followCopy} from '@jimmie-potts/sdk/remote';
import type {ConversationAttachment} from '../assistant/history-contract.js';

type Destination = {id: string; kind: ArtTarget; label: string; guard?: ArtShowGuard};
type Sent = {requestId: string; targets: Destination[]};
const browser: Destination = {id: ART_SHOW_BROWSER, kind: 'ui', label: 'Browser'};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function destinations(value: unknown): Destination[] {
  if (!object(value) || value.schema !== 'automation/2.0' || !Array.isArray(value.targets)) throw new Error('invalid-targets');
  return [browser, ...value.targets.map((row: unknown): Destination => {
    if (!object(row) || typeof row.target !== 'string' || (row.kind !== 'pixoo' && row.kind !== 'tidbyt')) throw new Error('invalid-target');
    const guard = row.guard;
    if (guard !== undefined && (!isArtShowGuard(guard) || guard.target !== row.target || guard.kind !== row.kind)) throw new Error('invalid-guard');
    const label = typeof row.label === 'string' && row.label.trim().length > 0 ? row.label : row.kind === 'pixoo' ? 'Pixoo' : 'Tidbyt';
    return {id: row.target, kind: row.kind, label: label === row.target ? label : `${label} (${row.target})`, ...(guard === undefined ? {} : {guard})};
  })];
}

function phase(operations: readonly OperationRecord[], requestId: string): string {
  const op = operations.find(row => row.requestId === requestId && row.requestedBy === 'bunny/core');
  if (op === undefined) return 'awaiting evidence';
  return [op.result ?? op.status, op.evidence === 'none' ? undefined : op.evidence, op.error?.code].filter(Boolean).join(' · ');
}

function DisplayResults({context, sent}: {context: FrontendContext; sent: Sent}): React.JSX.Element {
  const [surfaces, setSurfaces] = useState<ArtShowSurface[]>([]);
  const [effects, setEffects] = useState<ArtShowEffects>();
  useEffect(() => {
    if (!context.connected) return;
    return followCopy<ArtShowEffects>((changed, options) => context.api.sync(['art-show-effects'], changed, options), {
      current: copy => setEffects(copy.states().find(item => item.data.requestId === sent.requestId)?.data),
      changed: change => {
        if (change.type === 'updated' && change.message.data.requestId === sent.requestId) setEffects(change.message.data);
        if (change.type === 'removed') setEffects(current => current?.id === change.entity.id ? undefined : current);
      },
      refused: () => setEffects(undefined),
    });
  }, [context.api, context.connected, sent.requestId]);
  useEffect(() => {
    let current = true;
    void artShowSurfaces(sent.requestId, sent.targets.map(row => row.id)).then(rows => {if (current) setSurfaces(rows);});
    return () => {current = false;};
  }, [sent]);
  return <ul aria-label="Display results">{sent.targets.map(row => {
    const surface = surfaces.find(item => item.target === row.id);
    const status = (step: 'prepare' | 'present', id: string): string => {
      const skip = effects?.skipped.find(item => item.target === row.id && item.phase === step);
      return skip === undefined ? phase(context.operations, id) : `skipped (${skip.code})`;
    };
    return <li key={row.id}><strong>{row.label}</strong>{!context.operationsLive ? ' · Operation records are stale.'
      : surface?.kind === 'browser' ? ` · Selection: ${status('present', surface.presentRequestId)}`
      : surface?.kind === 'display' ? ` · Preparation: ${status('prepare', surface.prepareRequestId)}. Presentation: ${status('present', surface.momentRequestId)}.`
      : ' · Awaiting evidence.'}</li>;
  })}</ul>;
}

type Props = {context: FrontendContext; artworkId: string; usableKinds: ArtTarget[]; attachment: ConversationAttachment};

function DisplayForm({context, artworkId, usableKinds, attachment, command}: Props & {command: FrontendCommand}): React.JSX.Element {
  const intent = attachment.showTargets;
  const decisionKey = `bunny.art-show.choice.${attachment.requestId}`;
  const [open, setOpen] = useState(() => {
    if (intent === undefined || intent.length === 0) return false;
    try {return sessionStorage.getItem(decisionKey) === null;} catch {return true;}
  });
  const [picked, setPicked] = useState<string[]>(intent ?? []);
  const [available, setAvailable] = useState<Destination[]>(), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0), [sent, setSent] = useState<Sent>();
  const locked = command.locked || !context.control || !context.connected || !context.operationsLive;
  useEffect(() => {
    if (!open || !context.connected) return;
    let current = true;
    setAvailable(undefined); setFailed(false);
    void context.api.read('/api/v2/automation/art/targets?view=approval').then(destinations).then(rows => {
      if (current) setAvailable(rows);
    }).catch(() => {if (current) setFailed(true);});
    return () => {current = false;};
  }, [context.api, context.connected, open, attempt]);
  const dismiss = (): void => {
    try {if (intent !== undefined && intent.length > 0) sessionStorage.setItem(decisionKey, 'handled');} catch { /* Reopening can only present an approval. */ }
    setOpen(false);
  };
  const unavailable = (row: Destination): string | undefined =>
    !usableKinds.includes(row.kind) ? 'This artwork has no compatible rendition.' :
    row.kind !== 'ui' && row.guard === undefined ? 'The display identity is unavailable.' : undefined;
  const chosen = (available ?? []).filter(row => picked.includes(row.id) && unavailable(row) === undefined);
  const canSend = !locked && chosen.length > 0 && chosen.length === picked.length && chosen.filter(row => row.kind !== 'ui').length <= 2;
  const approve = (): void => {
    if (!canSend) return;
    const requestId = crypto.randomUUID();
    setSent({requestId, targets: chosen}); dismiss();
    void command.run({family: 'art-show', target: 'hub', requestId, data: {artworkId, targets: chosen.map(row => row.id),
      guards: chosen.flatMap(row => row.guard === undefined ? [] : [row.guard])}});
  };
  return <div className="conversation-art-display">
    {open ? <fieldset><legend>Show “{attachment.description}” on</legend>
      {available === undefined ? (failed ? <p role="status">Display choices are unavailable. <button type="button" onClick={() => setAttempt(n => n + 1)}>Refresh choices</button></p>
        : <p role="status">Reading display choices…</p>) : <>
        {available.map(row => {
          const reason = unavailable(row);
          return <label key={row.id}><input type="checkbox" checked={picked.includes(row.id)} disabled={locked || (reason !== undefined && !picked.includes(row.id))}
            onChange={e => setPicked(e.target.checked ? [...picked, row.id] : picked.filter(id => id !== row.id))}/>{row.label}{reason !== undefined && ` · ${reason}`}</label>;
        })}
        {picked.filter(id => !available.some(row => row.id === id)).map(id => <label key={id}><input type="checkbox" checked disabled={locked}
          onChange={() => setPicked(picked.filter(selected => selected !== id))}/>{id} · No longer configured.</label>)}
        {chosen.filter(row => row.kind !== 'ui').length > 2 && <p>Select up to two devices.</p>}
      </>}
      <button type="button" disabled={!canSend} onClick={approve}>Approve display</button>
      <button type="button" className="secondary" onClick={dismiss}>Cancel</button>
    </fieldset> : <button type="button" className="secondary" disabled={locked} onClick={() => {setPicked([]); setAvailable(undefined); setOpen(true);}}>Show on…</button>}
    {(sent !== undefined || command.requestId !== undefined) && <p role="status">{command.text}</p>}
    {sent !== undefined && <DisplayResults key={sent.requestId} context={context} sent={sent}/>}
  </div>;
}

export function AttachmentDisplay(props: Props): React.JSX.Element {
  const {Command} = props.context.ui;
  return <Command context={props.context} target="hub" attemptKey={`companions/art-show/${props.attachment.requestId}`}>
    {command => <DisplayForm {...props} command={command}/>}
  </Command>;
}
