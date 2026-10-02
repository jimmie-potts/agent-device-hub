import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collect,parseMetadata} from './collector.mjs';
import {validateDataset,publicationGate} from './runtime/records.mjs';
import {CATALOG,catalogIdentity} from './runtime/views.mjs';
import {releaseIdentity,fileHash,validateRelease} from './runtime/release.mjs';
import {pageBundle,inventoryAudit} from './pages.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export const defaultOutput=resolve(here,'../outputs/epic-browser');
const json=x=>JSON.stringify(x,null,2)+'\n';
// Known credential shapes, never generic words describing credentials in a planning issue.
const credential=/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{24,})/;
export function screenPublic(dataset){
  validateDataset(dataset);
  if(credential.test(JSON.stringify(dataset)))throw Error('unsafe public artifact: credential-shaped text');
  if(!dataset.project.public&&dataset.issues.some(x=>x.project.member!==null))throw Error('unsafe public artifact: private Project');
  return dataset;
}
const bootstrap = `
const fail=error=>{document.getElementById('content').textContent='Guide unavailable: '+error.message;};
async function boot(){
 const manifest=JSON.parse(document.getElementById('binding').textContent);
 if(manifest.schemaVersion!=='guide-release/1.0'||manifest.recordsVersion!=='guide-records/2.0'||manifest.viewsVersion!=='guide-views/1.0')throw Error('unsupported release');
 const base=new URL('releases/'+manifest.releaseId.slice(7)+'/',location.href);
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 const content=structuredClone(manifest);delete content.releaseId;delete content.builtAt;content.artifacts.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if('sha256:'+await hash(new TextEncoder().encode(canonical(content)))!==manifest.releaseId)throw Error('mixed-release manifest identity');
 const paths=manifest.artifacts.map(x=>x.path);
 if(new Set(paths).size!==paths.length||['records.json','catalog.json','pages.json','app.js','style.css'].some(x=>!paths.includes(x)))throw Error('incomplete release');
 const loaded={};
 await Promise.all(manifest.artifacts.map(async artifact=>{
   if(!/^[a-zA-Z0-9._-]+$/.test(artifact.path))throw Error('unsafe asset path');
   const response=await fetch(new URL(artifact.path,base),{cache:'no-store'});if(!response.ok)throw Error('release asset unavailable');
   const bytes=await response.arrayBuffer();if(await hash(bytes)!==artifact.sha256)throw Error('mixed-release asset');
   loaded[artifact.path]=new TextDecoder().decode(bytes);
 }));
 const records=JSON.parse(loaded['records.json']),catalog=JSON.parse(loaded['catalog.json']),pages=JSON.parse(loaded['pages.json']);
 if(records.schemaVersion!==manifest.recordsVersion||records.datasetId!==manifest.datasetId||records.asOf!==manifest.asOf||pages.datasetId!==manifest.datasetId||pages.catalogId!==manifest.catalogId||catalog.catalogVersion!==manifest.viewsVersion)throw Error('mixed-release identities');
 if('sha256:'+await hash(new TextEncoder().encode(canonical(catalog)))!==manifest.catalogId)throw Error('mixed-release catalog identity');
 const css=document.createElement('style');css.textContent=loaded['style.css'];document.head.append(css);
 const blob=URL.createObjectURL(new Blob([loaded['app.js']],{type:'text/javascript'}));
 try{const app=await import(blob);app.start(records,pages,manifest,base);}finally{URL.revokeObjectURL(blob);}
}
boot().catch(fail);`;
function entry(manifest){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>B.U.N.N.Y. Work Guide</title></head><body><a class="skip" href="#page-title">Skip to content</a><header><strong>B.U.N.N.Y. · Work Guide</strong><div><button id="nav-toggle" aria-expanded="false" aria-controls="navigation">Navigation</button> <button id="theme">Toggle theme</button> <button id="print">Print this page</button> <button id="check-update">Check for updates</button></div></header><div class="shell"><nav id="navigation" aria-label="Guide pages"></nav><main><h1 id="page-title" tabindex="-1">Work Guide</h1><p id="freshness"></p><p id="update" role="status" hidden></p><details><summary>Collection gaps</summary><div id="gaps"></div></details><div id="filters" aria-label="Issue filters"></div><div id="content" aria-live="polite">Loading the validated release…</div><noscript>This browser requires JavaScript. The existing topic Guide remains available.</noscript></main></div><script type="application/json" id="binding">${JSON.stringify(manifest).replaceAll('<','\\u003c')}</script><script type="module">${bootstrap}</script></body></html>\n`;}

export async function buildCandidate(dataset,{output=defaultOutput,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}={}) {
  screenPublic(dataset);const gate=publicationGate(dataset);if(!gate.publishable)throw Error('candidate rejected: '+JSON.stringify(gate.fatal));
  const metadata=await parseMetadata(dataset.issues);
  const bundle=pageBundle(dataset);bundle.briefs=Object.fromEntries(dataset.issues.map((issue,i)=>[issue.id,metadata[i].recommendation]));
  // Public artifacts have no transport user objects, credentials, private Projects or runtime data.
  if(credential.test(JSON.stringify(bundle)))throw Error('unsafe public artifact');
  const files={'records.json':json(dataset),'catalog.json':json(CATALOG),'pages.json':json(bundle),
    'app.js':await readFile(join(here,'renderer.mjs'),'utf8'),'style.css':await readFile(join(here,'style.css'),'utf8')};
  const manifest={schemaVersion:'guide-release/1.0',releaseId:'sha256:'+'0'.repeat(64),recordsVersion:dataset.schemaVersion,viewsVersion:'guide-views/1.0',datasetId:dataset.datasetId,catalogId:catalogIdentity(CATALOG),asOf:dataset.asOf,generator:{repository:'jimmie-potts/agent-device-hub',revision},builtAt:dataset.asOf,artifacts:Object.entries(files).map(([path,bytes])=>({path,kind:path==='records.json'?'records':path==='catalog.json'?'catalog':path==='pages.json'?'page':'asset',sha256:fileHash(bytes)}))};
  manifest.releaseId=releaseIdentity(manifest);validateRelease(manifest,{dataset,catalogId:manifest.catalogId,files});
  const folder=join(output,'releases',manifest.releaseId.slice(7));await mkdir(folder,{recursive:true});
  for(const [path,bytes] of Object.entries(files))await writeFile(join(folder,path),bytes);
  await writeFile(join(folder,'release.json'),json(manifest));
  await writeFile(join(output,'audit.json'),json(inventoryAudit(dataset)));
  // Entrypoint replacement is the only candidate switch; validation failures leave it untouched.
  await writeFile(join(output,'index.html.next'),entry(manifest));
  await writeFile(join(output,'current.json.next'),json(manifest));
  await rename(join(output,'current.json.next'),join(output,'current.json'));
  await rename(join(output,'index.html.next'),join(output,'index.html'));
  return manifest;
}

export async function checkCandidate(output=defaultOutput){
 const manifest=JSON.parse(await readFile(join(output,'current.json'),'utf8'));
 const folder=join(output,'releases',manifest.releaseId.slice(7));const files={};
 for(const artifact of manifest.artifacts)files[artifact.path]=await readFile(join(folder,artifact.path));
 const dataset=JSON.parse(files['records.json']);screenPublic(dataset);
 validateRelease(manifest,{dataset,catalogId:catalogIdentity(JSON.parse(files['catalog.json'])),files});
 if(!publicationGate(dataset).publishable)throw Error('candidate publication gate failed');
 const bundle=JSON.parse(files['pages.json']);
 if(bundle.datasetId!==dataset.datasetId||bundle.catalogId!==manifest.catalogId)throw Error('mixed page models');
 const regenerated=pageBundle(dataset);
 for(const key of ['recentHistory','gaps','policy','recordsVersion','viewsVersion'])if(JSON.stringify(regenerated[key])!==JSON.stringify(bundle[key]))throw Error('page metadata regeneration differs '+key);
 for(const [key,page] of Object.entries(regenerated.pages))if(JSON.stringify(page)!==JSON.stringify(bundle.pages[key]))throw Error('page regeneration differs '+key);
 if(!String(await readFile(join(output,'index.html'))).includes(JSON.stringify(manifest).replaceAll('<','\\u003c')))throw Error('entry release binding differs');
 return {releaseId:manifest.releaseId,datasetId:dataset.datasetId,issues:dataset.issues.length,asOf:dataset.asOf};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--collect')){const d=await collect({request:process.argv.includes('--rest')?(await import('./collector.mjs')).ghRestRequest:undefined});const result=await buildCandidate(d);await mkdir(join(here,'inputs'),{recursive:true});await writeFile(join(here,'inputs/records.json'),json(d));console.log(JSON.stringify(result));}
 else if(process.argv.includes('--build'))console.log(JSON.stringify(await buildCandidate(JSON.parse(await readFile(join(here,'inputs/records.json'),'utf8')))));
 else if(process.argv.includes('--check'))console.log(JSON.stringify(await checkCandidate()));
 else throw Error('Use --collect [--rest], --build or --check');
}
