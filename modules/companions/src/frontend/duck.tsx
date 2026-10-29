import React, {useEffect, useId, useRef, useState} from 'react';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendApi, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {Conversation, DuckWidget as Document, HistoryPage} from '../knowledge/model.js';
import {MessageEvidence, MessageMeaning, meaningLabel} from './message.js';
import {CompanionCard} from './card.js';

const root = '/modules/companions/content/duck-widget';
function readError(error: unknown): string {
  const value = error as {body?: {error?: {code?: string}}; error?: {code?: string}} | null;
  const code = value?.body?.error?.code ?? value?.error?.code;
  return code === 'forbidden' || code === 'unauthenticated' ? 'Access denied. Private conversation hidden.' : 'Conversation unavailable. Refresh to try again.';
}
export const conversationLabel = (value: Conversation): string => `${value.participants.map(id => id === 'microduck' ? 'MicroDuck' : id === 'reachy' ? 'Reachy' : 'B.U.N.N.Y.').join(' + ')} · ${value.id}`;
function useDuck(context: FrontendContext, history = false, after = 0) {
  const {api, connected} = context;
  const [revision, setRevision] = useState<number>();
  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{api: FrontendApi; key: string; document?: Document; error?: string}>();
  useEffect(() => {
    setSynced(false); setSyncError(undefined);
    if (!connected) return;
    let active = true, replacing = false, copy: import('@jimmie-potts/sdk/remote').SyncedCopy<AssistantState> | undefined;
    const invalidate = (): void => {setSynced(false); setResult(undefined); setEpoch(value => value + 1);};
    const show = (): void => {
      const state = copy?.states().find(message => message.data.id === 'assistant');
      if (state !== undefined) {setRevision(state.data.revision); setSynced(true); setSyncError(undefined);}
      else {invalidate(); setSyncError(readError(null));}
    };
    void api.sync<AssistantState>(['assistant-state'], change => {
      if (!active) return;
      if (change.type === 'updated') setRevision(change.message.data.revision);
      else if (change.type === 'failed') {replacing = true; invalidate(); setSyncError(readError(change.error));}
      else if (change.type === 'removed' && change.entity.id === 'assistant') {replacing = true; invalidate(); setSyncError(readError(null));}
      else if (change.type === 'synced') {replacing = false; if (copy !== undefined) show();}
    }, {onRestarted: () => {if (active) {replacing = true; invalidate();}}}).then(value => {
      if (value.status !== 'synced') {if (active) setSyncError(readError(value.error)); return;}
      if (!active) {void value.copy.close(); return;}
      copy = value.copy;
      if (!replacing) show();
    }, (error: unknown) => {if (active) {setSynced(false); setSyncError(readError(error));}});
    return () => {active = false; void copy?.close();};
  }, [api, connected, refresh]);
  const key = `${epoch}:${revision}:${history}:${after}:${refresh}`;
  useEffect(() => {
    if (!connected || !synced || revision === undefined) return;
    let active = true; setResult(undefined);
    const query = new URLSearchParams({view: history ? 'history' : 'latest', after: String(after)});
    void api.read(`${root}?${query}`).then(value => {
      if (!active) return;
      const document = value as Document | undefined;
      if (document?.schema !== 'duck-widget/1.0' || !Number.isSafeInteger(document.revision) || document.revision < revision ||
        !Array.isArray(document.messages) || (document.conversation !== null && typeof document.conversation?.id !== 'string')) {
        setResult({api, key, error: 'Conversation unavailable. Refresh to try again.'}); return;
      }
      setResult({api, key, document});
    }, (error: unknown) => {
      if (!active) return;
      setResult({api, key, error: readError(error)});
    });
    return () => {active = false;};
  }, [api, connected, synced, revision, key, after, history]);
  const current = connected && synced && result?.api === api && result.key === key ? result : undefined;
  return {document: current?.document, error: !connected ? 'Disconnected. Conversation is stale and hidden.' : syncError ?? current?.error,
    refresh: () => {setRefresh(value => value + 1);}};
}
function Selected({conversation}: {conversation: Conversation}): React.JSX.Element {
  return <p style={{overflowWrap: 'anywhere'}}>Selected conversation: {conversationLabel(conversation)}</p>;
}
export function DuckSelection({context, command, conversation, locked, revision}: {
  context: FrontendContext; command: FrontendCommand; conversation: Conversation | undefined; locked: boolean; revision: number;
}): React.JSX.Element {
  const {document, error} = useDuck(context);
  const save = (conversationId: string | null): void => {
    if (locked || document === undefined) return;
    void command.run({family: 'assistant-input', target: 'knowledge', requestId: crypto.randomUUID(),
      upload: {name: 'knowledge.json', file: new Blob([JSON.stringify({action: 'select-duck-conversation', conversationId, expectedRevision: revision})], {type: 'application/json'})}});
  };
  return <fieldset disabled={locked || document === undefined}><legend>Duck Home widget</legend>
    {document?.conversation == null ? <p>{error ?? (document === undefined ? 'Loading widget selection.' : 'No Home conversation selected.')}</p> : <Selected conversation={document.conversation}/>}
    <button type="button" disabled={conversation === undefined || !conversation.participants.includes('reachy') || !conversation.participants.includes('microduck')}
      onClick={() => {if (conversation !== undefined) save(conversation.id);}}>Show selected conversation on Home</button>
    <button type="button" disabled={document?.conversation == null} onClick={() => {save(null);}}>Clear Home conversation</button>
    <p>Select a conversation containing Reachy and MicroDuck above. Home reads only that conversation.</p>
  </fieldset>;
}
function DuckControls({context, document, onReadFailure}: {context: FrontendContext; document: Document | undefined; onReadFailure: (error: string) => void}): React.JSX.Element {
  const uid = useId(), generation = useRef(0);
  const [picker, setPicker] = useState(false), [busy, setBusy] = useState(false), [choice, setChoice] = useState('');
  const [listed, setListed] = useState<HistoryPage>();
  useEffect(() => {
    generation.current += 1; setPicker(false); setListed(undefined); setChoice(''); setBusy(false);
    return () => {generation.current += 1;};
  }, [context.api, context.connected, context.control, document?.revision]);
  const load = async (more = false): Promise<void> => {
    if (document === undefined || !context.connected || !context.control || !context.operationsLive || busy) return;
    const current = ++generation.current; setPicker(true); setBusy(true);
    try {
      const query = new URLSearchParams({profile: 'reachy', ...(more && listed?.next != null ? {after: String(listed.next)} : {})});
      const value = await context.api.read(`/modules/companions/content/companion-history?${query}`) as HistoryPage;
      if (current !== generation.current) return;
      if (value.schema !== 'companion-history/1.0' || !Number.isSafeInteger(value.revision) || value.revision < document.revision || !Array.isArray(value.conversations)) throw new Error('Unavailable');
      const conversations = value.conversations.filter(item => typeof item.id === 'string' && Array.isArray(item.participants) && item.participants.includes('reachy') && item.participants.includes('microduck'));
      const choices = more ? [...listed?.conversations ?? [], ...conversations] : conversations;
      setListed({...value, conversations: [...new Map(choices.map(item => [item.id, item])).values()]});
      if (!more) setChoice(conversations.find(item => item.id === document.conversation?.id)?.id ?? conversations[0]?.id ?? '');
    } catch (error: unknown) {if (current === generation.current) {setListed(undefined); onReadFailure(readError(error));}}
    finally {if (current === generation.current) setBusy(false);}
  };
  const controls = (command?: FrontendCommand): React.ReactNode => {
    const locked = document === undefined || !context.connected || !context.control || !context.operationsLive || command === undefined || command.locked || busy;
    const save = (conversationId: string | null): void => {
      if (locked || command === undefined || document === undefined) return;
      const revision = conversationId === null ? document.revision : listed?.revision;
      if (revision === undefined || conversationId !== null && listed?.conversations.some(item => item.id === conversationId) !== true) return;
      void command.run({family: 'assistant-input', target: 'knowledge', requestId: crypto.randomUUID(),
        upload: {name: 'knowledge.json', file: new Blob([JSON.stringify({action: 'select-duck-conversation', conversationId, expectedRevision: revision})], {type: 'application/json'})}});
      setPicker(false);
    };
    return <>
      {!picker || document === undefined ? <>
        <div><p className="companion-small">Selected conversation</p><p className="companion-small">{document === undefined ? 'Unavailable' : document.conversation === null ? 'None selected' : conversationLabel(document.conversation)}</p></div>
        <button type="button" className="companion-primary" disabled={locked} onClick={() => {void load();}}>Choose conversation</button>
        <button type="button" className="companion-link" disabled={locked || document?.conversation == null} onClick={() => {save(null);}}>Clear selection</button>
      </> : <>
        <label htmlFor={`${uid}-conversation`} className="companion-small">Conversation</label>
        <select id={`${uid}-conversation`} value={choice} disabled={locked || listed === undefined} onChange={event => {setChoice(event.target.value);}}>
          {listed === undefined ? <option value="">Loading conversations…</option> : listed.conversations.length === 0 ? <option value="">No eligible conversations</option> : listed.conversations.map(item => <option key={item.id} value={item.id}>{conversationLabel(item)}</option>)}
        </select>
        <div className="companion-actions"><button type="button" className="companion-primary" disabled={locked || choice === ''} onClick={() => {save(choice);}}>Use conversation</button>
          <button type="button" className="companion-secondary" onClick={() => {generation.current += 1; setBusy(false); setPicker(false);}}>Cancel</button></div>
        {listed?.next != null && <button type="button" className="companion-link" disabled={locked} onClick={() => {void load(true);}}>More conversations</button>}
      </>}
      {!context.control && <p className="companion-small">Read-only access.</p>}
      {command?.text !== undefined && command.text !== '' && <p role="status" className="companion-small">{command.text}</p>}
    </>;
  };
  // Reader views do not acquire a command control, including their empty/error states.
  return <>{context.control ? <context.ui.Command context={context} target="knowledge">{command => controls(command)}</context.ui.Command> : controls()}</>;
}
export function DuckWidget({context}: {context: FrontendContext}): React.JSX.Element {
  const {document, error, refresh} = useDuck(context);
  const [blocked, setBlocked] = useState<{api: FrontendApi; revision: number | undefined; error: string}>();
  const blockedError = blocked?.api === context.api && blocked?.revision === document?.revision ? blocked?.error : undefined;
  const current = blockedError === undefined ? document : undefined, message = current?.messages[0];
  const notice = error ?? blockedError;
  const reload = (): void => {setBlocked(undefined); refresh();};
  const time = message === undefined ? undefined : new Date(message.createdAtMs);
  return <CompanionCard companion="duck" name="MicroDuck" caption="Quack → meaning"
    {...(notice !== undefined ? {notice: <><p>{notice}</p>{context.connected && <button type="button" onClick={reload}>Refresh conversation</button>}</>} : {})}
    faces={[
      {id: 'meaning', label: 'Meaning', content: current === undefined ? <p role="status">Conversation unavailable.</p> : current.conversation === null ? <p>No conversation selected.</p> : message === undefined ? <p>No remaining Duck message.</p> : <div aria-label="Latest Duck message">
        <p className="companion-message">{meaningLabel(message)}</p>
        {message.meaning.kind === 'emotion' && <p className="companion-small">Emotional expression{message.meaning.intensity === undefined ? '' : ` · intensity ${message.meaning.intensity}`}</p>}
        {message.legacyText !== undefined && <p>Retained legacy text (meaning and audience unqualified): {message.legacyText}</p>}
        <p className="companion-small">{time === undefined || Number.isNaN(time.getTime()) ? 'Time unavailable' : <time dateTime={time.toISOString()}>{time.toLocaleString()}</time>}
          {' · '}{message.provenance.kind === 'synthetic' ? 'Synthetic fiction' : message.provenance.kind}{message.provenance.imported ? ' · imported' : ''}</p>
        <p className="companion-small"><span>Playback unknown.</span>{message.deliveryRefs.length > 0 && <> Delivery reference recorded.</>}</p>
      </div>},
      {id: 'conversation', label: 'Conversation', content: <DuckControls context={context} document={current}
        onReadFailure={value => {setBlocked({api: context.api, revision: document?.revision, error: value});}}/>},
    ]} footer={<a href="#/module/companions/duck-conversation">View conversation</a>}/>;
}
export function DuckConversation({context}: {context: FrontendContext}): React.JSX.Element {
  const [page, setPage] = useState<{after: number; conversationId: string | null}>({after: 0, conversationId: null});
  const {after} = page;
  const {document, error, refresh} = useDuck(context, true, after);
  const changed = document !== undefined && after > 0 && document.conversation?.id !== page.conversationId;
  useEffect(() => {if (changed) setPage({after: 0, conversationId: null});}, [changed]);
  return <section className="panel" aria-label="Duck and Reachy conversation"><h2>Duck and Reachy conversation</h2>
    <a href="#/">Back to Home</a>
    {document === undefined || changed ? <p role="status">{error ?? 'Loading selected conversation.'}</p> : document.conversation === null ? <p>No conversation selected.</p> : <>
      <Selected conversation={document.conversation}/>
      {document.messages.length === 0 && <p>No remaining messages on this page.</p>}
      {document.messages.map(message => <article key={message.messageId} aria-label={`${message.speakerId} message ${message.ordering.sequence}`}>
        <h3>{message.speakerId === 'microduck' ? 'MicroDuck' : message.speakerId === 'reachy' ? 'Reachy' : message.speakerId}</h3>
        <MessageMeaning message={message}/><MessageEvidence message={message}/>
      </article>)}
    </>}
    <button type="button" aria-disabled={document?.next == null || changed} onClick={() => {
      if (document?.next != null && !changed) setPage({after: document.next, conversationId: document.conversation?.id ?? null});
    }}>Next page</button>
    {after > 0 && <button type="button" onClick={() => {setPage({after: 0, conversationId: null});}}>First page</button>}
    {error !== undefined && context.connected && <button type="button" onClick={refresh}>Refresh conversation</button>}
  </section>;
}
