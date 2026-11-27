import React from 'react';
import {errorType} from '@jimmie-potts/sdk/remote';
import {recordCardFault, reportCardError} from './card-fault.ts';
import {RailIcon} from './rail.tsx';

/**
 * How a failed part shows in its place: a card's face, a route page's face under the page's own heading, one rail
 * button for a part of the rail, which stays icon-sized in the collapsed rail and one line in the expanded one, or
 * nothing for a part that draws nothing of its own (its marker element is hidden).
 */
export type FailedFace = 'card' | 'page' | 'rail' | 'hidden';

type Props = {
  /** The part's identity: a Home placement's widget, `component:<id>`, `module:<module>/<page>`, `page:<route>` or `part:<name>`. */
  readonly id: string;
  /** The part's name as the page already shows it. */
  readonly name: string;
  readonly face?: FailedFace;
  /**
   * The part's content. A function is called inside the boundary, as its own component's render, so a throw while the
   * content is worked out stays in the part too.
   */
  readonly children: React.ReactNode | (() => React.ReactNode);
};
type State = {readonly id: string; readonly failed: string | undefined; readonly attempt: number; readonly faults: number};

/** Draws a part's content inside its boundary. */
function Draw({draw}: {readonly draw: () => React.ReactNode}): React.ReactNode {
  return draw();
}

/**
 * Contains an error thrown while a card renders, or from one of its effects, to that card (Hub #2139). React unmounts the
 * whole page on an error no boundary catches; here the card's place shows that it failed and one Retry, which draws it
 * again and sends nothing. The failed face holds no stale content and no control of the card. Each failure is recorded
 * once (card-fault.ts) and also reported to the page as an error. The failed face carries `data-card-failed` with the
 * part's identity, `data-error-type` and `data-fault-count`, the failures recorded for this identity. A change of identity
 * is a new card: the boundary starts again, in the same render, without mounting the new card twice. Errors in event
 * handlers and async work never reach a boundary: React leaves the page mounted for those.
 */
export class CardBoundary extends React.Component<Props, State> {
  override state: State = {id: this.props.id, failed: undefined, attempt: 0, faults: 0};

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.id === state.id ? null : {id: props.id, failed: undefined, faults: 0};
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return {failed: errorType(error)};
  }

  override componentDidCatch(error: unknown): void {
    recordCardFault(undefined, this.props.id, error);
    this.setState(state => ({faults: state.faults + 1}));
    reportCardError(error);
  }

  readonly #retry = (): void => {
    this.setState(state => ({failed: undefined, attempt: state.attempt + 1}));
  };

  override render(): React.ReactNode {
    const {failed, attempt, faults} = this.state, {id, name, face = 'card', children} = this.props;
    if (failed === undefined) return <React.Fragment key={attempt}>{typeof children === 'function' ? <Draw draw={children}/> : children}</React.Fragment>;
    const marks = {'data-card-failed': id, 'data-error-type': failed, 'data-fault-count': faults};
    if (face === 'hidden') return <span hidden {...marks}/>;
    const sentence = `${name} failed to show. Retry draws it again and sends nothing.`;
    // The rail's face is a short note over a Jump-shaped Retry: the collapsed rail hides the note and the button's word, as
    // it does its other rail text, and keeps the icon; the sentence is the button's title and the face's status.
    if (face === 'rail') return <div className="rail-failed" {...marks}><p role="status" className="vh">{sentence}</p>
      <p className="rail-text rail-failed-note" aria-hidden="true">{name} failed</p>
      <button type="button" className="secondary rail-jump" aria-label={`Retry ${name}`} title={sentence} onClick={this.#retry}>
        <RailIcon name="close"/><span className="rail-text">Retry</span></button></div>;
    const statement = <p role="status">{sentence}</p>;
    const retry = <div className="actions"><button type="button" className="secondary" onClick={this.#retry}>Retry</button></div>;
    if (face === 'page') return <section aria-label={name} {...marks}><header className="page"><h1>{name}</h1></header><article className="card card-failed">{statement}{retry}</article></section>;
    return <article className="card card-failed" {...marks}><h2>{name}</h2>{statement}{retry}</article>;
  }
}
