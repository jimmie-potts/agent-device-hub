import React, {useEffect, useState} from 'react';
import type {PreferenceState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {ActivePreferences, Preference, PreferenceLibrary, PreferenceView} from '../preferences/model.js';

const endpoint = '/modules/companions/content/preferences';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
function documentOf(value: unknown, schema: string): PreferenceView | PreferenceLibrary | ActivePreferences {
  if (!object(value) || value.schema !== schema || !Array.isArray(value.entries) || (!schema.endsWith('-library/1.0') && !integer(value.revision))) throw new Error('Invalid preference document');
  for (const entry of value.entries) {
    if (!object(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.text !== 'string' ||
      typeof entry.active !== 'boolean' || !integer(entry.createdAtMs) || !integer(entry.updatedAtMs)) throw new Error('Invalid preference entry');
    if (schema !== 'preferences/1.0' && schema !== 'knowledge/1.0') {
      if (!Array.isArray(entry.history) || entry.history.some((event: unknown) => !object(event) || typeof event.action !== 'string' ||
        typeof event.source !== 'string' || !integer(event.atMs) || typeof event.title !== 'string' || typeof event.text !== 'string' || typeof event.active !== 'boolean')) throw new Error('Invalid preference history');
    }
  }
  return value as PreferenceView | PreferenceLibrary | ActivePreferences;
}
const time = (at: number): string => new Date(at).toLocaleString();

export function EntryLibrary({context, command, view, live, kind = 'preferences', files = true}: {context: FrontendContext; command: FrontendCommand; view: Pick<PreferenceView, 'entries' | 'revision'>; live: boolean; kind?: 'preferences' | 'knowledge'; files?: boolean}): React.JSX.Element {
  const noun = kind === 'knowledge' ? 'knowledge entry' : 'preference';
  const route = `/modules/companions/content/${kind}`;
  const schemaPrefix = kind === 'knowledge' ? 'knowledge' : 'preference';
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string>();
  const [history, setHistory] = useState<string>();
  const locked = !live || !context.control || !context.operationsLive || command.locked || busy;
  const invalid = title.trim() === '' || text.trim() === '' || bytes(title) > 200 || bytes(text) > 4096;
  useEffect(() => {
    if (pending !== undefined && context.operations.some(operation => operation.requestId === pending && operation.result === 'succeeded')) {
      setPending(undefined); setTitle(''); setText(''); setEditing(undefined);
    }
  }, [context.operations, pending]);
  const send = (input: object, reset = false): void => {
    if (locked) return;
    const requestId = crypto.randomUUID(); if (reset) setPending(requestId);
    void command.run({family: 'assistant-input', target: kind, requestId,
      upload: {name: `${kind}.json`, file: new Blob([JSON.stringify({...input, expectedRevision: view.revision})], {type: 'application/json'})}});
  };
  const edit = (entry: Preference): void => {setEditing(entry.id); setTitle(entry.title); setText(entry.text); setPending(undefined);};
  const copy = async (): Promise<void> => {
    if (!live || busy) return;
    setBusy(true); setStatus('');
    try {
      // Read at the owner's click: another page may have edited or deactivated a selected entry.
      const current = documentOf(await context.api.read(route), `${kind}/1.0`) as ActivePreferences;
      const entries = current.entries.filter(entry => entry.active && selected.includes(entry.id));
      if (entries.length === 0) {setStatus(`No selected ${kind} are currently active.`); return;}
      await navigator.clipboard.writeText(entries.map(entry => `${entry.title}\n${entry.text}`).join('\n\n'));
      setStatus(`Copied ${entries.length} active ${noun}${entries.length === 1 ? '' : 's'}.`);
    } catch {setStatus('Could not copy entries. Check the connection and clipboard permission, then try again.');}
    finally {setBusy(false);}
  };
  const exportLibrary = async (): Promise<void> => {
    if (!live || busy) return;
    setBusy(true); setStatus('');
    try {
      const library = documentOf(await context.api.read(`${route}?view=export`), `${schemaPrefix}-library/1.0`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(library)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `bunny-${kind}.json`; link.click();
      // The browser takes its download reference during activation.
      setTimeout(() => {URL.revokeObjectURL(url);}, 1000);
      setStatus('Exported the private library, including inactive entries and history.');
    } catch {setStatus('Could not export entries. Check the connection and try again.');}
    finally {setBusy(false);}
  };
  const importLibrary = async (): Promise<void> => {
    if (locked || file === undefined) return;
    setBusy(true); setStatus('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Too large');
      const library: unknown = JSON.parse(await file.text());
      // The owner validates the entire library before the tracked command can change anything.
      const requestId = crypto.randomUUID();
      await command.run({family: 'assistant-input', target: kind, requestId,
        upload: {name: `${kind}.json`, file: new Blob([JSON.stringify({action: 'import', expectedRevision: view.revision, library})], {type: 'application/json'})}});
    } catch {setStatus('Choose a valid library JSON file no larger than 10 MiB. Nothing was imported.');}
    finally {setBusy(false);}
  };
  return <>
    <fieldset disabled={locked}><legend>{editing === undefined ? `New ${noun}` : `Edit ${noun}`}</legend>
      <form onSubmit={event => {event.preventDefault(); if (!invalid) send(editing === undefined ? {action: 'create', title, text} : {action: 'edit', id: editing, title, text}, true);}}>
        <label htmlFor="preference-title">Title</label>
        <input id="preference-title" value={title} onChange={event => {setTitle(event.target.value);}} style={{width: '100%', boxSizing: 'border-box'}}/>
        <label htmlFor="preference-text">{kind === 'knowledge' ? 'Knowledge text' : 'Preference text'}</label>
        <textarea id="preference-text" rows={4} value={text} onChange={event => {setText(event.target.value);}} style={{width: '100%', boxSizing: 'border-box'}}/>
        <p>Title: {bytes(title)} / 200 bytes. Text: {bytes(text)} / 4096 bytes. Keep passwords and tokens out of {kind}.</p>
        <button type="submit" disabled={invalid}>{editing === undefined ? `Add ${noun}` : 'Save changes'}</button>
        {editing !== undefined && <button type="button" onClick={() => {setEditing(undefined); setTitle(''); setText(''); setPending(undefined);}}>Cancel edit</button>}
      </form>
    </fieldset>
    <p role="status">{command.text}</p>
    <h3>Saved {kind}</h3>
    {view.entries.length === 0 && <p>No {kind} yet.</p>}
    <div style={{overflowWrap: 'anywhere'}}>{view.entries.map(entry => <article key={entry.id} aria-label={entry.title}>
      <h4>{entry.title}</h4><p>{entry.active ? 'Active' : 'Inactive'}</p>
      <p style={{whiteSpace: 'pre-wrap'}}>{entry.text}</p>
      <label><input type="checkbox" checked={selected.includes(entry.id)} disabled={!live || !entry.active}
        onChange={event => {setSelected(previous => event.target.checked ? [...previous, entry.id] : previous.filter(id => id !== entry.id));}}/>Copy {entry.title}</label>
      <button type="button" disabled={locked} onClick={() => {edit(entry);}}>Edit</button>
      <button type="button" disabled={locked} onClick={() => {send({action: 'set-active', id: entry.id, active: !entry.active});}}>{entry.active ? 'Stop using' : 'Reactivate'}</button>
      <p>Created {time(entry.createdAtMs)}. Updated {time(entry.updatedAtMs)}.</p>
      <details open={history === entry.id} onToggle={event => {if (event.currentTarget.open) setHistory(entry.id); else setHistory(previous => previous === entry.id ? undefined : previous);}}>
        <summary>History</summary>{history === entry.id && <>
          <p>Entry ID: {entry.id}. Imported files supply their earlier history.</p>
          <ol aria-label={kind === 'knowledge' ? 'Knowledge history' : 'Preference history'}>{entry.history.map((event, index) => <li key={index}>
            <p>{event.action} · {event.source} · {time(event.atMs)} · {event.active ? 'Active' : 'Inactive'}</p>
            <p>{event.title}</p><p style={{whiteSpace: 'pre-wrap'}}>{event.text}</p>
          </li>)}</ol>
        </>}
      </details>
    </article>)}</div>
    <button type="button" disabled={!live || busy || selected.length === 0} onClick={() => {void copy();}}>Copy selected active {kind}</button>
    <p>Copy uses current active text only. Stop using keeps private history; it cannot retract text or files you already copied.</p>
    {files && <><h3>Private import and export</h3>
    <button type="button" disabled={!live || busy} onClick={() => {void exportLibrary();}}>Export library</button>
    <fieldset disabled={locked}><legend>Import {kind}</legend>
      <label htmlFor="preference-import">Import file</label><input id="preference-import" type="file" accept="application/json,.json" onChange={event => {setFile(event.target.files?.[0]);}} style={{maxWidth: '100%'}}/>
      <button type="button" disabled={file === undefined} onClick={() => {void importLibrary();}}>Import missing {kind}</button>
    </fieldset>
    <p>Import keeps existing entries exactly as they are. Missing entries arrive inactive and need explicit activation. The retained library, including history, is limited to 8 MiB.</p>
    </>}
    <p role="status">{status}</p>
  </>;
}

export function PreferencesPage({context}: {context: FrontendContext}): React.JSX.Element {
  const {api, connected} = context;
  const [state, setState] = useState<PreferenceState>();
  const [view, setView] = useState<PreferenceView>();
  const [unavailable, setUnavailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!connected) return;
    let active = true, close: (() => Promise<void>) | undefined;
    setUnavailable(true);
    void api.sync<PreferenceState>(['preference-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'preferences') {setState(change.message.data); setUnavailable(false);}
      else if (change.type === 'failed') setUnavailable(true);
    }).then(result => {
      if (result.status !== 'synced') {if (active) setUnavailable(true); return;}
      if (!active) {void result.copy.close(); return;}
      close = () => result.copy.close();
      const current = result.copy.states().find(message => message.data.id === 'preferences');
      if (current !== undefined) {setState(current.data); setUnavailable(false);}
    }, () => {if (active) setUnavailable(true);});
    return () => {active = false; void close?.();};
  }, [api, connected]);
  useEffect(() => {
    if (!connected || unavailable || state === undefined) return;
    let active = true; setLoaded(false);
    void api.read(`${endpoint}?view=manage`).then(value => {
      const next = documentOf(value, 'preference-view/1.0') as PreferenceView;
      if (active) {setView(next); setLoaded(next.revision >= state.revision);}
    }).catch(() => {if (active) setLoaded(false);});
    return () => {active = false;};
  }, [api, connected, unavailable, state]);
  const live = connected && !unavailable && loaded && view !== undefined && state !== undefined && view.revision >= state.revision;
  const {Command} = context.ui;
  return <section aria-label="Preferences" className="panel">
    <h2>Preferences</h2><p>A private library of choices you explicitly save. Nothing is added to a conversation automatically.</p>
    {!connected ? <p role="status">Disconnected. Saved preferences may be out of date.</p> : !live && <p role="status">Loading preferences. If this persists, reload the page.</p>}
    {!context.control && <p>Read-only access. Controls require operator authority.</p>}
    {view !== undefined && <Command context={context} target="preferences">{command => <EntryLibrary context={context} command={command} view={view} live={live}/>}</Command>}
  </section>;
}
