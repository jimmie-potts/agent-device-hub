import React from 'react';
import type {FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {History} from './history.js';
import {OnnWidget} from './onn-widget.js';

export {OnnCard, type OnnCardProps} from './onn-card.js';
export {OnnWidget, type OnnWidgetProps} from './onn-widget.js';
export {onnAction, onnAppLabel, onnAvailability, onnFeedback, onnRecordOrder, validOnnText} from './onn-card-data.js';

function Page({context}: {context: FrontendContext}): React.JSX.Element {
  return <div className="onn-controls-page"><OnnWidget context={context}/><History ctx={context}/></div>;
}
function HistoryPage({context}: {context: FrontendContext}): React.JSX.Element {
  return <History ctx={context}/>;
}
export const frontend: FrontendContribution = {module: 'onn', pages: [{id: 'controls', Component: Page}, {id: 'history', Component: HistoryPage}]};
