import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {HomeArrangements, HomeLayoutRecord, HomePlacement, LightingSelection, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {RuntimeData} from './runtime-feeds.ts';
import {useAttempt} from './command-control.tsx';
import {NavLink} from './navigation.tsx';
import {addHomeCard, defaultHomeArrangements, homeCatalog, savedHomeCard, type HomeCardDefinition} from './home-catalog.ts';
import './home-layout.css';

const sizes = {small: 'Small', medium: 'Standard', large: 'Wide'};
type Draft = {base: number; layouts: HomeArrangements};
export function HomeLayout({runtime, connected, operations, operationsLive, attention, inbox, renderCard}: {
  runtime: RuntimeData; connected: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  attention: boolean; inbox: boolean; renderCard: (card: HomeCardDefinition, placement: HomePlacement, selections: LightingSelection[]) => React.ReactNode;
}): React.JSX.Element {
  const catalog = useMemo(() => homeCatalog(runtime, connected), [runtime, connected]);
  const copy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'home-layout');
  const record = (copy?.records as readonly HomeLayoutRecord[] | undefined)?.find(value => value.id === 'home');
  const defaults = defaultHomeArrangements(catalog), current = record?.layouts ?? defaults;
  const command = useAttempt('home', operations.filter(item => item.family === 'home-layout-set'), operationsLive, undefined, 'core/home-layout');
  const live = connected && !runtime.catalogFailed && copy?.synced === true && record !== undefined && runtime.modules?.some(module => module.name === 'core' && module.state === 'running') === true;
  const editable = live && runtime.control && operationsLive && !command.locked;
  const [natural, setNatural] = useState<'desktop' | 'phone'>(() => window.matchMedia('(max-width: 600px)').matches ? 'phone' : 'desktop');
  const [selected, setSelected] = useState(natural), [draft, setDraft] = useState<Draft>();
  const [picker, setPicker] = useState(false), [category, setCategory] = useState('All'), [message, setMessage] = useState('');
  const [pending, setPending] = useState<{id: string; base: number; layouts: HomeArrangements}>();
  const drag = useRef<string | undefined>(undefined), host = useRef<HTMLDivElement>(null), editButton = useRef<HTMLButtonElement>(null);
  const [focusId, setFocusId] = useState<string>();
  const editing = draft !== undefined, breakpoint = editing ? selected : natural;
  const previousEditing = useRef(false), previousPicker = useRef(false), returnFocus = useRef(false);
  const layouts = draft?.layouts ?? current, entries = layouts[breakpoint];
  const conflict = draft !== undefined && record !== undefined && draft.base !== record.revision;
  const protectedCard = (id: string): boolean => id === 'inbox' && inbox || id === 'sessions' && attention;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)'), changed = (): void => {setNatural(media.matches ? 'phone' : 'desktop');};
    media.addEventListener('change', changed);return () => {media.removeEventListener('change', changed);};
  }, []);
  useEffect(() => {
    if (previousEditing.current && !editing) returnFocus.current = true;
    if (!editing && editable && returnFocus.current) {editButton.current?.focus();returnFocus.current = false;}
    if (editing && (!previousEditing.current || previousPicker.current && !picker)) host.current?.querySelector<HTMLButtonElement>('[data-home-add]')?.focus();
    previousEditing.current = editing;previousPicker.current = picker;
  }, [editing, picker, editable]);
  useEffect(() => {
    if (focusId === undefined) return;
    const target = [...(host.current?.querySelectorAll<HTMLButtonElement>('[data-home-move]') ?? [])].find(button => button.dataset.homeMove === focusId) ?? host.current?.querySelector<HTMLButtonElement>('[data-home-add]');
    target?.focus();setFocusId(undefined);
  }, [focusId, entries]);
  useEffect(() => {
    if (pending === undefined) return;
    const operation = operations.find(item => item.requestId === pending.id && item.family === 'home-layout-set');
    if (live && operation?.status === 'completed' && operation.result === 'succeeded' && record !== undefined && record.revision > pending.base && JSON.stringify(record.layouts) === JSON.stringify(pending.layouts)) {
      setDraft(undefined);setPending(undefined);setPicker(false);setMessage('Home layout saved.');editButton.current?.focus();
    } else if (command.requestId === pending.id && !command.locked && operation?.result !== 'succeeded') {setPending(undefined);setMessage(command.text);}
  }, [pending, operations, live, record, command.locked, command.requestId, command.text]);
  const unknown = entries.filter(entry => savedHomeCard(entry.widget, catalog) === undefined);
  const reported = useRef(new Set<number>());
  useEffect(() => {
    if (record !== undefined && unknown.length > 0 && !reported.current.has(record.revision)) {reported.current.add(record.revision);setMessage('Some saved cards are no longer registered and were omitted. Review the layout before saving.');}
  }, [record, unknown.length]);
  const shown = entries.filter(entry => (!entry.hidden || protectedCard(entry.widget)) && savedHomeCard(entry.widget, catalog) !== undefined);
  for (const id of ['inbox', 'sessions']) if (protectedCard(id) && !shown.some(entry => entry.widget === id)) shown.push({widget: id, size: id === 'inbox' ? 'small' : 'medium', hidden: false});
  const change = (next: HomeArrangements): void => {if (draft !== undefined && editable && !conflict && pending === undefined) setDraft({...draft, layouts: next});};
  const move = (id: string, target: string): void => {
    const next = structuredClone(layouts), list = next[breakpoint], from = list.findIndex(entry => entry.widget === id), to = list.findIndex(entry => entry.widget === target);
    if (from < 0 || to < 0 || from === to) return;
    const [entry] = list.splice(from, 1);if (entry !== undefined) list.splice(to, 0, entry);change(next);setFocusId(id);setMessage('Card moved.');
  };
  const focusAfterRemoval = (index: number): void => {setFocusId(shown[index + 1]?.widget ?? shown[index - 1]?.widget ?? '');};
  const step = (id: string, delta: number): void => {const index = shown.findIndex(entry => entry.widget === id), target = shown[index + delta];if (target !== undefined) move(id, target.widget);};
  const reload = (): void => {if (!editable || record === undefined) return;setPending(undefined);setDraft({base: record.revision, layouts: structuredClone(current)});setMessage('Current saved layout loaded. Review before saving.');};
  const save = (): void => {
    if (!editable || draft === undefined || conflict || pending !== undefined) return;
    const value = structuredClone(draft.layouts);
    for (const key of ['desktop', 'phone'] as const) value[key] = value[key].filter(entry => savedHomeCard(entry.widget, catalog) !== undefined);
    const id = crypto.randomUUID();setPending({id, base: draft.base, layouts: value});setMessage('Saving Home layout…');
    void command.run({family: 'home-layout-set', target: 'home', requestId: id, data: {expectedRevision: draft.base, layouts: value}});
  };
  const locked = !editable || conflict || pending !== undefined;
  const categories = ['All', ...new Set(catalog.map(card => card.category))];
  return <div className={`home-layout${editing ? ' is-editing' : ''}${breakpoint === 'phone' ? ' home-phone' : ''}`} ref={host}>
    <header className="page home-layout-heading"><h1>Home</h1><div className="actions"><NavLink route={{kind: 'timeline'}}>Timeline</NavLink>{!editing && <button type="button" className="secondary" ref={editButton} disabled={!editable} onClick={() => {
      if (record === undefined) return;setSelected(natural);setDraft({base: record.revision, layouts: structuredClone(current)});setMessage('');
    }}>Edit Home</button>}</div></header>
    {!live && <p role="status" className="hint">Home layout is unavailable or stale. Editing is read-only.</p>}
    {editing && <div className="home-edit-toolbar"><div className="actions"><button type="button" data-home-add disabled={locked} onClick={() => {setPicker(value => !value);}}>Add card</button>
      <button type="button" className="secondary" disabled={locked} onClick={() => {const next = structuredClone(layouts);next[breakpoint] = defaults[breakpoint];change(next);}}>Reset</button></div>
      <div className="actions" role="group" aria-label="Layout to edit">{(['desktop', 'phone'] as const).map(value => <button key={value} type="button" className="secondary" aria-pressed={selected === value} onClick={() => {setSelected(value);}}>{value === 'desktop' ? 'Desktop' : 'Phone'}</button>)}</div>
      <div className="actions"><button type="button" className="secondary" disabled={pending !== undefined && command.locked} onClick={() => {setDraft(undefined);setPicker(false);setMessage('Changes discarded.');editButton.current?.focus();}}>Cancel</button><button type="button" disabled={locked} onClick={save}>Done</button></div>
    </div>}
    {conflict && <p role="alert">Home changed in another browser. <button type="button" className="secondary" disabled={!editable} onClick={reload}>Load saved layout</button></p>}
    {editing && picker && <section className="home-card-picker" aria-label="Add a card"><header><h2>Add a card</h2><button type="button" className="secondary" onClick={() => {setPicker(false);}}>Close</button></header>
      <div className="actions" role="group" aria-label="Card categories">{categories.map(value => <button type="button" key={value} className="secondary" aria-pressed={category === value} onClick={() => {setCategory(value);}}>{value}</button>)}</div>
      <div className="home-catalog">{catalog.filter(card => category === 'All' || card.category === category).map(card => {
        const existing = entries.find(entry => entry.widget === card.id);
        return <div key={card.id}><span><strong>{card.name}</strong><small>{card.reason ?? card.category}</small></span><button type="button" className="secondary" aria-label={`${existing?.hidden === false ? 'Added' : existing?.hidden === true ? 'Show' : 'Add'} ${card.name}`} disabled={locked || card.reason !== undefined || existing?.hidden === false || (['desktop', 'phone'] as const).some(key => layouts[key].length >= 128 && !layouts[key].some(entry => entry.widget === card.id))} onClick={() => {change(addHomeCard(layouts, breakpoint, card));setMessage(`${card.name} added.`);}}>{existing?.hidden === false ? 'Added' : existing?.hidden === true ? 'Show' : 'Add'}</button></div>;
      })}</div></section>}
    <div className="home-layout-grid">{shown.map((entry, index) => {
      const definition = savedHomeCard(entry.widget, catalog);if (definition === undefined) return null;
      const size = definition.sizes.includes(entry.size) ? entry.size : definition.sizes[0] ?? 'medium';
      const placed = entries.some(value => value.widget === entry.widget);
      const required = protectedCard(entry.widget), reason = required ? 'This card stays visible while it needs attention.' : undefined;
      return <div key={entry.widget} className={`home-layout-card home-size-${size}`} data-home-card={entry.widget} onDragOver={event => {if (editing && drag.current !== undefined) event.preventDefault();}} onDrop={event => {
        if (!editing || drag.current === undefined) return;event.preventDefault();event.stopPropagation();const source = drag.current;drag.current = undefined;move(source, entry.widget);
      }}>
        {editing && <div className="home-card-editor" role="group" aria-label={`Edit ${definition.name}`}>
          <button type="button" className="secondary home-move" data-home-move={entry.widget} disabled={locked || !placed} draggable={!locked && placed} aria-label={`Move ${definition.name}; use arrow keys`} onDragStart={event => {drag.current = entry.widget;event.dataTransfer.setData('application/x-bunny-home-card', entry.widget);event.dataTransfer.effectAllowed = 'move';}} onDragEnd={() => {drag.current = undefined;}} onKeyDown={event => {
            if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.key)) {event.preventDefault();step(entry.widget, event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1);}
          }}>↕</button>
          <button type="button" className="secondary" aria-label={`Move ${definition.name} earlier`} disabled={locked || !placed || index === 0} onClick={() => {step(entry.widget, -1);}}>↑</button>
          <button type="button" className="secondary" aria-label={`Move ${definition.name} later`} disabled={locked || !placed || index === shown.length - 1} onClick={() => {step(entry.widget, 1);}}>↓</button>
          <select aria-label={`Size of ${definition.name}`} value={size} disabled={locked || !placed} onChange={event => {
            const next = structuredClone(layouts), found = next[breakpoint].find(value => value.widget === entry.widget);if (found !== undefined) found.size = event.target.value as HomePlacement['size'];change(next);
          }}>{definition.sizes.map(value => <option key={value} value={value}>{sizes[value]}</option>)}</select>
          <button type="button" className="secondary" aria-label={`Hide ${definition.name}`} title={reason} disabled={locked || required} onClick={() => {const next = structuredClone(layouts), found = next[breakpoint].find(value => value.widget === entry.widget);if (found !== undefined) found.hidden = true;change(next);focusAfterRemoval(index);}}>Hide</button>
          <button type="button" className="secondary" aria-label={`Remove ${definition.name}`} title={reason} disabled={locked || required} onClick={() => {const next = structuredClone(layouts);next[breakpoint] = next[breakpoint].filter(value => value.widget !== entry.widget);change(next);focusAfterRemoval(index);}}>×</button>
          {required && <small>{reason}</small>}
        </div>}
        <div className="home-card-content" inert={editing}>{definition.source.kind === 'unavailable' ? <article className="card"><h2>{definition.name}</h2><p>{definition.reason}</p></article> : renderCard(definition, {...entry, size}, shown.flatMap(value => {const card = savedHomeCard(value.widget, catalog);return card?.source.kind === 'light' ? [card.source.selection] : [];}))}</div>
      </div>;
    })}</div>
    {shown.length === 0 && <p>No cards here. Choose Edit Home to add one.</p>}
    {editing && entries.some(entry => entry.hidden) && <div className="home-hidden"><span>Hidden</span>{entries.filter(entry => entry.hidden).map(entry => {
      const card = savedHomeCard(entry.widget, catalog);return card === undefined ? null : <button type="button" key={entry.widget} className="secondary" disabled={locked || card.reason !== undefined} onClick={() => {change(addHomeCard(layouts, breakpoint, card));}}>Show {card.name}</button>;
    })}</div>}
    <p role="status" className="hint home-layout-feedback">{pending !== undefined || command.locked ? command.text : message}</p>
  </div>;
}
