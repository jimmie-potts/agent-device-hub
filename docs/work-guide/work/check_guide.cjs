const fs = require('fs'), os = require('os'), path = require('path');
const {pathToFileURL} = require('url');
const assert = require('assert/strict');
const crypto = require('crypto');
// Resolve installed packages and browsers. These checks never install software.
let playwrightPath;
for (const candidate of [process.env.GUIDE_PLAYWRIGHT_MODULE,'playwright'].filter(Boolean)) {
  try {playwrightPath=require.resolve(candidate); break;} catch {}
}
assert(playwrightPath,'Set GUIDE_PLAYWRIGHT_MODULE to an installed Playwright module');
const {chromium}=require(playwrightPath);
const cache=process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(),'.cache/ms-playwright');
const installed=fs.existsSync(cache)?fs.readdirSync(cache).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})):[];
// Prefer full Chromium builds, which CI launches; chrome-headless-shell differs (for example in clipboard permission).
const executablePath=[process.env.GUIDE_CHROMIUM_PATH,chromium.executablePath(),
  ...installed.filter(n=>n.startsWith('chromium-')).map(n=>path.join(cache,n,'chrome-linux64/chrome')),
  ...installed.filter(n=>n.startsWith('chromium_headless_shell-')).map(n=>path.join(cache,n,'chrome-headless-shell-linux64/chrome-headless-shell'))].find(p=>p&&fs.existsSync(p));
