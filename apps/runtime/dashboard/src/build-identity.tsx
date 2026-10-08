import React, {useEffect, useState} from 'react';
import {childOf} from '@jimmie-potts/sdk/remote';
import {Facts} from './ui.tsx';
type Build = {version: string | null; revision: string | null; dirty: boolean | null; builtAt: string | null};
export function BuildIdentity(): React.JSX.Element {
  const [build, setBuild] = useState<Build>();
  useEffect(() => {
    let active = true;
    void fetch('/api/v2/build', {credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: childOf(undefined)})
      .then(async response => { if (response.ok) { const body = await response.json() as Build; if (active) setBuild(body); } })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return <div className="card"><h2>Running build</h2><Facts items={[
    ['Runtime version', build?.version ?? 'Unknown'], ['Revision', build?.revision ?? 'Unknown'],
    ['Source changes at build', build?.dirty === null || build?.dirty === undefined ? 'Unknown' : build.dirty ? 'Present' : 'None'],
    ['Built at', build?.builtAt ?? 'Unknown'],
  ]}/><p className="hint">This identifies the runtime serving this page. It does not establish installation or device acceptance.</p></div>;
}
