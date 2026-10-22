import React, {useEffect, useState} from 'react';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {PreferenceState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {EntryLibrary} from './preferences.js';
import type {Archive, CompanionMessage, ContextDocument, HistoryPage, KnowledgeView, Meaning, Persona, PersonaId} from '../knowledge/model.js';
const root = '/modules/companions/content/';
const emptyHistory = (): HistoryPage => ({schema: 'companion-history/1.0', revision: 0, availability: 'available', conversations: [], messages: [], next: null});
const label = (message: CompanionMessage): string => message.meaning.kind === 'literal' ? message.meaning.text : message.meaning.kind === 'emotion' ? message.meaning.emotion : 'Meaning unknown';
function Management({context, command, view, profiles, live, preferenceRevision}: {context: FrontendContext; command: FrontendCommand; view: KnowledgeView; profiles: Persona[]; live: boolean; preferenceRevision: number}): React.JSX.Element {
  const [profile, setProfile] = useState<PersonaId>('bunny');
  const [conversation, setConversation] = useState('');
  const [history, setHistory] = useState<HistoryPage>(emptyHistory);
  const [listed, setListed] = useState<HistoryPage>(emptyHistory);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<CompanionMessage>();
  const [meaningKind, setMeaningKind] = useState<Meaning['kind']>('literal');
  const [meaningText, setMeaningText] = useState('');
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [historyLive, setHistoryLive] = useState(false);
  const locked = !live || !context.control || !context.operationsLive || command.locked || busy;
  const persona = profiles.find(value => value.id === profile);
  useEffect(() => {setPreview('');}, [view.revision, preferenceRevision, profile, conversation, selected]);
  useEffect(() => {
    if (!live) {setHistoryLive(false); return;}
    let active = true; setHistoryLive(false);
    const query = new URLSearchParams({profile, ...(conversation === '' ? {} : {conversationId: conversation})});
    void Promise.all([context.api.read(`${root}companion-history?profile=${profile}`), context.api.read(`${root}companion-history?${query}`)]).then(([list, page]) => {
      if (!active) return;
      setListed(list as HistoryPage); setHistory(page as HistoryPage); setHistoryLive(true);
    }, () => {if (active) setStatus('History unavailable or access denied. No empty history is implied.');});
    return () => {active = false;};
  }, [context.api, live, view.revision, profile, conversation]);
  const send = (input: object): void => {
    if (locked) return;
    void command.run({family: 'assistant-input', target: 'knowledge', requestId: crypto.randomUUID(),
      upload: {name: 'knowledge.json', file: new Blob([JSON.stringify({...input, expectedRevision: view.revision})], {type: 'application/json'})}});
  };
  const contextRead = async (copy: boolean): Promise<void> => {
    if (!live || busy) return; setBusy(true); setStatus('');
    try {
      const query = new URLSearchParams({profile, messages: selected.join(','), ...(conversation === '' ? {} : {conversationId: conversation})});
      const current = await context.api.read(`${root}companion-context?${query}`) as ContextDocument;
      const value = JSON.stringify(current, null, 2); setPreview(value);
      if (copy) {await navigator.clipboard.writeText(value); setStatus('Copied current companion context.');}
    } catch {setPreview(''); setStatus('Context unavailable or access denied. Nothing was copied.');}
    finally {setBusy(false);}
  };
  const exportArchive = async (): Promise<void> => {
    if (!live || busy) return; setBusy(true);
    try {
      const archive = await context.api.read(`${root}companion-archive`) as Archive;
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'bunny-companions.json'; link.click();
      setTimeout(() => {URL.revokeObjectURL(url);}, 1000); setStatus('Exported private companion archive.');
    } catch {setStatus('Archive unavailable. Nothing was exported.');} finally {setBusy(false);}
  };
  const importArchive = async (): Promise<void> => {
    if (locked || file === undefined) return; setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Too large');
      const archive: unknown = JSON.parse(await file.text());
      await command.run({family: 'assistant-input', target: 'knowledge', requestId: crypto.randomUUID(),
        upload: {name: 'knowledge.json', file: new Blob([JSON.stringify({action: 'import-archive', expectedRevision: view.revision, archive})], {type: 'application/json'})}});
    } catch {setStatus('Choose a valid companion archive no larger than 10 MiB.');} finally {setBusy(false);}
  };
  const more = async (): Promise<void> => {
    const cursor = conversation === '' ? listed.next : history.next;
    if (!live || !historyLive || busy || cursor === null) return; setBusy(true);
    try {
      const query = new URLSearchParams({profile, ...(conversation === '' ? {} : {conversationId: conversation}), after: String(cursor)});
      const next = await context.api.read(`${root}companion-history?${query}`) as HistoryPage;
      if (conversation === '') setListed(previous => ({...next, conversations: [...previous.conversations, ...next.conversations]}));
      else setHistory(previous => ({...next, messages: [...previous.messages, ...next.messages]}));
    } catch {setStatus('History page unavailable.');} finally {setBusy(false);}
  };
  return <>
    <EntryLibrary context={context} command={command} view={view} live={live} kind="knowledge" files={false}/>
    <h3>Companion profile and context</h3>
    <label htmlFor="knowledge-persona">Companion</label><select id="knowledge-persona" value={profile} onChange={event => {
      setProfile(event.target.value as PersonaId); setConversation(''); setSelected([]); setEditing(undefined);
    }}>{profiles.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select>
    {persona !== undefined && <article aria-label="Companion profile"><h4>{persona.name}</h4><p>{persona.character}</p>
      <p>Stable ID: {persona.id}. Voice: {persona.voiceRef ?? 'Not selected'}. Audio rule: {persona.audio}. A saved voice reference does not qualify audio output.</p></article>}
    <p>Context uses current active knowledge and preferences, plus only the messages selected below. Notes about people or locations are not recognition or current location evidence. Nothing enters the synthetic task graph automatically.</p>
    <button type="button" disabled={!live || busy} onClick={() => {void contextRead(false);}}>Preview current context</button>
    <button type="button" disabled={!live || busy} onClick={() => {void contextRead(true);}}>Copy current context</button>
    {preview !== '' && <label>Current context<textarea readOnly value={preview} rows={10} style={{width: '100%', boxSizing: 'border-box'}}/></label>}
    <h3>Attributed conversation</h3>
    <button type="button" disabled={locked} onClick={() => {send({action: 'fixture'}); setProfile('reachy'); setConversation(''); setSelected([]);}}>Create synthetic Reachy–Duck exchange</button>
    <p>This fixture stores fictional dialogue only. It produces no audio or device output.</p>
    <label htmlFor="knowledge-conversation">Conversation</label><select id="knowledge-conversation" value={conversation} disabled={!live || !historyLive} onChange={event => {setConversation(event.target.value); setSelected([]); setEditing(undefined);}} style={{maxWidth: '100%'}}>
      <option value="">No conversation selected</option>{listed.conversations.map(value => <option key={value.id} value={value.id}>{value.participants.join(' + ')} · {value.id}</option>)}
    </select>
    {!historyLive && <p role="status">History unavailable or loading.</p>}
    {historyLive && conversation !== '' && history.messages.length === 0 && <p>No remaining messages.</p>}
    {conversation !== '' && <div style={{overflowWrap: 'anywhere'}}>{history.messages.map(message => <article key={message.messageId} aria-label={`${message.speakerId} message ${message.ordering.sequence}`}>
      <h4>{message.speakerId} · {message.provenance.kind === 'synthetic' ? 'Synthetic fiction' : message.provenance.kind}{message.provenance.imported ? ' · imported' : ''}</h4>
      {message.speakerId === 'microduck' && <p>Intended meaning / translation. MicroDuck audio is quacks only.</p>}
      <p style={{whiteSpace: 'pre-wrap'}}>{label(message)}</p>
      {message.legacyText !== undefined && <p>Retained legacy text (meaning and audience unqualified): {message.legacyText}</p>}
      <p>Recipients: {message.recipientIds?.join(', ') ?? 'Unknown'}. Created {new Date(message.createdAtMs).toLocaleString()}. Revision {message.revision}. Order {message.ordering.sequence}. Delivery references: {message.deliveryRefs.length === 0 ? 'None recorded' : message.deliveryRefs.join(', ')}.</p>
      <label><input type="checkbox" checked={selected.includes(message.messageId)} disabled={!live || !historyLive || (!selected.includes(message.messageId) && selected.length >= 16)} onChange={event => {setSelected(previous => event.target.checked ? [...previous, message.messageId] : previous.filter(id => id !== message.messageId));}}/>Include message {message.ordering.sequence} in context</label>
      <button type="button" disabled={locked || !historyLive} onClick={() => {setEditing(message); setMeaningKind(message.meaning.kind); setMeaningText(label(message));}}>Correct message</button>
      <button type="button" disabled={locked || !historyLive} onClick={() => {send({action: 'delete-message', messageId: message.messageId});}}>Remove message</button>
    </article>)}</div>}
    {(conversation === '' ? listed.next : history.next) !== null && <button type="button" disabled={!live || busy} onClick={() => {void more();}}>Load more history</button>}
    {editing !== undefined && <fieldset disabled={locked || !historyLive}><legend>Correct selected message</legend>
      <label htmlFor="knowledge-meaning-type">Meaning type</label><select id="knowledge-meaning-type" value={meaningKind} onChange={event => {setMeaningKind(event.target.value as Meaning['kind']);}}><option value="literal">Literal</option><option value="emotion">Emotion</option><option value="unknown">Unknown</option></select>
      {meaningKind !== 'unknown' && <label>Corrected meaning<textarea value={meaningText} onChange={event => {setMeaningText(event.target.value);}} style={{width: '100%', boxSizing: 'border-box'}}/></label>}
      <button type="button" disabled={meaningKind !== 'unknown' && meaningText.trim() === ''} onClick={() => {
        const meaning: Meaning = meaningKind === 'unknown' ? {kind: 'unknown'} : meaningKind === 'emotion' ? {kind: 'emotion', emotion: meaningText} : {kind: 'literal', text: meaningText, language: editing.meaning.kind === 'literal' ? editing.meaning.language : 'en'};
        send({action: 'correct-message', messageId: editing.messageId, meaning}); setEditing(undefined);
      }}>Save corrected meaning</button><button type="button" onClick={() => {setEditing(undefined);}}>Cancel correction</button>
    </fieldset>}
    <p>Corrections preserve creation order. Removal keeps a small deletion record and does not erase operational task evidence or old files. Finish or cancel an unfinished task before changing its messages.</p>
    <h3>Private companion archive</h3>
    <button type="button" disabled={!live || busy} onClick={() => {void exportArchive();}}>Export companion archive</button>
    <fieldset disabled={locked}><legend>Import companion archive</legend><label>Companion archive file<input type="file" accept=".json,application/json" onChange={event => {setFile(event.target.files?.[0]);}} style={{maxWidth: '100%'}}/></label>
      <button type="button" disabled={file === undefined} onClick={() => {void importArchive();}}>Import missing companion records</button></fieldset>
    <p>Existing entries and corrections win. Missing knowledge/preferences arrive inactive. Known message removals win. Use a current export for fresh recovery: an old file cannot know later deletions. Keep files private and exclude passwords or tokens.</p>
    <p role="status">{status}</p>
  </>;
}
export function KnowledgePage({context}: {context: FrontendContext}): React.JSX.Element {
  const [revision, setRevision] = useState<number>();
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [synced, setSynced] = useState(false);
  const [view, setView] = useState<KnowledgeView>();
  const [profiles, setProfiles] = useState<Persona[]>([]);
  const [loaded, setLoaded] = useState(false);
  const {api, connected} = context;
  useEffect(() => {
    if (!connected) return;
    let active = true, close: (() => Promise<void>) | undefined; setSynced(false);
    const update = (data: AssistantState | PreferenceState): void => {if (data.id === 'assistant') setRevision(data.revision); else setPreferenceRevision(data.revision);};
    void api.sync<AssistantState | PreferenceState>(['assistant-state', 'preference-state'], change => {
      if (!active) return; if (change.type === 'updated') update(change.message.data); else if (change.type === 'failed') setSynced(false);
    }).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      close = () => result.copy.close(); result.copy.states().forEach(message => {update(message.data);}); setSynced(true);
    }, () => {if (active) setSynced(false);});
    return () => {active = false; void close?.();};
  }, [api, connected]);
  useEffect(() => {
    if (!connected || !synced || revision === undefined) return;
    let active = true; setLoaded(false);
    void Promise.all([api.read(`${root}knowledge?view=manage`), api.read(`${root}companion-profiles`)]).then(([entries, personas]) => {
      if (!active) return; const value = entries as KnowledgeView;
      setView(value); setProfiles((personas as {profiles: Persona[]}).profiles); setLoaded(value.revision >= revision);
    }, () => {if (active) setLoaded(false);});
    return () => {active = false;};
  }, [api, connected, synced, revision]);
  const live = connected && synced && loaded && view !== undefined && revision !== undefined && view.revision >= revision;
  const {Command} = context.ui;
  return <section aria-label="Companion knowledge" className="panel"><h2>Companion knowledge</h2>
    <p>Explicit private notes, curated profiles and attributed conversation. No automatic learning or live model is enabled.</p>
    {!connected ? <p role="status">Disconnected. Saved knowledge may be out of date.</p> : !live && <p role="status">Knowledge unavailable or loading.</p>}
    {!context.control && <p>Read-only access. Controls require operator authority.</p>}
    {view !== undefined && <Command context={context} target="knowledge">{command => <Management context={context} command={command} view={view} profiles={profiles} live={live} preferenceRevision={preferenceRevision}/>}</Command>}
  </section>;
}
