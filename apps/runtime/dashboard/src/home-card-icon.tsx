import React from 'react';
import type {HomeCardDefinition} from './home-catalog.ts';

// Neutral identifiers only: no observed state, media reads or control adapters.
const paths: Readonly<Record<string, string>> = {
  'hub-mode': 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  sessions: 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M5 20v-2a7 7 0 0 1 14 0v2',
  inbox: 'M4 5h16l2 10v5H2v-5L4 5m-2 10h6l2 3h4l2-3h6',
  timeline: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l4 2',
  Hub: 'M3 3h7v7H3V3m11 0h7v7h-7V3M3 14h7v7H3v-7m11 0h7v7h-7v-7',
  Rooms: 'M3 11 12 3l9 8M5 9v12h14V9m-10 12v-7h6v7',
  Lights: 'M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7H8m0 3h8m-6 3h4',
  Displays: 'M3 4h18v14H3V4m5 18h8m-4-4v4M7 8h2m2 0h2m2 0h2M7 12h2m2 0h2m2 0h2',
  Audio: 'M9 17V5l11-2v12M9 17a3 3 0 1 1-3-3h3m11 1a3 3 0 1 1-3-3h3',
  Plugs: 'M8 3v5m8-5v5M5 8h14v5a7 7 0 0 1-14 0V8m7 12v3',
  Cleaning: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M7 5h10m-8 7h6m-4 5h2',
  Companions: 'M3 9h18v11H3V9m4 0V4h3v5m4 0V4h3v5M7 13h2m6 0h2m-8 4h6',
  Data: 'M4 3v18h17M8 17v-4m5 4V8m5 9V5',
  Devices: 'M7 2h10v20H7V2m0 4h10M7 18h10m-6 2h2',
};

export function HomeCardIcon({card}: {card: Pick<HomeCardDefinition, 'id' | 'category'>}): React.JSX.Element {
  return <svg className="home-card-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[card.id] ?? paths[card.category] ?? paths.Devices}/>
  </svg>;
}
