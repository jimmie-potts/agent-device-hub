// Browser and generated-output checks for the shared Places navigation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
let playwright;
for(const candidate of [process.env.GUIDE_PLAYWRIGHT_MODULE,'playwright'].filter(Boolean)){
 try{playwright=require(candidate);break;}catch{}
}
assert(playwright,'Set GUIDE_PLAYWRIGHT_MODULE to installed Playwright.');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'places.json'),'utf8')).places;
const expected=manifest.map(p=>p.label);
const doc=relative=>path.join(root,relative);
const pages=[
 ['guide',doc('docs/work-guide/outputs/agent-device-work-guides.html')],
 ...fs.readdirSync(doc('docs/work-guide/outputs/architecture')).filter(f=>f.endsWith('.html')).map(f=>['architecture',doc('docs/work-guide/outputs/architecture/'+f)]),
 ['atlas',doc('docs/system-design/index.html')],
 ['atlas',doc('docs/system-design/full-system-design.html')],
 ...fs.readdirSync(doc('docs/system-design/components')).filter(f=>f.endsWith('.html')).map(f=>['atlas',doc('docs/system-design/components/'+f)]),
 ['atlas',doc('docs/system-design/diagrams/state-and-actions.html')],
 ['reference',doc('docs/system-design/reference/index.html')],
 ...fs.readdirSync(doc('docs/system-design/reference/api')).filter(f=>f.endsWith('.html')).map(f=>['reference',doc('docs/system-design/reference/api/'+f)]),
];
for(const [current,file] of pages){
 const html=fs.readFileSync(file,'utf8');
 assert.equal((html.match(/<!-- places:start -->/g)||[]).length,1,file);
 assert(html.includes(`data-current="${current}"`),file);
 assert(html.includes('id="places-style"'),file);
}
const stage=process.env.BUNNY_PUBLIC_STAGE;
let publicPages=0;
if(stage){
 const staged=JSON.parse(fs.readFileSync(path.join(stage,'atlas/manifest.json'),'utf8')).placesPages;
 for(const [relative,digest] of Object.entries(staged)){
  const file=path.join(stage,relative),content=fs.readFileSync(file);
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'),digest,relative);
  assert.equal((content.toString().match(/<!-- places:start -->/g)||[]).length,1,relative);
  publicPages++;
 }
}
const out=process.env.BUNNY_PLACES_RECEIPTS || fs.mkdtempSync(path.join(os.tmpdir(),'bunny-places-'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await playwright.chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const samples=[pages[0],pages[1],pages.find(p=>p[0]==='atlas'),pages.find(p=>p[1].endsWith('/state-and-actions.html')),pages.find(p=>p[0]==='reference')];
  for(const [current,file] of samples){
   await page.goto(pathToFileURL(file).href,{waitUntil:'domcontentloaded'});
   const nav=page.getByRole('navigation',{name:'Places'});
   assert.equal(await nav.count(),1,file);
   const labels=await nav.locator('a, [aria-current=page]').allTextContents();
   assert.deepEqual(labels.map(s=>s.replace(/Local/g,'').trim()),expected,file);
   assert.equal(await nav.locator('[aria-current=page]').count(),1,file);
   assert.equal(await nav.getAttribute('data-current'),current,file);
   assert.equal(await nav.locator('a').count(),5,file);
   assert.equal(await nav.locator('.places-nav__tag').count(),2,file);
   assert(await nav.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth+1),`Places overflow at 390px: ${file}`);
   await nav.screenshot({path:path.join(out,`${current}${file.endsWith('/state-and-actions.html')?'-state':''}-390.png`)});
  }
  const receipt={passed:true,sourcePages:pages.length,publicPages,mobileSamples:samples.length,labels:expected,output:out};
  fs.writeFileSync(path.join(out,'places.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