assert(executablePath,'Set GUIDE_CHROMIUM_PATH to an installed Chromium executable');
(async()=>{
  const root=path.resolve(__dirname,'..'), file=path.join(root,'outputs/agent-device-work-guides.html');
  const read=name=>JSON.parse(fs.readFileSync(path.join(root,'work/backlogs',name),'utf8'));
  const coverage=read('guide-coverage.json'), snapshot=read('snapshot.json');
  const sourceHtml=fs.readFileSync(file,'utf8'), pixooSnapshotStatuses=Object.fromEntries([...sourceHtml.matchAll(/<a class="issue repo-P" data-issue="(P\d+)"[^>]*data-status="([^"]+)"/g)].map(match=>[match[1],match[2]]));
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
  assert.equal(count,11); assert(ids.includes('bunny-controls')&&ids.includes('work-guide'));
  const snapshotDate=JSON.parse(sourceHtml.match(/<script id="snapshot-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).snapshotDate;
  const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[],consoleErrors=[],requests=[],apiRequests=[];
    // External requests are attributed per frame: the guide may read GitHub issue status; the companion Archify viewer
    // (loaded on demand in an iframe) may reference its template's Google Fonts stylesheet, which is blocked here.
    const companionRequests=[];
    await page.addInitScript(now=>{Date.now=()=>now;},Date.parse(snapshot.refreshedAt)+8*86400000);
    page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());}); page.on('request',r=>{if(!/^https?:/.test(r.url()))return; if(r.frame()===page.mainFrame())requests.push(r.url()); else companionRequests.push(r.url());});
    const apiIssue=(key,overrides={})=>{const source=issueMap[key];return {number:source.number,state:source.state.toLowerCase(),state_reason:source.stateReason,title:source.title,html_url:source.url,created_at:source.createdAt,labels:source.labels,...overrides};};
    const hubBlocked=apiIssue('H11',{labels:issueMap.H11.labels.filter(l=>l.name!=='blocked'),issue_dependencies_summary:{blocked_by:1,total_blocked_by:2}});
    const hubClosed=apiIssue('H21',{state:'closed',state_reason:'completed'});
    const hubClosedOther=apiIssue('H17',{state:'closed',state_reason:'not_planned'});
    const nanoleafReview=apiIssue('N10',{labels:[...issueMap.N10.labels.filter(l=>!l.name.startsWith('status:')),{name:'status:review'}],issue_dependencies_summary:{blocked_by:0,total_blocked_by:0}});
    const nanoleafProgress=apiIssue('N15',{labels:[...issueMap.N15.labels.filter(l=>!l.name.startsWith('status:')),{name:'status:in-progress'}],issue_dependencies_summary:{blocked_by:1,total_blocked_by:2}});
    const pixooProgress=apiIssue('P11',{labels:[...issueMap.P11.labels.filter(l=>!l.name.startsWith('status:')),{name:'status:in-progress'}],issue_dependencies_summary:{blocked_by:0,total_blocked_by:0}});
    const apiOrigin='https://api.github.com', issueRoute=(repo,state,pageNumber=1)=>`${apiOrigin}/repos/jimmie-potts/${repo}/issues?state=${state}&per_page=100${state==='closed'?`&since=${encodeURIComponent(snapshot.refreshedAt)}`:''}${pageNumber>1?`&page=${pageNumber}`:''}`;
    await page.route(/^https?:/,route=>route.abort());
    await page.route(/^https:\/\/api\.github\.com\//,async route=>{
      const url=new URL(route.request().url()),repo=url.pathname.split('/')[3],state=url.searchParams.get('state'),pageNumber=Number(url.searchParams.get('page')||1);
      apiRequests.push({url:url.href,method:route.request().method()});
      if(repo==='divoom-app-upgrade'&&state==='open')return route.fulfill({status:429,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Link','Content-Type':'application/json'},body:JSON.stringify({message:'rate limited'})});
      let rows=[];
      if(repo==='agent-device-hub'&&state==='open')rows=pageNumber===1?[hubBlocked]:pageNumber===2?[{number:999,state:'open',title:'New <issue> absent from this guide',created_at:snapshot.refreshedAt,labels:[{name:'bug'},{name:'blocked'},{name:'deferred'},{name:'priority:p1'}]},{number:997,state:'open',title:'Older unassigned issue',created_at:'2000-01-01T00:00:00Z',labels:[]}]:[];
      else if(repo==='agent-device-hub'&&state==='closed')rows=[hubClosed,hubClosedOther];
      else if(repo==='codex-nanoleaf'&&state==='open')rows=[nanoleafReview,nanoleafProgress];
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Link','Content-Type':'application/json'};
      if(repo==='agent-device-hub'&&state==='open'&&pageNumber===1)headers.Link=`<${issueRoute(repo,state,2)}>; rel="next"`;
      return route.fulfill({status:200,headers,body:JSON.stringify(rows)});
    });
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>document.querySelector('#github-status')?.textContent.startsWith('GitHub unavailable for Pixoo;'));
    assert(apiRequests.some(r=>r.url===issueRoute('agent-device-hub','open',2)),'Follows the GitHub Link pagination header');
    assert(apiRequests.every(r=>r.method==='GET'&&new URL(r.url).origin===apiOrigin),'Uses only anonymous GitHub API GET requests');
    const liveStatus=key=>page.locator(`a[data-issue="${key}"]`);
    assert(await liveStatus('H21').evaluateAll(es=>es.every(e=>e.dataset.status==='completed'&&e.dataset.state==='CLOSED'&&e.title.includes('Completed')&&e.getAttribute('aria-label').includes('Completed')&&e.querySelector('.issue-status').textContent==='Completed'&&e.querySelector('.status-symbol').textContent==='✓')),'Every badge updates its state, symbol, text and accessible labels');
    assert(await liveStatus('H17').evaluateAll(es=>es.every(e=>e.dataset.status==='closed'&&e.querySelector('.issue-status').textContent==='Closed'&&e.querySelector('.status-symbol').textContent==='−')),'Other closures remain Closed');
    assert(await liveStatus('H11').evaluateAll(es=>es.every(e=>e.dataset.status==='blocked')),'Open dependency summary marks an issue blocked');
    assert(await liveStatus('N10').evaluateAll(es=>es.every(e=>e.dataset.status==='review')),'Review label updates the live status');
    assert(await liveStatus('N15').evaluateAll(es=>es.every(e=>e.dataset.status==='in-progress'&&e.querySelector('.issue-status').textContent==='In progress · blocked'&&e.getAttribute('aria-label').includes('In progress · blocked'))),'In-progress issues keep the blocked qualifier');
    assert(await liveStatus('H25').evaluateAll(es=>es.every(e=>e.dataset.status==='open')),'Issues absent from both reads keep their snapshot status');
    const pixooAfterFailure=await page.locator('a.issue.repo-P[data-issue]').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.dataset.issue,e.dataset.status])));
    assert.deepEqual(pixooAfterFailure,pixooSnapshotStatuses,'A failed repository keeps every badge at its snapshot status');
    assert((await page.locator('#github-status').textContent()).includes(`${snapshotDate} snapshot`));
    assert.equal(await page.locator('#newly-added [data-view-content] > .work-grid > .work-card').first().getAttribute('data-key'),'H999','New issue appears by creation date');
    assert.equal(await page.locator('#open-defects .work-card').first().getAttribute('data-key'),'H999','Explicit priority sorts before an unranked bug');
    assert.equal(await page.locator('#open-defects .work-card[data-key="N81"]').count(),0,'Successful complete repository refresh removes absent open bugs');
    assert.equal(await page.locator('#open-defects .work-card[data-key="P52"]').count(),1,'Failed Pixoo read retains its open defect');
    assert((await page.locator('#open-defects .work-card[data-key="H999"]').textContent()).includes('Deferred'),'Deferred defects stay visible');
    assert((await page.locator('#open-defects .work-card[data-key="H999"]').textContent()).includes('topic assignment pending'),'New issues stay reachable before the next guide revision');
    const weekly=page.locator('#newly-added details').filter({has:page.locator('summary', {hasText:'Show all open issues created in the last seven days'})});
    const cutoff=Date.parse(snapshot.refreshedAt)-7*86400000;
    const expectedFallbackWeek=openKeys.filter(k=>k.startsWith('P')&&Date.parse(issueMap[k].createdAt)>=cutoff&&Date.parse(issueMap[k].createdAt)<=Date.parse(snapshot.refreshedAt)).sort();
    assert.deepEqual((await weekly.locator('.work-card').evaluateAll(es=>es.map(e=>e.dataset.key))).sort(),expectedFallbackWeek,'Delayed partial refresh retains the failed repository weekly snapshot');
    const unassigned=page.locator('#newly-added details').filter({has:page.locator('summary', {hasText:'Issues awaiting topic assignment'})});
    assert.equal(await unassigned.locator('.work-card[data-key="H997"]').count(),1,'Unassigned issues remain reachable even outside newest eight and seven days');
    assert.equal(await page.locator('#next-steps .work-card[data-key="P61"]').count(),0);
    assert.equal(await page.locator('#later-work .work-card[data-key="P61"]').count(),1);
    assert((await page.locator('#overview-freshness').textContent()).includes('GitHub unavailable for Pixoo'));
    for(const id of oldIds.concat('pc-lighting','desktop-controls')) assert.equal(await page.locator(`[id="${id}"]`).count(),1,'Old deep link retained');
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
    for(const [key,status,label] of [['P34','completed','Completed'],['N46','blocked','Blocked'],['H50','completed','Completed']]) {
      const refs=page.locator(`a[data-issue="${key}"]`);
      assert(await refs.evaluateAll((es,status)=>es.every(e=>e.dataset.status===status),status));
      assert(await refs.evaluateAll((es,label)=>es.every(e=>e.querySelector('.issue-status').textContent.includes(label)),label));
      assert(await refs.evaluateAll(es=>es.every(e=>e.getAttribute('aria-label').includes(e.querySelector('.issue-status').textContent))),'Accessible status matches visible text');
    }
    await page.locator('#local-acceptance > summary').click(); await page.locator('#local-acceptance .delivery-evidence').first().evaluate(e=>e.open=true);
    const completedLink=page.locator('#local-acceptance a[data-issue="P26"]').first();
    await completedLink.focus(); assert(await completedLink.evaluate(e=>e===document.activeElement),'Status links stay keyboard reachable');
    await page.locator('#local-acceptance').evaluate(e=>{e.open=false;e.querySelectorAll('details').forEach(d=>d.open=false);});
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
    await page.locator('.roadmap .node[data-node="n-codex"] rect').hover(); assert((await page.locator('#timeline-tip').textContent()).includes('B.U.N.N.Y. UI foundation')); assert(await page.locator('.roadmap .edge.lit').count()>0,'Prerequisite edges highlight');
    await page.locator('#timeline .repo-chip[data-repo="P"]').click(); assert(await page.locator('.history a.pr.dim').count()>0); assert.equal(await page.locator('.history a.pr[data-repo="P"].dim').count(),0); await page.locator('#timeline .repo-chip[data-repo="all"]').click(); assert.equal(await page.locator('#timeline .dim').count(),0);
    assert.deepEqual(await page.locator('.stats strong').allTextContents(),[String(openKeys.length),String(count),String(Object.keys(repos).length).padStart(2,'0')]);
    for(const [key,repo] of Object.entries(repos)) {
      const total=openKeys.filter(k=>k.startsWith(key)).length;
      assert.equal(meta.repositoryCounts[key],total); assert.equal(snapshot.repositories[repo].openIssues,total);
      assert.equal(snapshot.repositories[repo].paginationComplete,true);
      assert.equal(await page.locator(`.repo-legend .repo-${key} b`).textContent(),String(total));
    }
    const links=await page.locator('[data-issue]').evaluateAll(es=>es.map(e=>({key:e.dataset.issue,url:e.href,state:e.dataset.state})));
    for(const l of links) {if(['H999','H997'].includes(l.key)){assert.equal(l.url,`https://github.com/jimmie-potts/agent-device-hub/issues/${l.key.slice(1)}`);continue;} assert.equal(l.url,issueMap[l.key].url);assert.equal(l.state,l.key==='H21'?'CLOSED':issueMap[l.key].state);}
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
    assert((await page.locator('p.document-note:not(#github-status)').textContent()).includes('Static snapshot refreshed'));
    assert((await page.locator('meta[name="description"]').getAttribute('content')).includes(`${openKeys.length} open issues`));
    const summary=`${count} guides · ${openKeys.length} issues in these guides · ${diagramIds.length} diagrams`;
    assert.equal(await page.locator('#result-count').textContent(),summary);
    assert.equal(await page.locator('.future-scenarios').getAttribute('open'),null,'Future scenarios start collapsed on load');
    const screenshot=name=>page.screenshot({path:path.join(root,`work/guide-${name}.png`)});
    await page.evaluate(()=>window.scrollTo(0,0)); await screenshot('desktop'); await page.locator('#newly-added').screenshot({path:path.join(root,'work/guide-status-overview.png')}); await page.locator('#shared-codex').screenshot({path:path.join(root,'work/guide-next-step.png')}); await page.locator('#collapse-all').click();
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
    for(const id of ['shared-codex','nanoleaf-devices','desktop-controls']) {
      const hashChanged=page.evaluate(()=>new Promise(resolve=>window.addEventListener('hashchange',()=>resolve(),{once:true})));
      await page.locator(`nav a[href="#${id}"]`).click();
      await hashChanged;
      assert.equal(await page.locator(`#${id}`).getAttribute('open'),''); assert.equal(new URL(page.url()).hash,`#${id}`);
    }
    const expansion=()=>page.locator('.guide').evaluateAll(es=>es.map(e=>e.open));
    const evidenceExpansion=()=>page.locator('.delivery-evidence,.guide-evidence').evaluateAll(es=>es.map(e=>e.open));
    const beforeEvidence=await evidenceExpansion();
    const beforeSearch=await expansion();
    for(const [query,id] of [['Expire monitoring sessions after 24 hours','shared-codex'],['Corsair','nanoleaf-devices'],['N30','desktop-controls']]) {
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
    assert.equal(await page.locator('#nanoleaf-devices').getAttribute('open'),'');
    await page.locator('#expand-all').click(); assert.equal(await page.locator('.guide[open]').count(),count); assert.equal(await page.locator('.reference[open]').count(),2);
    for(const id of ['nanoleaf-devices','desktop-controls']) {await page.locator(`#${id} > summary`).scrollIntoViewIfNeeded();await screenshot(`${id}-desktop`);}
    await page.locator('#timeline').screenshot({path:path.join(root,'work/guide-timeline-desktop.png')});
    for(const id of ['arch-local-paths','arch-shared-system','arch-nanoleaf-linux','seq-nanoleaf-command']) await page.locator(`#${id}`).screenshot({path:path.join(root,`work/guide-${id}-desktop.png`)});
    // Zoom, fit and the inline viewer on one figure.
    {const fig=page.locator('#arch-local-paths'); const width=()=>fig.locator('.diagram-canvas > svg').evaluate(e=>e.getBoundingClientRect().width); const base=await width(); await fig.locator('.zoom-in').click(); await fig.locator('.zoom-in').click(); assert(await width()>base*1.4,'Zoom in widens the SVG'); assert.equal(await fig.locator('.zoom-level').textContent(),'150%'); assert.equal(await fig.locator('.diagram-stage').evaluate(e=>e.scrollWidth>e.clientWidth),true,'Zoomed diagram scrolls inside its stage'); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Zoom never overflows the page'); for(let i=0;i<3;i++) await fig.locator('.zoom-out').click(); assert.equal(await fig.locator('.zoom-level').textContent(),'75%'); await fig.locator('.zoom-fit').click(); assert.equal(Math.round(await width()),Math.round(base)); assert.equal(await fig.locator('.zoom-level').textContent(),'100%');
     await fig.locator('.viewer-toggle').click(); const frame=fig.locator('.viewer-frame iframe'); assert.equal(await frame.count(),1); assert.equal(await frame.getAttribute('src'),'architecture/arch-local-paths.html'); let viewerFrame=null; for(let i=0;i<200&&!viewerFrame;i++){viewerFrame=page.frames().find(f=>f.url().endsWith('/architecture/arch-local-paths.html'))||null; if(!viewerFrame) await page.waitForTimeout(100);} assert(viewerFrame,'Companion viewer frame loaded from the sibling folder'); await viewerFrame.waitForSelector('svg[role="img"]',{timeout:20000}); assert((await viewerFrame.title()).includes(JSON.parse(fs.readFileSync(path.join(root,'work/architecture/specs/arch-local-paths.json'),'utf8')).meta.title),'Companion viewer title'); await fig.locator('.viewer-toggle').click(); assert.equal(await fig.locator('.viewer-frame').isVisible(),false);}
    const widths=[1440,1000,900,768,390,320];
    for(const width of widths) {await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}px`);}
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await screenshot('mobile');
    for(const id of ['nanoleaf-devices','desktop-controls']) {await page.locator(`#${id} > summary`).scrollIntoViewIfNeeded();await screenshot(`${id}-mobile`);}
    await page.locator('#timeline').screenshot({path:path.join(root,'work/guide-timeline-mobile.png')}); for(const id of ['arch-shared-system','arch-nanoleaf-linux','seq-nanoleaf-command']) await page.locator(`#${id}`).screenshot({path:path.join(root,`work/guide-${id}-mobile.png`)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow with the diagrams on mobile'); assert(await page.locator('#seq-owner-migration .diagram-canvas > svg').evaluate(e=>e.getBoundingClientRect().width>=740),'Narrow stages keep a readable diagram width'); assert(await page.locator('#seq-owner-migration .diagram-stage').evaluate(e=>e.scrollWidth>e.clientWidth),'Narrow stages scroll sideways');
    // Task briefs at phone width: a badge from each repository opens one dialog with copyable agent prompts.
    {const dialog=page.locator('#brief'), prompt=dialog.locator('#brief-prompt'), status=dialog.locator('.brief-status');
     const isOpen=()=>dialog.evaluate(d=>d.open&&d.matches(':modal')), focusedOn=badge=>badge.evaluate(e=>e===document.activeElement);
     const actions=async()=>{const out={}; for(const name of ['explain','plan','implement','review']){await dialog.locator(`[data-action="${name}"]`).click(); assert.equal(await dialog.locator(`[data-action="${name}"]`).getAttribute('aria-pressed'),'true'); assert.equal(await dialog.locator('[data-action][aria-pressed="true"]').count(),1); out[name]=await prompt.inputValue();} return out;};
     assert.equal(await isOpen(),false,'The brief starts closed');
     for(const [repoKey,dismiss] of [['H','Escape'],['N','Close'],['P','backdrop']]) {
       const badge=page.locator(`.guide a.issue.repo-${repoKey}[data-issue]`).first(), key=await badge.getAttribute('data-issue'), issue=issueMap[key];
       await badge.scrollIntoViewIfNeeded(); await badge.click();
       assert(await isOpen(),`${key} badge opens the brief`); assert.equal(await page.locator('dialog[open]').count(),1,'One brief dialog');
       assert.equal(await dialog.locator('.brief-repo').textContent(),new URL(issue.url).pathname.split('/').slice(1,3).join('/'));
       assert.equal(await dialog.locator('.brief-number').textContent(),`#${issue.number}`); assert.equal(await dialog.locator('#brief-title').textContent(),issue.title);
       const link=dialog.locator('.brief-link'); assert.equal(await link.getAttribute('href'),issue.url); assert.equal(await link.getAttribute('target'),'_blank'); assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
       assert.equal(await badge.getAttribute('href'),issue.url,'The badge keeps its GitHub link'); assert(await dialog.locator('[data-action][aria-pressed="true"]').evaluate(b=>b===document.activeElement),'Focus moves to the selected action');
       const p=await actions();
       for(const text of Object.values(p)) assert(text.includes(issue.url),'Every prompt names the full issue URL');
       assert(p.explain.includes(`"${issue.title}"`)&&/Read-only: don't change files, branches or GitHub\./.test(p.explain),'Explain is read-only');
       assert(p.plan.startsWith('Use the plan-work skill for ')&&p.plan.includes('Planning only')&&p.plan.includes("don't change the tracker"),'Plan names plan-work and planning-only scope');
       assert(p.implement.startsWith('Use the deliver-work skill to deliver '),'Implement names deliver-work');
       assert(p.review.startsWith('Review the open pull request for ')&&p.review.includes('Read-only: report findings without changing files or GitHub.'),'Review is read-only');
       assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow with the brief open');
       assert(await dialog.evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth;}),'The brief fits the phone viewport');
       if(repoKey==='H') await dialog.screenshot({path:path.join(root,'work/guide-brief-mobile.png')});
       if(dismiss==='Escape') await page.keyboard.press('Escape'); else if(dismiss==='Close') await dialog.locator('.brief-close').click(); else await page.mouse.click(4,4);
       assert.equal(await isOpen(),false,`${dismiss} closes the brief`); assert(await focusedOn(badge),`${dismiss} returns focus to the badge`);
     }
     // Titles are text: a markup title from the data renders literally in the heading and prompt.
     const key=await page.locator('.guide a.issue.repo-H[data-issue]').first().getAttribute('data-issue'), hostile='<img src=x onerror="window.briefInjected=1">A & "B"';
     await page.evaluate(([key,title])=>{const data=document.querySelector('#issue-briefs'), briefs=JSON.parse(data.textContent); window.savedBriefs=data.textContent; briefs[key][1]=title; data.textContent=JSON.stringify(briefs);},[key,hostile]);
     assert.equal(await page.evaluate(key=>window.openBrief(key),key),true,'openBrief opens a known issue');
     assert.equal(await dialog.locator('#brief-title').textContent(),hostile); assert.equal(await dialog.locator('img').count(),0); await dialog.locator('[data-action="explain"]').click(); assert((await prompt.inputValue()).includes(`("${hostile}")`));
     await page.waitForTimeout(50); assert.equal(await page.evaluate(()=>window.briefInjected),undefined,'Title markup never executes');
     await page.evaluate(()=>{document.querySelector('#issue-briefs').textContent=window.savedBriefs;}); await page.keyboard.press('Escape');
     // An explicit opener from another view gets focus back, not the element focused before the call.
     const other=page.locator('.guide a.issue.repo-N[data-issue]').first(); await page.locator('#search').focus();
     assert.equal(await page.evaluate(([key,from])=>window.openBrief(key,from),[await other.getAttribute('data-issue'),await other.elementHandle()]),true);
     await page.keyboard.press('Escape'); assert(await focusedOn(other),'Closing returns focus to the explicit opener');
     assert.equal(await page.evaluate(()=>window.openBrief('H999999')),false,'Unknown keys do not open a brief'); assert.equal(await isOpen(),false);
     // Copy writes to the clipboard; a denied or missing Clipboard API selects the prompt for manual copying.
     const badge=page.locator('.guide a.issue.repo-H[data-issue]').first(); await badge.click(); await dialog.locator('[data-action="implement"]').click(); const expected=await prompt.inputValue();
     // The real file:// clipboard copies when permission is granted. Default clipboard permission depends on the browser
     // build (full Chromium grants writes; chrome-headless-shell rejects them), so denied and missing are simulated here.
     await page.context().grantPermissions(['clipboard-read','clipboard-write']);
     await dialog.locator('.brief-copy').click(); await page.waitForFunction(()=>document.querySelector('.brief-status').textContent!=='');
     assert.equal(await status.textContent(),'Copied.'); assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected,'Copy writes the prompt to the clipboard');
     await page.context().clearPermissions();
     const selectedAll=()=>prompt.evaluate(t=>document.activeElement===t&&t.selectionStart===0&&t.selectionEnd===t.value.length&&t.value.length>0);
     for(const clipboard of ['denied','missing']) {
       await dialog.locator('[data-action="review"]').click(); assert.equal(await status.textContent(),'','Changing the action clears the copy status');
       if(clipboard==='denied') await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new DOMException('Write permission denied.','NotAllowedError'))});});
       if(clipboard==='missing') await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});});
       await dialog.locator('.brief-copy').click(); await page.waitForFunction(()=>document.querySelector('.brief-status').textContent!=='');
       assert(await selectedAll(),`A ${clipboard} clipboard selects the prompt`); assert(/copy it manually/.test(await status.textContent()));
     }
     await page.screenshot({path:path.join(root,'work/guide-brief-fallback-mobile.png')});
     await dialog.locator('.brief-close').click(); assert(await focusedOn(badge)); await page.evaluate(()=>{delete navigator.clipboard; delete navigator.clipboard.writeText;});
     assert.equal(await page.locator('#search').evaluate(e=>e.placeholder.length>0),true); assert(/task brief/i.test(await page.locator('.search-meta').textContent()),'Search hint explains that issue links open a brief');}
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
    await page.locator('#clear-search').click();assert.equal(await page.locator('.guide[open]').count(),0);
    assert.equal(await page.locator('#local-acceptance').getAttribute('open'),'');
    await page.evaluate(()=>{window.print=()=>{window.printButtonCalled=true;};});await page.locator('#print').click();assert(await page.evaluate(()=>window.printButtonCalled));
    assert.deepEqual(errors,[]);
    assert(requests.every(u=>u.startsWith(`${apiOrigin}/repos/jimmie-potts/`)),'The guide makes only its approved GitHub API requests');
    assert(companionRequests.every(u=>u.startsWith('https://fonts.googleapis.com/')),'Companion viewer requests are limited to its font stylesheet');
    const success=await browser.newPage(); await success.route(/^https:\/\/api\.github\.com\//,route=>{const url=new URL(route.request().url()),rows=url.pathname.endsWith('/divoom-app-upgrade/issues')&&url.searchParams.get('state')==='open'?[pixooProgress]:[];return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},body:JSON.stringify(rows)});});
    await success.goto(pathToFileURL(file).href); await success.waitForFunction(()=>document.querySelector('#github-status')?.textContent.startsWith('Status from GitHub at '));
    assert.match(await success.locator('#github-status').textContent(),new RegExp(`^Status from GitHub at \\d{2}:\\d{2}\\. Guide text and counts from the ${snapshotDate} snapshot\\.$`),'All-success freshness line names the read time and dated snapshot');
    assert(await success.locator('a.issue.repo-P[data-issue="P11"]').evaluateAll(es=>es.every(e=>e.dataset.status==='in-progress')),'A successful repository read updates its badges'); await success.close();
    const offline=await browser.newPage(); const offlineErrors=[]; offline.on('pageerror',e=>offlineErrors.push(e.message)); offline.on('console',m=>{if(m.type()==='error')offlineErrors.push(m.text());}); await offline.context().setOffline(true);
    await offline.context().addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
    await offline.goto(pathToFileURL(file).href);
    await offline.waitForFunction(()=>document.querySelector('#github-status')?.textContent.includes('GitHub unavailable for Hub, Nanoleaf and Pixoo;'));
    assert(await offline.locator('a[data-issue="H21"]').evaluateAll(es=>es.every(e=>e.dataset.status==='in-progress')),'Unavailable reads keep snapshot badges');
    assert.deepEqual((await offline.locator('#open-defects .work-card').evaluateAll(es=>es.map(e=>e.dataset.key))).sort(),openKeys.filter(k=>issueMap[k].labels.some(l=>l.name==='bug')).sort(),'Offline view includes every open bug');
    assert((await offline.locator('#overview-freshness').textContent()).includes('snapshot'));
    assert.deepEqual(offlineErrors,[],'Failed or offline reads do not produce console or page errors'); await offline.close();
    const receipt={checkedAt:new Date().toISOString(),snapshot:snapshot.refreshedAt,architectureReviewedAt:sources.reviewedAt,historyFetchedAt:history.fetchedAt,htmlSha256:sha(file),htmlBytes:fs.statSync(file).size,guides:count,primaryOpenIssues:openKeys.length,linkedIssues:new Set(links.map(l=>l.key)).size,diagrams:diagramIds.length,companionViewers:receipts.diagrams.map(d=>({id:d.id,sha256:d.artifact.sha256,bytes:d.artifact.bytes})),roadmapNodes:meta.history.roadmapNodes,mergedPRs:prs,viewports:widths,issueStatusAndEvidence:'passed',liveGitHubStatus:'passed',allSuccessFreshness:'passed',repositoryFallback:'passed',offlineFallback:'passed',pagination:'passed',overviewLists:'passed',coverage:'passed',linksAndAnchors:'passed',search:'passed',navigation:'passed',expandCollapse:'passed',architecture:'passed',diagramZoomFitAndInlineViewer:'passed',timelineTooltipsAndFilters:'passed',taskBriefs:'passed',printExpansionAndRestoration:'passed',externalRequests:requests.length,approvedGitHubRequests:apiRequests.length,companionViewerRequests:[...new Set(companionRequests)],companionViewerRenderedWithRequestsBlocked:true,errors,consoleErrors,runtime:{node:process.version,playwright:playwrightPath,chromium:executablePath,browserVersion:browser.version()}};
    fs.writeFileSync(path.join(root,'work/guide-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
