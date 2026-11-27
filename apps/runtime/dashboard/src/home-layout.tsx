import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {HomeArrangements, HomeLayoutRecord, HomePlacement, LightingSelection, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {RuntimeData} from './runtime-feeds.ts';
import {useAttempt} from './command-control.tsx';
import {NavLink} from './navigation.tsx';
import {addHomeCard, artExposed, defaultHomeArrangements, heroPlacement, homeCardShapes, homeCardState, homeCatalog, savedHomeCard, shapeOf, withShapes, type HomeCardDefinition} from './home-catalog.ts';
import {HOME_GAP, HOME_UNIT, homeColumns, packShapes, shapeName, shapeSpan, type HomeShape, type ShapePlacement} from './home-shapes.ts';
import {HomeShapeContext, type HomeCardBox} from './home-shape-context.ts';
import {cardBoxes, easeCards, HomeUnfoldContext, type HomeUnfold} from './home-unfold.ts';
import {FuseProvider} from './fuse.tsx';
import type {GroupUnit} from './lighting.ts';
import {changeArtPlacement} from './home-art.ts';
import {HomeCardIcon} from './home-card-icon.tsx';
import {CardBoundary} from './card-boundary.tsx';
import {namedDevices} from './device-names.ts';
import {GlassLayer, type GlassBackdrop, type GlassState} from './glass-layer.tsx';
import {useArtBackdrop, useShowArtBackdrop} from '@jimmie-potts/art/frontend';
import './home-layout.css';
import './home-shapes.css';

type Draft = {base: number; layouts: HomeArrangements};

/** One small drawing per shape, for the Edit Home shape choice. */
function ShapeIcon({shape}: {shape: HomeShape}): React.JSX.Element {
  const span = shapeSpan[shape], w = span.columns === 2 ? 20 : 9, h = span.rows === 2 ? 20 : 9;
  return <svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeOpacity=".35"/><rect x="1" y="1" width={w} height={h} rx="2" fill="currentColor"/></svg>;
}

/**
 * The generic compact face (#1672): the card's name, its current state and an Open link to the existing page that
 * holds its full content and controls. It mounts no control adapter and reads nothing beyond the shell's records.
 */
function CompactFace({card, state, open}: {card: HomeCardDefinition; state: string; open: string | undefined}): React.JSX.Element {
  return <article className="card home-compact-face" data-home-compact={card.id}>
    <div className="home-compact-art"><HomeCardIcon card={card}/></div>
    <header><h2 title={card.name}>{card.name}</h2><p className="home-compact-state" title={state}>{state}</p></header>
    {open !== undefined && <a className="home-compact-open" href={open} aria-label={`Open ${card.name}`}>Open</a>}
  </article>;
}

/**
 * Home: the hero, then the owner's cards on the unit grid over the glass layer. `renderHero` draws the hero (#1930) with
 * the art chips Home owns, because they change the saved arrangement: Open Gallery, Pin or Unpin and Dismiss, or Restore
 * once the art is dismissed. The hero replaces the Hub mode and Art cards, so their saved placements are kept in the
 * arrangement but never drawn in the grid, offered in the picker or reported as unknown.
 */
/** A failed card's name: a device card's as the page names the device elsewhere, which its own heading follows, not its raw ID. */
function failedName(definition: HomeCardDefinition, runtime: RuntimeData): string {
  const source = definition.source;
  return source.kind === 'device' ? namedDevices(runtime, source.owner).find(device => device.record.id === source.instance)?.name ?? definition.name : definition.name;
}

export function HomeLayout({runtime, connected, operations, operationsLive, attention, inbox, renderCard, renderHero, refresh = () => Promise.resolve()}: {
  runtime: RuntimeData; connected: boolean; operations: readonly OperationRecord[]; operationsLive: boolean;
  attention: boolean; inbox: boolean; renderCard: (card: HomeCardDefinition, placement: HomePlacement, selections: LightingSelection[]) => React.ReactNode;
  renderHero: (artChips: React.ReactNode) => React.ReactNode;
  /** Reads current records again, for a lighting save whose result needs attention (#1933). */
  refresh?: () => Promise<void>;
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
  const [search, setSearch] = useState(''), searchInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{id: string; base: number; layouts: HomeArrangements}>();
  const drag = useRef<string | undefined>(undefined), host = useRef<HTMLDivElement>(null), editButton = useRef<HTMLButtonElement>(null);
  const [focusId, setFocusId] = useState<string>(), [optionsFor, setOptionsFor] = useState<string>();
  // The one light card unfolded in place (#1932), in this page's memory only, and where focus goes after a change.
  const [unfolded, setUnfolded] = useState<string>(), [unfoldFocus, setUnfoldFocus] = useState<{id: string; target: 'controls' | 'arrow'}>();
  const unfoldFrom = useRef<ReturnType<typeof cardBoxes> | undefined>(undefined);
  // The grid's width decides its columns (#1672); measured before paint and on every resize.
  const grid = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0);
  // Home draws on the glass layer (#1929): the presented artwork behind the page and every card on clear glass. Until
  // the layer draws its first frame, and without WebGL 2, the cards keep their Quiet glass panels. The art module's
  // backdrop source (#1928) owns the bitmap; a new image is uploaded in the layer's layout effect, and any state
  // without an image is the Quiet glass wash. The layer reports the rendition it has drawn, or null, as evidence.
  const [glass, setGlass] = useState<GlassState>('quiet'), backdropImage = useArtBackdrop().image, showBackdrop = useShowArtBackdrop();
  const onBackdrop = useCallback((id: string | null) => {showBackdrop(id);}, [showBackdrop]);
  useLayoutEffect(() => {
    const node = grid.current;if (node === null) return;
    const measure = (): void => {setWidth(node.clientWidth);};
    measure();const observer = new ResizeObserver(measure);observer.observe(node);
    return () => {observer.disconnect();};
  }, []);
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
  useEffect(() => {if (picker) searchInput.current?.focus();}, [picker]);
  useEffect(() => {
    if (focusId === undefined) return;
    const target = [...(host.current?.querySelectorAll<HTMLButtonElement>('[data-home-move]:not(:disabled)') ?? [])].find(button => button.dataset.homeMove === focusId) ?? host.current?.querySelector<HTMLButtonElement>('[data-home-add]:not(:disabled)');
    target?.focus();setFocusId(undefined);
  }, [focusId, entries]);
  useEffect(() => {
    if (pending === undefined) return;
    const operation = operations.find(item => item.requestId === pending.id && item.family === 'home-layout-set');
    if (live && operation?.status === 'completed' && operation.result === 'succeeded' && record !== undefined && record.revision > pending.base && JSON.stringify(record.layouts) === JSON.stringify(pending.layouts)) {
      setDraft(undefined);setPending(undefined);setPicker(false);setMessage('Home layout saved.');editButton.current?.focus();
    } else if (command.requestId === pending.id && !command.locked && operation?.result !== 'succeeded') {setPending(undefined);setMessage(command.text);}
  }, [pending, operations, live, record, command.locked, command.requestId, command.text]);
  const unknown = entries.filter(entry => !heroPlacement(entry.widget) && savedHomeCard(entry.widget, catalog) === undefined);
  const reported = useRef(new Set<number>());
  useEffect(() => {
    if (record !== undefined && unknown.length > 0 && !reported.current.has(record.revision)) {reported.current.add(record.revision);setMessage('Some saved cards are no longer registered and were omitted. Review the layout before saving.');}
  }, [record, unknown.length]);
  // Dismissed art leaves Home: the backdrop is the Quiet glass wash, and the hero offers Restore.
  const artEntry = entries.find(entry => entry.widget === 'art'), artDismissed = artEntry?.hidden === true;
  const backdrop = useMemo<GlassBackdrop | null>(() => backdropImage === null || artDismissed ? null
    : {id: backdropImage.renditionId, bitmap: backdropImage.bitmap, width: backdropImage.width, height: backdropImage.height}, [backdropImage, artDismissed]);
  const shown = entries.filter(entry => !heroPlacement(entry.widget) && (!entry.hidden || protectedCard(entry.widget)) && savedHomeCard(entry.widget, catalog) !== undefined);
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
  // Every explicit save stores each placement's shape and the width that agrees with it; loading never writes.
  const save = (): void => {
    if (!editable || draft === undefined || conflict || pending !== undefined) return;
    const value = structuredClone(draft.layouts);
    for (const key of ['desktop', 'phone'] as const) value[key] = value[key].filter(entry => heroPlacement(entry.widget) || savedHomeCard(entry.widget, catalog) !== undefined);
    const layouts = withShapes(value, catalog), id = crypto.randomUUID();setPending({id, base: draft.base, layouts});setMessage('Saving Home layout…');
    void command.run({family: 'home-layout-set', target: 'home', requestId: id, data: {expectedRevision: draft.base, layouts}});
  };
  // The hero is inert while Home is edited, so art chips always save the current saved arrangement.
  const updateArt = (next: HomeArrangements): void => {
    if (!editable || record === undefined || pending !== undefined || draft !== undefined) return;
    const layouts = withShapes(next, catalog), id = crypto.randomUUID();setPending({id, base: record.revision, layouts});setMessage('Saving Art placement…');
    void command.run({family: 'home-layout-set', target: 'home', requestId: id, data: {expectedRevision: record.revision, layouts}});
  };
  const artDisabled = !editable || pending !== undefined || conflict;
  // The Art card's placement controls, as hero chips (#1930). Each changes only the saved arrangement, through the same
  // revision-guarded save: Pin or Unpin keeps the saved format, Dismiss hides the art and Restore shows it again.
  const automaticArt = artEntry === undefined || artEntry.art?.pinned === false;
  const artChips = artDismissed
    ? <button type="button" className="home-hero-chip" disabled={artDisabled} onClick={() => {updateArt(changeArtPlacement(layouts, breakpoint, {hidden: false}));}}>Restore art</button>
    : artExposed(runtime, connected) ? <>
      <a className="home-hero-chip" href="#/module/art/gallery">Open Gallery</a>
      <button type="button" className="home-hero-chip" disabled={artDisabled} onClick={() => {
        updateArt(changeArtPlacement(layouts, breakpoint, {art: {format: artEntry?.art?.format ?? 'auto', pinned: automaticArt}}));
      }}>{automaticArt ? 'Pin art' : 'Unpin art'}</button>
      <button type="button" className="home-hero-chip" disabled={artDisabled} onClick={() => {updateArt(changeArtPlacement(layouts, breakpoint, {hidden: true}));}}>Dismiss art</button>
    </> : null;
  const locked = !editable || conflict || pending !== undefined;
  // Wide layouts place every card on one unit grid in one of four shapes (#1672). Cards stay flat grid children in saved
  // order; the Phone arrangement and narrow screens stack every card at its content height with its full content.
  const narrow = breakpoint === 'phone' || width > 0 && width < 2 * HOME_UNIT + HOME_GAP;
  const columns = homeColumns(width), cell = (width - HOME_GAP * (columns - 1)) / columns;
  const saved = new Map(shown.flatMap(entry => {const definition = savedHomeCard(entry.widget, catalog);return definition === undefined ? [] : [[entry.widget, shapeOf(entry, definition)] as const];}));
  // A light card in Small square can unfold on the grid outside Edit Home (#1932); the open one packs as Large square
  // with the same first-fit packing. Its saved shape is unchanged.
  const unfoldable = (id: string): boolean => !editing && !narrow && width > 0 && saved.get(id) === 'square' && savedHomeCard(id, catalog)?.source.kind === 'light';
  const open = unfolded !== undefined && unfoldable(unfolded) ? unfolded : undefined;
  const shapes = open === undefined ? saved : new Map([...saved, [open, 'large-square' as const]]);
  const packed = narrow || width === 0 ? undefined : packShapes(shown.flatMap(entry => {const shape = shapes.get(entry.widget);return shape === undefined ? [] : [{id: entry.widget, shape}];}), columns);
  const area = (place: ShapePlacement): React.CSSProperties => ({gridColumn: `${String(place.column)} / span ${String(place.columns)}`, gridRow: `${String(place.row)} / span ${String(place.rows)}`});
  const categories = ['All', ...new Set(catalog.map(card => card.category))];
  const query = search.trim().toLocaleLowerCase();
  const matches = catalog.filter(card => (category === 'All' || card.category === category) && `${card.name} ${card.category}`.toLocaleLowerCase().includes(query));
  const lights = shown.flatMap(value => {const card = savedHomeCard(value.widget, catalog);return card?.source.kind === 'light' ? [card.source.selection] : [];});
  // What can be grouped on Home (#1933): the light, group and plug cards shown, in Home order.
  const units = shown.flatMap((value): GroupUnit[] => {
    const source = savedHomeCard(value.widget, catalog)?.source;
    if (source?.kind === 'light') return source.selection.kind === 'room' ? [] : [source.selection];
    return source?.kind === 'device' && source.owner === 'bunny/modules/wemo' ? [{kind: 'plug', id: source.instance, owner: source.owner}] : [];
  });
  // A placed card's outer size follows from the grid alone: its cells plus the gaps between them (#1672).
  const boxOf = (place: ShapePlacement, shape: HomeShape): HomeCardBox => ({shape, width: place.columns * cell + (place.columns - 1) * HOME_GAP, height: place.rows * cell + (place.rows - 1) * HOME_GAP});
  // Opening or closing a light records every card's box first, so the cards that move ease from there (home-unfold.ts).
  // A card being dragged to group (#1933) keeps the grid still: nothing opens or closes until the drag ends.
  const unfold = (id: string | undefined, focus: 'controls' | 'arrow' | undefined): void => {
    if (id === open || (grid.current?.querySelector('[data-fuse-dragging]') ?? null) !== null) return;
    unfoldFrom.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? undefined : cardBoxes(grid.current);
    const target = id ?? open;
    setUnfolded(id);setUnfoldFocus(focus === undefined || target === undefined ? undefined : {id: target, target: focus});
  };
  const unfoldOf = (id: string): HomeUnfold => ({open: open === id, focus: unfoldFocus?.id === id ? unfoldFocus.target : undefined, focused: () => {setUnfoldFocus(undefined);},
    toggle: () => {unfold(open === id ? undefined : id, open === id ? 'arrow' : 'controls');}});
  // Edit Home, a narrow screen or the Phone arrangement close the open card, so it does not open again later.
  useEffect(() => {if (unfolded !== undefined && open === undefined && width > 0) setUnfolded(undefined);}, [unfolded, open, width]);
  useLayoutEffect(() => {const from = unfoldFrom.current;unfoldFrom.current = undefined;if (from !== undefined) easeCards(grid.current, from);}, [open]);
  // Escape closes the open card; focus returns to its arrow when it was inside the card.
  useEffect(() => {
    if (open === undefined) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const card = host.current?.querySelector(`[data-home-card="${CSS.escape(open)}"]`), active = document.activeElement;
      event.preventDefault();unfold(undefined, active === null || active === document.body || card?.contains(active) === true ? 'arrow' : undefined);
    };
    document.addEventListener('keydown', escape);return () => {document.removeEventListener('keydown', escape);};
  });
  return <div className={`home-layout${editing ? ' is-editing' : ''}${breakpoint === 'phone' ? ' home-phone' : ''}`} ref={host} data-glass={glass}>
    <GlassLayer onState={setGlass} backdrop={backdrop} onBackdrop={onBackdrop} fuse/>
    <header className="page home-layout-heading"><h1 data-glass-veil>Home</h1><div className="actions" data-glass-veil><NavLink route={{kind: 'audio'}}>Audio</NavLink><NavLink route={{kind: 'timeline'}}>Timeline</NavLink>{!editing && <button type="button" className="secondary" ref={editButton} disabled={!editable} onClick={() => {
      if (record === undefined) return;setSelected(natural);setOptionsFor(undefined);setDraft({base: record.revision, layouts: structuredClone(current)});setMessage('');
    }}>Edit Home</button>}</div></header>
    {/* Editing disables the hero's controls as it does the cards'. */}
    <div className="home-hero-slot" inert={editing}>{renderHero(artChips)}</div>
    {!live && <p role="status" className="hint" data-glass-veil>Home layout is unavailable or stale. Editing is read-only.</p>}
    {editing && <div className="home-edit-toolbar"><div className="actions"><button type="button" data-home-add disabled={locked} onClick={() => {setPicker(value => !value);}}>Add card</button>
      <button type="button" className="secondary" disabled={locked} onClick={() => {
        // Reset keeps the hero's saved placements (#1930), so a dismissed or pinned art survives it.
        const next = structuredClone(layouts);next[breakpoint] = [...defaults[breakpoint], ...layouts[breakpoint].filter(entry => heroPlacement(entry.widget))];change(next);
      }}>Reset</button></div>
      <div className="actions" role="group" aria-label="Layout to edit">{(['desktop', 'phone'] as const).map(value => <button key={value} type="button" className="secondary" aria-pressed={selected === value} onClick={() => {setSelected(value);}}>{value === 'desktop' ? 'Desktop' : 'Phone'}</button>)}</div>
      <div className="actions"><button type="button" className="secondary" disabled={pending !== undefined && command.locked} onClick={() => {setDraft(undefined);setPicker(false);setMessage('Changes discarded.');editButton.current?.focus();}}>Cancel</button><button type="button" disabled={locked} onClick={save}>Done</button></div>
    </div>}
    {conflict && <p role="alert" data-glass-veil>Home changed in another browser. <button type="button" className="secondary" disabled={!editable} onClick={reload}>Load saved layout</button></p>}
    {editing && picker && <section className="home-card-picker" aria-label="Add a card"><header><h2>Add a card</h2><button type="button" className="secondary" onClick={() => {setPicker(false);}}>Close</button></header>
      <label className="home-picker-search"><span className="vh">Search cards</span><input ref={searchInput} type="search" placeholder="Search cards" value={search} onChange={event => {setSearch(event.target.value);}}/></label>
      <div className="actions" role="group" aria-label="Card categories">{categories.map(value => <button type="button" key={value} className="secondary" aria-pressed={category === value} onClick={() => {setCategory(value);}}>{value}</button>)}</div>
      <p role="status" aria-atomic="true" className={matches.length === 0 ? 'home-picker-empty' : 'vh'}>{matches.length === 0 ? 'No cards found.' : `${String(matches.length)} cards`}</p>
      {matches.length === 0 && <button type="button" className="secondary" onClick={() => {setSearch('');setCategory('All');searchInput.current?.focus();}}>Reset filters</button>}
      <div className="home-catalog" role="list">{matches.map(card => {
        const existing = entries.find(entry => entry.widget === card.id);
        return <div key={card.id} role="listitem"><HomeCardIcon card={card}/><span><strong>{card.name}</strong><small>{card.reason ?? card.category}</small></span><button type="button" className="secondary" aria-label={`${existing?.hidden === false ? 'Added' : existing?.hidden === true ? 'Show' : 'Add'} ${card.name}`} disabled={locked || card.reason !== undefined || existing?.hidden === false || (['desktop', 'phone'] as const).some(key => layouts[key].length >= 128 && !layouts[key].some(entry => entry.widget === card.id))} onClick={() => {change(addHomeCard(layouts, breakpoint, card));setMessage(`${card.name} added.`);}}>{existing?.hidden === false ? 'Added' : existing?.hidden === true ? 'Show' : 'Add'}</button></div>;
      })}</div></section>}
    <FuseProvider runtime={runtime} connected={connected} operations={operations} operationsLive={operationsLive} units={units} selections={lights} enabled={!editing && pending === undefined} refresh={refresh}>
    <div className="home-layout-grid" ref={grid} data-packed={packed !== undefined} data-columns={packed === undefined ? 1 : columns}
      style={packed === undefined ? undefined : {gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`, gridAutoRows: `${String(cell)}px`}}>{shown.map((entry, index) => {
      const definition = savedHomeCard(entry.widget, catalog);if (definition === undefined) return null;
      const placed = entries.some(value => value.widget === entry.widget);
      const required = protectedCard(entry.widget), reason = required ? 'This card stays visible while it needs attention.' : undefined;
      const place = packed?.cards.get(entry.widget), shape = place === undefined ? undefined : shapes.get(entry.widget);
      const offered = homeCardShapes(definition), generic = shape !== undefined && offered.generic.includes(shape);
      // Worked out inside the card's boundary (below), so a throw here stays in the card.
      const content = (): React.ReactNode => generic ? <CompactFace card={definition} state={homeCardState(definition, runtime, connected)} open={offered.open}/>
        : definition.source.kind === 'unavailable' ? <article className="card"><h2>{definition.name}</h2><p>{definition.reason}</p></article> : renderCard(definition, entry, lights);
      return <div key={entry.widget} className={`home-layout-card${shape === undefined ? '' : ` home-shape-${shape}`}`} data-home-card={entry.widget} data-glass-panel={entry.widget} data-home-shape={shape} data-home-offers={offered.shapes.join(' ')} data-home-unfolded={open === entry.widget ? '' : undefined}
        style={place === undefined ? undefined : area(place)} onDragOver={event => {if (editing && drag.current !== undefined) event.preventDefault();}} onDrop={event => {
        if (!editing || drag.current === undefined) return;event.preventDefault();event.stopPropagation();const source = drag.current;drag.current = undefined;move(source, entry.widget);
      }}>
        {editing && <div className="home-card-editor" role="group" aria-label={`Edit ${definition.name}`}>
          <button type="button" className="secondary home-move" data-home-move={entry.widget} disabled={locked || !placed} draggable={!locked && placed} aria-label={`Move ${definition.name}; use arrow keys`} onDragStart={event => {drag.current = entry.widget;event.dataTransfer.setData('application/x-bunny-home-card', entry.widget);event.dataTransfer.effectAllowed = 'move';}} onDragEnd={() => {drag.current = undefined;}} onKeyDown={event => {
            if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.key)) {event.preventDefault();step(entry.widget, event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1);}
          }}>↕</button>
          {packed !== undefined && <><span className="home-card-editor-name">{definition.name}</span>
            <button type="button" className="secondary home-card-options-toggle" data-home-options={entry.widget} aria-expanded={optionsFor === entry.widget} aria-label={`Options for ${definition.name}`} onClick={() => {setOptionsFor(value => value === entry.widget ? undefined : entry.widget);}}>⋯</button></>}
          {/* On the grid (#1672) the bar is one row with the card's name; its other controls open below it, one card at a time. */}
          {(packed === undefined || optionsFor === entry.widget) && <div className={packed === undefined ? 'home-card-editor-controls' : 'home-card-options'} role="group" aria-label={`Options for ${definition.name}`} onKeyDown={event => {
            if (event.key !== 'Escape' || packed === undefined) return;event.preventDefault();setOptionsFor(undefined);host.current?.querySelector<HTMLButtonElement>(`[data-home-options="${CSS.escape(entry.widget)}"]`)?.focus();
          }}>
          <button type="button" className="secondary" aria-label={`Move ${definition.name} earlier`} disabled={locked || !placed || index === 0} onClick={() => {step(entry.widget, -1);}}>↑</button>
          <button type="button" className="secondary" aria-label={`Move ${definition.name} later`} disabled={locked || !placed || index === shown.length - 1} onClick={() => {step(entry.widget, 1);}}>↓</button>
          {breakpoint === 'desktop' && offered.shapes.length > 1 && <span className="home-shape-choice" role="group" aria-label={`Shape of ${definition.name}`}>{offered.shapes.map(value => {
            const current = shapes.get(entry.widget) ?? offered.standard;
            return <button key={value} type="button" className="secondary" aria-pressed={current === value} aria-label={shapeName[value]} title={shapeName[value]} disabled={locked || !placed} onClick={() => {
              const next = structuredClone(layouts), found = next[breakpoint].find(item => item.widget === entry.widget);
              if (found !== undefined) {found.shape = value;change(next);setMessage(`${definition.name}: ${shapeName[value]}.`);}
            }}><ShapeIcon shape={value}/></button>;
          })}</span>}
          <button type="button" className="secondary" aria-label={`Hide ${definition.name}`} title={reason} disabled={locked || required} onClick={() => {const next = structuredClone(layouts), found = next[breakpoint].find(value => value.widget === entry.widget);if (found !== undefined) found.hidden = true;change(next);focusAfterRemoval(index);}}>Hide</button>
          <button type="button" className="secondary" aria-label={`Remove ${definition.name}`} title={reason} disabled={locked || required} onClick={() => {const next = structuredClone(layouts);next[breakpoint] = next[breakpoint].filter(value => value.widget !== entry.widget);change(next);focusAfterRemoval(index);}}>×</button>
          {required && <small>{reason}</small>}
          </div>}
        </div>}
        <div className="home-card-content" inert={editing}><HomeShapeContext.Provider value={generic || shape === undefined || place === undefined ? undefined : boxOf(place, shape)}>
          <HomeUnfoldContext.Provider value={unfoldable(entry.widget) ? unfoldOf(entry.widget) : undefined}><CardBoundary id={entry.widget} name={failedName(definition, runtime)}>{content}</CardBoundary></HomeUnfoldContext.Provider></HomeShapeContext.Provider></div>
      </div>;
    })}
      {editing && packed?.holes.map(hole => <div key={`${String(hole.row)}:${String(hole.column)}`} className="home-hole" aria-hidden="true" data-glass-veil style={{gridColumn: String(hole.column), gridRow: String(hole.row)}}><span>Empty</span></div>)}
    </div>
    </FuseProvider>
    {shown.length === 0 && <p data-glass-veil>No cards here. Choose Edit Home to add one.</p>}
    {editing && entries.some(entry => entry.hidden && !heroPlacement(entry.widget)) && <div className="home-hidden" data-glass-veil><span>Hidden</span>{entries.filter(entry => entry.hidden && !heroPlacement(entry.widget)).map(entry => {
      const card = savedHomeCard(entry.widget, catalog);return card === undefined ? null : <button type="button" key={entry.widget} className="secondary" disabled={locked || card.reason !== undefined} onClick={() => {change(addHomeCard(layouts, breakpoint, card));}}>Show {card.name}</button>;
    })}</div>}
    <p role="status" className="hint home-layout-feedback" data-glass-veil>{pending !== undefined || command.locked ? command.text : message}</p>
  </div>;
}
