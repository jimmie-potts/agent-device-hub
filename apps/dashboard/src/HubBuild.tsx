import React,{useEffect,useState} from 'react';
import type {Context} from './client';
import {Facts} from './controls';

/** Metadata describes the serving process; neither the browser nor Hub guesses from a current link. */
export function HubBuild({build}:{build:Context['build']}){
 const revision=typeof build?.sourceRevision==='string'&&/^[0-9a-f]{40}(?![\s\S])/.test(build.sourceRevision)?build.sourceRevision:undefined;
 const version=typeof build?.version==='string'&&build.version.length<=128&&/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?:\+[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?![\s\S])/.test(build.version)?build.version:'Unknown';
 const [status,setStatus]=useState('');
 useEffect(()=>setStatus(''),[revision]);
 async function copy(){if(!revision)return;try{await navigator.clipboard.writeText(revision);setStatus('Full revision copied.');}catch{setStatus('Copy unavailable. Select the full revision to copy it.');}}
 return <section aria-label="Running Hub build"><h3>Running Hub</h3><Facts items={[
  ['Version',version],['Source revision',revision?revision.slice(0,12):'Unknown']
 ]}/>{revision&&<><details className="details"><summary>Full revision</summary><label>Full source revision<input readOnly value={revision} onFocus={event=>event.currentTarget.select()}/></label></details><button className="secondary" onClick={()=>void copy()}>Copy full revision</button><p role="status" className="hint">{status}</p></>}</section>;
}
