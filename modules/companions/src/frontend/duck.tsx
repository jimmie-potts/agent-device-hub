import React, {useEffect, useState} from 'react';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendApi, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {Conversation, DuckWidget as Document} from '../knowledge/model.js';
import {MessageEvidence, MessageMeaning} from './message.js';

const root = '/modules/companions/content/duck-widget';
export const conversationLabel = (value: Conversation): string => `${value.participants.map(id => id === 'microduck' ? 'MicroDuck' : id === 'reachy' ? 'Reachy' : 'B.U.N.N.Y.').join(' + ')} · ${value.id}`;
function useDuck(context: FrontendContext, history = false, after = 0) {
  const {api, connected} = context;
  const [revision, setRevision] = useState<number>();
  const [synced, setSynced] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{api: FrontendApi; key: string; document?: Document; error?: string}>();
  useEffect(() => {
    setSynced(false);
    if (!connected) return;
    let active = true, close: (() => Promise<void>) | undefined;
    void api.sync<AssistantState>(['assistant-state'], change => {
      if (!active) return;
      if (change.type === 'updated') setRevision(change.message.data.revision);
      else if (change.type === 'failed') setSynced(false);
    }).then(value => {
      if (value.status !== 'synced') return;
      if (!active) {void value.copy.close(); return;}
      close = () => value.copy.close();
      const state = value.copy.states().find(message => message.data.id === 'assistant');
      if (state !== undefined) {setRevision(state.data.revision); setSynced(true);}
    }, () => {if (active) setSynced(false);});
    return () => {active = false; void close?.();};
  }, [api, connected, refresh]);
  const key = `${revision}:${history}:${after}:${refresh}`;
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
      const code = (error as {body?: {error?: {code?: string}}} | null)?.body?.error?.code;
      setResult({api, key, error: code === 'forbidden' || code === 'unauthenticated' ? 'Access denied. Private conversation hidden.' : 'Conversation unavailable. Refresh to try again.'});
    });
    return () => {active = false;};
  }, [api, connected, synced, revision, key, after, history]);
  const current = connected && synced && result?.api === api && result.key === key ? result : undefined;
  return {document: current?.document, error: !connected ? 'Disconnected. Conversation is stale and hidden.' : current?.error,
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
export function DuckWidget({context}: {context: FrontendContext}): React.JSX.Element {
  const {document, error, refresh} = useDuck(context);
  const message = document?.messages[0];
  return <article className="widget" data-widget="duck-latest" aria-label="MicroDuck latest meaning">
    <header className="widget-head"><h2>MicroDuck</h2></header>
    {document === undefined ? <p role="status">{error ?? 'Loading selected conversation.'}</p> : document.conversation === null ? <p>No conversation selected.</p> : <>
      <Selected conversation={document.conversation}/>
      {message === undefined ? <p>No remaining Duck message.</p> : <div aria-label="Latest Duck message"><MessageMeaning message={message}/><MessageEvidence message={message}/></div>}
    </>}
    <a href="#/module/companions/duck-conversation">View conversation</a>
    <p><a href="#/module/companions/knowledge">Choose conversation</a></p>
    {error !== undefined && context.connected && <button type="button" onClick={refresh}>Refresh conversation</button>}
  </article>;
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
      {document.next !== null && <button type="button" onClick={() => {setPage({after: document.next ?? 0, conversationId: document.conversation?.id ?? null});}}>Next page</button>}
    </>}
    {after > 0 && <button type="button" onClick={() => {setPage({after: 0, conversationId: null});}}>First page</button>}
    {error !== undefined && context.connected && <button type="button" onClick={refresh}>Refresh conversation</button>}
  </section>;
}
