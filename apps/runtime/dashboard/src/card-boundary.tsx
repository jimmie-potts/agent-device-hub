import React from 'react';
import {errorType} from '@jimmie-potts/sdk/remote';
import {recordCardFault} from './card-fault.ts';

type Props = {
  /** The card's identity: a Home placement's widget, `component:<id>` or `module:<module>/<page>`. */
  readonly id: string;
  /** The card's name as the page already shows it. */
  readonly name: string;
  readonly children: React.ReactNode;
};
type State = {readonly failed: string | undefined; readonly attempt: number; readonly faults: number};

/**
 * Contains an error thrown while a card renders, or from one of its effects, to that card (Hub #2139). React unmounts the
 * whole page on an error no boundary catches; here the card's place shows that it failed and one Retry, which mounts it
 * again and sends nothing. The failed face holds no stale content and no control of the card. Each failure is recorded
 * once (card-fault.ts) and also reported to the page as an error, so a test that watches page errors still fails on it.
 * A change of identity is a new card, so the boundary starts again. Errors in event handlers and async work never reach a
 * boundary: React leaves the page mounted for those.
 */
export class CardBoundary extends React.Component<Props, State> {
  override state: State = {failed: undefined, attempt: 0, faults: 0};

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return {failed: errorType(error)};
  }

  override componentDidCatch(error: unknown): void {
    recordCardFault(undefined, this.props.id, error);
    this.setState(state => ({faults: state.faults + 1}));
    globalThis.reportError(error);
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.id !== this.props.id && (this.state.failed !== undefined || this.state.faults > 0)) {
      this.setState(state => ({failed: undefined, attempt: state.attempt + 1, faults: 0}));
    }
  }

  readonly #retry = (): void => {
    this.setState(state => ({failed: undefined, attempt: state.attempt + 1}));
  };

  override render(): React.ReactNode {
    const {failed, attempt, faults} = this.state, {id, name} = this.props;
    if (failed === undefined) return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>;
    return <article className="card card-failed" data-card-failed={id} data-error-type={failed} data-fault-count={faults}>
      <h2>{name}</h2>
      <p role="status">{name} failed to show. Its controls are unavailable.</p>
      <div className="actions"><button type="button" className="secondary" onClick={this.#retry}>Retry</button></div>
    </article>;
  }
}
