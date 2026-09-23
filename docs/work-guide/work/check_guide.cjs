const fs = require('fs'), os = require('os'), path = require('path');
const {pathToFileURL} = require('url');
const assert = require('assert/strict');
const crypto = require('crypto');
// Resolve installed packages and browsers. These checks never install software.
let playwrightPath;
for (const candidate of [process.env.GUIDE_PLAYWRIGHT_MODULE,'playwright','/mnt/c/Users/onesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try {playwrightPath=require.resolve(candidate); break;} catch {}
}
assert(playwrightPath,'Set GUIDE_PLAYWRIGHT_MODULE to an installed Playwright module');
const {chromium}=require(playwrightPath);
const cache=process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(),'.cache/ms-playwright');
const installed=fs.existsSync(cache)?fs.readdirSync(cache).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})):[];
const executablePath=[process.env.GUIDE_CHROMIUM_PATH,chromium.executablePath(),
  ...installed.filter(n=>n.startsWith('chromium_headless_shell-')).map(n=>path.join(cache,n,'chrome-headless-shell-linux64/chrome-headless-shell')),
  ...installed.filter(n=>n.startsWith('chromium-')).map(n=>path.join(cache,n,'chrome-linux64/chrome'))].find(p=>p&&fs.existsSync(p));
assert(executablePath,'Set GUIDE_CHROMIUM_PATH to an installed Chromium executable');
(async()=>{
  const root=path.resolve(__dirname,'..'), file=path.join(root,'outputs/agent-device-work-guides.html');
  const read=name=>JSON.parse(fs.readFileSync(path.join(root,'work/backlogs',name),'utf8'));
  const coverage=read('guide-coverage.json'), snapshot=read('snapshot.json');
  const receipts=JSON.parse(fs.readFileSync(path.join(root,'work/architecture/diagram-receipts.json'),'utf8')), sources=JSON.parse(fs.readFileSync(path.join(root,'work/architecture/source-receipts.json'),'utf8')), history=JSON.parse(fs.readFileSync(path.join(root,'work/history/github-history.json'),'utf8'));
  const diagramIds=receipts.diagrams.map(d=>d.id), sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(diagramIds.length,9,'Nine diagrams rendered');
  for(const d of receipts.diagrams){assert.equal(d.validation.checksPassed,9);assert.equal(d.validation.checkCount,9);assert.equal(d.validation.errors,0);assert.equal(d.validation.warnings,0);assert.equal(sha(path.join(root,'outputs/architecture',`${d.id}.html`)),d.artifact.sha256,`Companion viewer matches receipt for ${d.id}`);}
  const repos={H:'agent-device-hub',N:'codex-nanoleaf',P:'divoom-app-upgrade'};
  const issueMap=Object.fromEntries(Object.entries(repos).flatMap(([key,repo])=>read(`${repo}-issues.json`).map(i=>[`${key}${i.number}`,i])));
  const openKeys=Object.keys(issueMap).filter(k=>issueMap[k].state==='OPEN').sort();
  const primary=Object.values(coverage).flat(), ids=Object.keys(coverage), count=ids.length;
  assert.equal(new Set(primary).size,primary.length,'Unique primary coverage');
  assert.deepEqual(primary.slice().sort(),openKeys,'Every current open issue has one primary guide');
  assert(!primary.includes('P26')); assert.equal(issueMap.P26.state,'CLOSED'); assert.equal(issueMap.P26.stateReason,'completed');
  const oldIds=['local-acceptance','shared-codex','nanoleaf-devices','tidbyt-lifx','nanoleaf-presentation','pixoo-media','controls-music','hosting-migrations','assistant-access','development-workflow'];
  assert.deepEqual(ids.slice().sort(),[...oldIds,'pc-lighting','desktop-controls'].sort());
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[],requests=[];
    // External requests are attributed per frame: the guide's own frame must make none; the companion Archify viewer
    // (loaded on demand in an iframe) may reference its template's Google Fonts stylesheet, which is blocked here.
    const companionRequests=[];
    page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>{if(!/^https?:/.test(r.url()))return; if(r.frame()===page.mainFrame())requests.push(r.url()); else companionRequests.push(r.url());});
    await page.route(/^https?:/,r=>r.abort());
    await page.goto(pathToFileURL(file).href);
    const meta=JSON.parse(await page.locator('#snapshot-data').textContent());
    assert.equal(meta.refreshedAt,snapshot.refreshedAt); assert.equal(meta.staticSnapshot,true);
    assert.equal(meta.openIssues,openKeys.length); assert.equal(meta.guideCount,count); assert.equal(meta.projectCount,Object.keys(repos).length);
    assert.deepEqual(meta.primaryCoverage,coverage); assert.equal(await page.locator('.guide').count(),count);
    assert.equal(meta.architecture.diagramCount,9); assert.equal(meta.architecture.countedInIssueTotals,false); assert.equal(meta.architecture.reviewedAt,sources.reviewedAt); assert.deepEqual(meta.architecture.sourceRevisions,sources.sourceRevisions);
    assert.notEqual(meta.architecture.reviewedAt,meta.refreshedAt,'Architecture review timestamp is separate from the backlog snapshot');
    assert.equal(meta.history.historyFetchedAt,history.fetchedAt); assert.equal(meta.history.roadmapNodes,await page.locator('.roadmap .node').count());
    assert.equal(await page.locator('.reference').count(),2); assert.equal(await page.locator('#architecture.reference:not(.guide)').count(),1); assert.equal(await page.locator('#timeline.reference:not(.guide)').count(),1);
    assert.deepEqual(await page.locator('.diagram').evaluateAll(es=>es.map(e=>e.id)),diagramIds);
    for(const id of diagramIds){const fig=page.locator(`#${id}`); assert.equal(await fig.locator('.diagram-canvas > svg').count(),1); assert((await fig.locator('.diagram-canvas > svg > title').textContent()).length>5,'SVG title'); assert((await fig.locator('.diagram-canvas > svg > desc').textContent()).length>40,'SVG accessible description'); assert(await fig.locator('.status').textContent()); assert(await fig.locator('.diagram-text li').count()>=4,'Reading and boundary text'); assert(await fig.locator('.diagram-sources a[href^="https://github.com/"]').count()>=1,'Pinned source links'); assert.equal(await fig.locator('.viewer-link').getAttribute('href'),`architecture/${id}.html`);}
    const svgIds=await page.locator('.diagram-canvas svg [id]').evaluateAll(es=>es.map(e=>e.id)); assert.equal(new Set(svgIds).size,svgIds.length,'Inline SVG ids are unique across diagrams');
    assert.equal(await page.locator('.diagram [data-issue]').count()>0,true); const guideRefs=new Set(await page.locator('.guide [data-issue]').evaluateAll(es=>es.map(e=>e.dataset.issue))); assert(primary.every(k=>guideRefs.has(k)),'Primary coverage lives in work guides, not the reference section');
    await page.locator('#timeline > summary').click();
    assert.equal(await page.locator('.next-action').count(),count,'Every guide leads with its next step');
    assert.equal(await page.locator('.delivery-evidence[open],.guide-evidence[open]').count(),0,'Evidence starts folded');
    for(const [key,status,label] of [['P34','completed','Completed'],['H67','blocked','Blocked'],['H64','review','In review']]) {
      const refs=page.locator(`a[data-issue="${key}"]`);
      assert(await refs.evaluateAll((es,status)=>es.every(e=>e.dataset.status===status),status));
      assert(await refs.evaluateAll((es,label)=>es.every(e=>e.querySelector('.issue-status').textContent.includes(label)),label));
      assert(await refs.evaluateAll(es=>es.every(e=>e.getAttribute('aria-label').includes(e.querySelector('.issue-status').textContent))),'Accessible status matches visible text');
    }
    const completedLink=page.locator('.overview a[data-issue="P34"]');
    await completedLink.focus(); assert(await completedLink.evaluate(e=>e===document.activeElement),'Status links stay keyboard reachable');
    for(const unit of await page.locator('.parallel-unit[data-scheduling="candidate"]').evaluateAll(es=>es.map(e=>e.dataset.unit))) {
      assert.equal(issueMap[unit].state,'OPEN');
      assert(!issueMap[unit].labels.some(l=>['blocked','deferred','status:in-progress','status:review'].includes(l.name)));
    }
    // Timeline: history marks link to GitHub, roadmap covers every open issue once, tooltips and filters work.
    const prs=Object.values(history.repositories).reduce((n,r)=>n+r.mergedPRs.length,0); assert.equal(await page.locator('.history a.pr').count(),prs); assert.equal(Number(await page.locator('#timeline .stats-row .stat strong').first().textContent()),prs);
    const roadmapIssues=(await page.locator('.roadmap .node').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')))).join(' ');
    for(const key of openKeys){const label=new RegExp(`${{H:'Hub',N:'Nanoleaf',P:'Pixoo'}[key[0]]} #${key.slice(1)}(?!\\d)`); assert(label.test(roadmapIssues),`Roadmap lists ${key}`); assert.equal((roadmapIssues.match(new RegExp(label.source,'g'))||[]).length,1,`Roadmap lists ${key} exactly once`);}
    assert(await page.locator('.roadmap .node').evaluateAll(es=>es.every(e=>document.getElementById(e.getAttribute('href').slice(1))?.classList.contains('guide'))),'Roadmap nodes link to work guides');
    await page.locator('.history a.pr circle').first().hover(); assert(await page.locator('#timeline-tip').isVisible()); assert((await page.locator('#timeline-tip').textContent()).includes('PR #')); await page.locator('.history a.pr circle').first().focus(); assert(await page.locator('#timeline-tip').isVisible(),'Tooltip on keyboard focus');
    await page.locator('.roadmap .node[data-node="n-codex"] rect').hover(); assert((await page.locator('#timeline-tip').textContent()).includes('Shared Codex integration')); assert(await page.locator('.roadmap .edge.lit').count()>0,'Prerequisite edges highlight');
    await page.locator('#timeline .repo-chip[data-repo="P"]').click(); assert(await page.locator('.history a.pr.dim').count()>0); assert.equal(await page.locator('.history a.pr[data-repo="P"].dim').count(),0); await page.locator('#timeline .repo-chip[data-repo="all"]').click(); assert.equal(await page.locator('#timeline .dim').count(),0);
    assert.deepEqual(await page.locator('.stats strong').allTextContents(),[String(openKeys.length),String(count),String(Object.keys(repos).length).padStart(2,'0')]);
    for(const [key,repo] of Object.entries(repos)) {
      const total=openKeys.filter(k=>k.startsWith(key)).length;
      assert.equal(meta.repositoryCounts[key],total); assert.equal(snapshot.repositories[repo].openIssues,total);
      assert.equal(snapshot.repositories[repo].paginationComplete,true);
      assert.equal(await page.locator(`.repo-legend .repo-${key} b`).textContent(),String(total));
    }
    const links=await page.locator('[data-issue]').evaluateAll(es=>es.map(e=>({key:e.dataset.issue,url:e.href,state:e.dataset.state})));
    for(const l of links) {assert.equal(l.url,issueMap[l.key].url);assert.equal(l.state,issueMap[l.key].state);}
    for(const id of ids) {
      const guide=page.locator(`#${id}`), owned=coverage[id];
      assert.deepEqual((await guide.getAttribute('data-primary')).split(' ').filter(Boolean),owned);
      assert.equal(Number(await guide.getAttribute('data-count')),owned.length);
      assert.equal(Number(await page.locator(`nav a[data-guide="${id}"] .nav-count`).textContent()),owned.length);
      const refs=await guide.locator('[data-issue]').evaluateAll(es=>es.map(e=>e.dataset.issue));
      assert(owned.every(k=>refs.includes(k)),`Primary links present in ${id}`);
    }
    const anchorIds=await page.locator('[id]').evaluateAll(es=>es.map(e=>e.id));
    assert.equal(new Set(anchorIds).size,anchorIds.length,'Unique internal anchors');
    // Both HTML and SVG anchors (roadmap nodes, history marks) must resolve and stay on GitHub.
    assert(await page.locator('a[href^="#"]').evaluateAll(es=>es.every(e=>document.getElementById(e.getAttribute('href').slice(1)))));
    assert(await page.locator('a[href^="https:"]').evaluateAll(es=>es.every(e=>new URL(e.getAttribute('href')).hostname==='github.com'&&e.getAttribute('target')==='_blank'&&(e.getAttribute('rel')||'').includes('noopener')&&(e.getAttribute('rel')||'').includes('noreferrer'))));
    assert(await page.locator('svg a[href^="#"], svg a[href^="https:"]').count()>0,'SVG anchors are covered by the link checks');
    assert((await page.locator('.document-note').textContent()).includes('Static snapshot refreshed'));
    assert((await page.locator('meta[name="description"]').getAttribute('content')).includes(`${openKeys.length} open issues`));
    const summary=`${count} guides · ${openKeys.length} issues in these guides · ${diagramIds.length} diagrams`;
    assert.equal(await page.locator('#result-count').textContent(),summary);
    assert.equal(await page.locator('.future-scenarios').getAttribute('open'),null,'Future scenarios start collapsed on load');
    const screenshot=name=>page.screenshot({path:path.join(root,`work/guide-${name}.png`)});
    await page.evaluate(()=>window.scrollTo(0,0)); await screenshot('desktop'); await page.locator('.overview').screenshot({path:path.join(root,'work/guide-status-overview.png')}); await page.locator('#shared-codex').screenshot({path:path.join(root,'work/guide-next-step.png')}); await page.locator('#collapse-all').click();
    assert.equal(await page.locator('.guide[open]').count(),0); assert.equal(await page.locator('.reference[open]').count(),0,'Collapse all closes reference sections');
    // Deep link into a diagram reveals its collapsed architecture parent.
    await page.evaluate(()=>{location.hash='seq-nanoleaf-command';}); await page.waitForFunction(()=>document.querySelector('#architecture').open); assert(await page.locator('#seq-nanoleaf-command').isVisible()); assert.equal(await page.locator('nav a[data-section="architecture"]').getAttribute('aria-current'),'location'); await page.waitForFunction(()=>Math.abs(document.querySelector('#seq-nanoleaf-command').getBoundingClientRect().top)<200,null,{timeout:5000});
    await page.locator('.diagram-index a[href="#arch-shared-system"]').click(); assert(await page.locator('#arch-shared-system').isVisible(),'Diagram index links reach figures');
    // Future scenarios sit in one marked, collapsed group; deep links and index links open it.
    const futureIds=receipts.diagrams.filter(d=>d.status==='future').map(d=>d.id); assert(futureIds.length>0);
    assert.deepEqual(await page.locator('.future-scenarios .diagram').evaluateAll(es=>es.map(e=>e.id)),futureIds,'Only future diagrams sit in the future group');
    assert(!(await page.locator(`#${futureIds[0]}`).isVisible()));
    for(const id of futureIds) assert.equal(await page.locator(`.diagram-index a[href="#${id}"] .index-future`).textContent(),'future','Index marks future diagrams');
    assert(/not implemented/i.test(await page.locator('.future-scenarios > summary').textContent()));
    await page.evaluate(id=>{location.hash=id;},futureIds[0]); await page.waitForFunction(()=>document.querySelector('.future-scenarios').open); assert(await page.locator(`#${futureIds[0]}`).isVisible(),'Deep link opens the future group');
    await page.evaluate(()=>{document.querySelector('.future-scenarios').open=false;}); await page.locator(`.diagram-index a[href="#${futureIds[1]}"]`).click(); assert(await page.locator(`#${futureIds[1]}`).isVisible(),'Index link opens the future group'); await page.evaluate(()=>{document.querySelector('.future-scenarios').open=false;history.replaceState(null,'',location.pathname);});
    // Every sequence has one walkthrough step per segment; alternatives are marked.
    for(const d of receipts.diagrams.filter(d=>d.type==='sequence')){const spec=JSON.parse(fs.readFileSync(path.join(root,'work/architecture/specs',`${d.id}.json`),'utf8')); const steps=page.locator(`#${d.id} .walk-step`); assert.equal(await steps.count(),spec.segments.length,`Walkthrough steps for ${d.id}`); assert.deepEqual(await steps.locator('h5').allTextContents(),spec.segments.map(s=>s.label)); assert.deepEqual(await steps.evaluateAll(es=>es.map(e=>e.classList.contains('walk-alt'))),spec.segments.map(s=>!/^\d/.test(s.label)),`Alternative lanes marked for ${d.id}`); assert(await page.locator(`#${d.id} .walk-sources a`).count()>=spec.segments.length);}
    await page.locator('#collapse-all').click(); await page.locator('nav a[data-section="timeline"]').click(); assert.equal(await page.locator('#timeline').getAttribute('open'),''); await page.locator('#collapse-all').click();
    for(const id of ['shared-codex','pc-lighting','desktop-controls']) {
      const hashChanged=page.evaluate(()=>new Promise(resolve=>window.addEventListener('hashchange',()=>resolve(),{once:true})));
      await page.locator(`nav a[href="#${id}"]`).click();
      await hashChanged;
      assert.equal(await page.locator(`#${id}`).getAttribute('open'),''); assert.equal(new URL(page.url()).hash,`#${id}`);
    }
    const expansion=()=>page.locator('.guide').evaluateAll(es=>es.map(e=>e.open));
    const evidenceExpansion=()=>page.locator('.delivery-evidence,.guide-evidence').evaluateAll(es=>es.map(e=>e.open));
    const beforeEvidence=await evidenceExpansion();
    const beforeSearch=await expansion();
    for(const [query,id] of [['Pixoo #37','shared-codex'],['Dominator Platinum','pc-lighting'],['N30','desktop-controls']]) {
      await page.locator('#search').fill(query); assert.equal(await page.locator('.guide:not([hidden])').count(),1);
      assert.equal(await page.locator('.guide:not([hidden])').getAttribute('id'),id);
      assert.equal(await page.locator('nav a[data-guide]:not([hidden])').count(),1); assert.equal(await page.locator('#timeline').isVisible(),false,'Timeline hides during search');
      const visibleDiagrams=await page.locator('.diagram:not([hidden])').count(); assert.equal(await page.locator('#architecture').isVisible(),visibleDiagrams>0);
      assert.equal(await page.locator('#result-count').textContent(),`1 guide · ${coverage[id].length} issues in these guides · ${visibleDiagrams} diagram${visibleDiagrams===1?'':'s'}`);
    }
    await page.locator('#search').press('Escape'); assert.deepEqual(await expansion(),beforeSearch); assert.deepEqual(await evidenceExpansion(),beforeEvidence,'Search restores nested evidence'); assert.equal(await page.locator('.diagram:not([hidden])').count(),diagramIds.length); assert(await page.locator('#timeline').isVisible());
    await page.locator('#search').fill('generation'); assert(await page.locator('.diagram:not([hidden])').count()>0); assert(await page.locator('#architecture').isVisible()); await page.locator('#search').press('Escape');
    await page.locator('#search').fill('request-conflict'); assert.equal(await page.locator('.future-scenarios').isVisible(),false,'Search hides a future group without matches'); await page.locator('#search').press('Escape');
    await page.locator('#search').fill('Super Buttons'); assert(await page.locator('.future-scenarios .diagram:not([hidden])').first().isVisible(),'Search opens the future group for a match'); await page.locator('#search').press('Escape');
    assert.equal(await page.locator('.future-scenarios').isVisible(),await page.locator('#architecture').evaluate(e=>e.open),'Clearing search restores the future group'); assert.equal(await page.locator('.future-scenarios').getAttribute('open'),null,'Clearing search restores its collapsed state');
    await page.locator('#search').fill('no-such-topic-987'); assert(await page.locator('#empty-state').isVisible());
    await page.locator('#clear-search').click(); assert.equal(await page.locator('.guide:not([hidden])').count(),count);
    assert.equal(await page.locator('#result-count').textContent(),summary);
    await page.locator('#search').fill('N30'); await page.evaluate(()=>{location.hash='pc-lighting';});
    await page.waitForFunction(()=>document.querySelector('#search').value==='');
    assert.equal(await page.locator('#pc-lighting').getAttribute('open'),'');
    await page.locator('#expand-all').click(); assert.equal(await page.locator('.guide[open]').count(),count); assert.equal(await page.locator('.reference[open]').count(),2);
    for(const id of ['pc-lighting','desktop-controls']) {await page.locator(`#${id} > summary`).scrollIntoViewIfNeeded();await screenshot(`${id}-desktop`);}
    await page.locator('#timeline').screenshot({path:path.join(root,'work/guide-timeline-desktop.png')});
    for(const id of ['arch-local-paths','arch-shared-system','arch-nanoleaf-linux','seq-nanoleaf-command']) await page.locator(`#${id}`).screenshot({path:path.join(root,`work/guide-${id}-desktop.png`)});
    // Zoom, fit and the inline viewer on one figure.
    {const fig=page.locator('#arch-local-paths'); const width=()=>fig.locator('.diagram-canvas > svg').evaluate(e=>e.getBoundingClientRect().width); const base=await width(); await fig.locator('.zoom-in').click(); await fig.locator('.zoom-in').click(); assert(await width()>base*1.4,'Zoom in widens the SVG'); assert.equal(await fig.locator('.zoom-level').textContent(),'150%'); assert.equal(await fig.locator('.diagram-stage').evaluate(e=>e.scrollWidth>e.clientWidth),true,'Zoomed diagram scrolls inside its stage'); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Zoom never overflows the page'); for(let i=0;i<3;i++) await fig.locator('.zoom-out').click(); assert.equal(await fig.locator('.zoom-level').textContent(),'75%'); await fig.locator('.zoom-fit').click(); assert.equal(Math.round(await width()),Math.round(base)); assert.equal(await fig.locator('.zoom-level').textContent(),'100%');
     await fig.locator('.viewer-toggle').click(); const frame=fig.locator('.viewer-frame iframe'); assert.equal(await frame.count(),1); assert.equal(await frame.getAttribute('src'),'architecture/arch-local-paths.html'); let viewerFrame=null; for(let i=0;i<200&&!viewerFrame;i++){viewerFrame=page.frames().find(f=>f.url().endsWith('/architecture/arch-local-paths.html'))||null; if(!viewerFrame) await page.waitForTimeout(100);} assert(viewerFrame,'Companion viewer frame loaded from the sibling folder'); await viewerFrame.waitForSelector('svg[role="img"]',{timeout:20000}); assert((await viewerFrame.title()).includes(JSON.parse(fs.readFileSync(path.join(root,'work/architecture/specs/arch-local-paths.json'),'utf8')).meta.title),'Companion viewer title'); await fig.locator('.viewer-toggle').click(); assert.equal(await fig.locator('.viewer-frame').isVisible(),false);}
    const widths=[1440,1000,900,768,390,320];
    for(const width of widths) {await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}px`);}
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await screenshot('mobile');
    for(const id of ['pc-lighting','desktop-controls']) {await page.locator(`#${id} > summary`).scrollIntoViewIfNeeded();await screenshot(`${id}-mobile`);}
    await page.locator('#timeline').screenshot({path:path.join(root,'work/guide-timeline-mobile.png')}); for(const id of ['arch-shared-system','arch-nanoleaf-linux','seq-nanoleaf-command']) await page.locator(`#${id}`).screenshot({path:path.join(root,`work/guide-${id}-mobile.png`)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow with the diagrams on mobile'); assert(await page.locator('#seq-owner-migration .diagram-canvas > svg').evaluate(e=>e.getBoundingClientRect().width>=740),'Narrow stages keep a readable diagram width'); assert(await page.locator('#seq-owner-migration .diagram-stage').evaluate(e=>e.scrollWidth>e.clientWidth),'Narrow stages scroll sideways');
    // Exercise a real PDF from filtered, mixed expansion state, plus repeated print events.
    await page.locator('#collapse-all').click();await page.locator('#local-acceptance > summary').click();await page.locator('#search').fill('N30');
    await page.locator('#architecture > summary').click(); assert.equal(await page.locator('#architecture').getAttribute('open'),null,'Architecture collapsed before the print test');
    const uiState=()=>page.evaluate(()=>({guides:[...document.querySelectorAll('.guide,.reference')].map(e=>({open:e.open,hidden:e.hidden})),figures:[...document.querySelectorAll('.diagram')].map(e=>e.hidden),evidence:[...document.querySelectorAll('.delivery-evidence,.guide-evidence')].map(e=>e.open),zoom:[...document.querySelectorAll('.diagram-canvas > svg')].map(e=>e.style.width),nav:[...document.querySelectorAll('nav a')].map(e=>e.hidden),search:document.querySelector('#search').value,result:document.querySelector('#result-count').textContent,empty:document.querySelector('#empty-state').hidden,clear:document.querySelector('#clear-search').hidden}));
    const beforePrint=await uiState();
    await page.evaluate(()=>{window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('beforeprint'));});
    assert(await page.locator('.delivery-evidence,.guide-evidence').evaluateAll(es=>es.every(e=>e.open)),'Print expands delivery evidence');
    assert.equal(await page.locator('.guide[open]:not([hidden])').count(),count); assert.equal(await page.locator('.reference[open]:not([hidden])').count(),2,'Print expands timeline and architecture'); assert.equal(await page.locator('.diagram:not([hidden])').count(),diagramIds.length);
    await page.emulateMedia({media:'print'});assert.equal(await page.locator('.sidebar').isVisible(),false);assert.equal(await page.locator('.toolbar').isVisible(),false);
    await page.locator('#timeline').screenshot({path:path.join(root,'work/guide-print-timeline.png')}); await page.locator('#arch-local-paths').screenshot({path:path.join(root,'work/guide-print-arch-local-paths.png')}); await page.locator('#arch-nanoleaf-linux').screenshot({path:path.join(root,'work/guide-print-arch-nanoleaf-linux.png')}); await page.locator('#seq-nanoleaf-command').screenshot({path:path.join(root,'work/guide-print-seq-nanoleaf-command.png')});
    assert.equal(await page.locator('.guide-body:visible').count(),count+2);
    assert.equal(await page.locator('.diagram-canvas > svg:visible').count(),diagramIds.length,'Every diagram renders in print'); assert.equal(await page.locator('.walk-step:visible').count(),await page.locator('.walk-step').count(),'Print shows every walkthrough step'); assert(await page.locator('.future-scenarios').evaluate(e=>e.open),'Print opens the future group'); assert.equal(await page.locator('.diagram-tools:visible').count(),0); assert(await page.locator('.diagram-canvas > svg').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.width<=e.closest('.diagram').getBoundingClientRect().width+1&&r.height<=700;})),'Diagrams fit the page width in print');
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});
    assert.deepEqual(await uiState(),beforePrint,'Repeated print events restore state');
    await page.pdf({path:path.join(root,'work/guide-print-check.pdf'),preferCSSPageSize:true,printBackground:true});
    assert.deepEqual(await uiState(),beforePrint,'Actual PDF restores prior document state');
    await page.locator('#clear-search').click();assert.equal(await page.locator('.guide[open]').count(),1);
    assert.equal(await page.locator('.guide[open]').getAttribute('id'),'local-acceptance');
    await page.evaluate(()=>{window.print=()=>{window.printButtonCalled=true;};});await page.locator('#print').click();assert(await page.evaluate(()=>window.printButtonCalled));
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'The guide makes no external requests');
    assert(companionRequests.every(u=>u.startsWith('https://fonts.googleapis.com/')),'Companion viewer requests are limited to its font stylesheet');
    const receipt={checkedAt:new Date().toISOString(),snapshot:snapshot.refreshedAt,architectureReviewedAt:sources.reviewedAt,historyFetchedAt:history.fetchedAt,htmlSha256:sha(file),htmlBytes:fs.statSync(file).size,guides:count,primaryOpenIssues:openKeys.length,linkedIssues:new Set(links.map(l=>l.key)).size,diagrams:diagramIds.length,companionViewers:receipts.diagrams.map(d=>({id:d.id,sha256:d.artifact.sha256,bytes:d.artifact.bytes})),roadmapNodes:meta.history.roadmapNodes,mergedPRs:prs,viewports:widths,issueStatusAndEvidence:'passed',parallelCandidates:'passed',coverage:'passed',linksAndAnchors:'passed',search:'passed',navigation:'passed',expandCollapse:'passed',architecture:'passed',diagramZoomFitAndInlineViewer:'passed',timelineTooltipsAndFilters:'passed',printExpansionAndRestoration:'passed',externalRequests:requests.length,companionViewerRequests:[...new Set(companionRequests)],companionViewerRenderedWithRequestsBlocked:true,errors,runtime:{node:process.version,playwright:playwrightPath,chromium:executablePath,browserVersion:browser.version()}};
    fs.writeFileSync(path.join(root,'work/guide-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
