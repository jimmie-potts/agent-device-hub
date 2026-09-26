/* Browser harness for the shared device art: mounts NanoleafArt with the inputs a test supplies, so status,
   activity and reduced motion can be exercised without a hub. Bundled by apps/dashboard/tests/art.mjs; not shipped. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {NanoleafArt, type NanoleafArtProps} from '../src/art/NanoleafArt';
import '../src/style.css';
const root = createRoot(document.getElementById('root') as HTMLElement);
(window as unknown as {mountArt: (props: NanoleafArtProps) => void}).mountArt = props => root.render(<main><section><NanoleafArt {...props}/></section></main>);
