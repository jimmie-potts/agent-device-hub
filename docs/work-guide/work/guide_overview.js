// Opening lists and topic-guide placement are rebuilt per successfully read
// repository. Other repositories retain their complete snapshot, including
// membership, counts and status. Topic outcome/next-step prose, history and
// the roadmap stay on the dated snapshot; only per-story placement, notes,
// workarounds, highlights and idea marks read live bodies.
(() => {
  const data = JSON.parse(document.querySelector('#overview-data').textContent);
  const repos = {H:['agent-device-hub','Hub'],N:['codex-nanoleaf','Nanoleaf'],P:['divoom-app-upgrade','Pixoo']};
  const rows = {...data.issues}, refreshed = new Set();
  const guideState = {}; // key -> {state:'assigned',topic,note,workaround,highlight,extends} | {state:'unassigned'|'invalid'}, live only
  const topicIds = new Set([...document.querySelectorAll('.guide[id]')].map(el => el.id));
  const labels = row => row.labels.map(label => typeof label === 'string' ? label : label.name);
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  // Recommendation labels stay on the snapshot; a live-only issue is not yet assessed.
  const recommendations = JSON.parse(document.querySelector('#issue-recommendations').textContent);
  const recommendation = key => { const rec = recommendations[key] || {state:'unassessed',label:'Not yet assessed'}; return `<p class="rec" data-key="${escape(key)}" data-rec="${escape(rec.state)}"><span class="rec-key">Start</span> ${escape(rec.label)}</p>`; };

  // --- Guide-section parsing: a small mirror of guide_section.py's grammar --
  function guideHeadings(lines) {
    const found = []; let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (fence) {
        const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
        continue;
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) { fence = opening[1]; continue; }
      const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/);
      if (heading) found.push({index:i, level:heading[1].length, text:heading[2].trim()});
    }
    return found;
  }
  function parseGuideSection(body) {
    const lines = String(body || '').split(/\r\n|\r|\n/);
    const headings = guideHeadings(lines);
    const ranges = [];
    headings.forEach((heading, position) => {
      if (heading.level === 2 && heading.text === 'Guide') {
        const next = headings.slice(position + 1).find(later => later.level <= 2);
        ranges.push([heading.index, next ? next.index : lines.length]);
      }
    });
    if (ranges.length === 0) return {state:'unassigned'};
    if (ranges.length > 1) return {state:'invalid'};
    const [start, end] = ranges[0];
    const values = {};
    let index = start + 1;
    while (index < end) {
      const line = lines[index].replace(/\r$/, '').replace(/\s+$/, '');
      if (!line) { index++; continue; }
      const match = line.match(/^\*\*([^*]+?):\*\*(?:[ \t]+(.*))?$/);
      if (!match) return {state:'invalid'};
      const key = match[1];
      if (!['Topic','Note','Workaround','Highlight','Extends'].includes(key) || key in values) return {state:'invalid'};
      let value = (match[2] || '').trim();
      index++;
      while (index < end) {
        const follow = lines[index].replace(/\r$/, '').replace(/\s+$/, '');
        if (!follow || /^\s*[|*]/.test(follow) || /^ {0,3}(`{3,}|~{3,})/.test(follow)) break;
        value += ' ' + follow.trim();
        index++;
      }
      if (!value) return {state:'invalid'};
      values[key] = value;
    }
    if (!('Topic' in values) || !topicIds.has(values.Topic)) return {state:'invalid'};
    let highlight = null;
    if ('Highlight' in values) {
      const match = values.Highlight.match(/^(next step|decision|later|idea)\s*,\s*(.+)$/i);
      if (!match) return {state:'invalid'};
      highlight = {kind:match[1].toLowerCase(), reason:match[2].trim()};
    }
    // Extends: guide keys beside an idea highlight only. The live read holds open stories alone,
    // so only the key form is checked here; the snapshot build also checks that each key exists.
    let extendsKeys = [];
    if ('Extends' in values) {
      if (highlight?.kind !== 'idea' || !/^[HNP][1-9]\d*(?:\s*,\s*[HNP][1-9]\d*)*$/.test(values.Extends)) return {state:'invalid'};
      extendsKeys = values.Extends.split(',').map(key => key.trim());
      if (new Set(extendsKeys).size !== extendsKeys.length) return {state:'invalid'};
    }
    return {state:'assigned', topic:values.Topic, note:values.Note || null, workaround:values.Workaround || null, highlight, extends:extendsKeys};
  }
  // Unifies the dated snapshot and a live-refreshed repository behind one shape.
  function guideOf(key) {
    if (refreshed.has(key[0])) return guideState[key] || {state:'unassigned'};
    const topic = data.owners[key];
    if (!topic) return {state:'unassigned'};
    const highlight = data.nextSteps[key] ? {kind:'next step', reason:data.nextSteps[key]}
                      : data.decisions[key] ? {kind:'decision', reason:data.decisions[key]}
                      : data.later[key] ? {kind:'later', reason:data.later[key]} : null;
    return {state:'assigned', topic, note:null, workaround:data.workarounds[key] || null, highlight};
  }
  const deferred = key => labels(rows[key]).includes('deferred') || guideOf(key).highlight?.kind === 'later';
  const active = key => labels(rows[key]).some(label => ['status:in-progress','status:review'].includes(label));
  const liveGate = key => {
    const guide = guideOf(key);
    // A "later" highlight's own reason is the gate text, ahead of blocked/deferred checks.
    if (guide.highlight?.kind === 'later') return guide.highlight.reason;
    const row = rows[key];
    return row.blocked ? 'Blocked in the current GitHub record. Read the issue for the prerequisite or decision.' : deferred(key) ? 'Deferred. Select and refine its scope before scheduling.' : active(key) ? 'Work is underway. Coordinate with the current owner.' : 'No recorded open prerequisite. Confirm the scope and owner before starting.';
  };
  const gateOf = key => refreshed.has(key[0]) ? liveGate(key) : rows[key].gate;

  function badge(key) {
    const row = rows[key], names = labels(row);
    const status = names.includes('status:review') ? 'review' : names.includes('status:in-progress') ? 'in-progress' : row.blocked ? 'blocked' : 'open';
    const [symbol,text] = {review:['◐','In review'],'in-progress':['◐','In progress'],blocked:['⊘','Blocked'],open:['○','Open']}[status];
    const state = text + (row.blocked && ['review','in-progress'].includes(status) ? ' · blocked' : '');
    const label = `${repos[key[0]][1]} #${row.number}`, title = `${label}: ${row.title} (${state}; opens a task brief)`;
    return `<a class="issue repo-${key[0]}" data-issue="${key}" data-state="OPEN" data-status="${status}" href="${escape(row.url)}" target="_blank" rel="noopener noreferrer" title="${escape(title)}" aria-label="${escape(title)}"><span class="status-symbol" aria-hidden="true">${symbol}</span><span class="issue-id">${label}</span><span class="issue-status">${state}</span></a>`;
  }
  function card(key, description) {
    const row = rows[key], guide = guideOf(key);
    const owner = guide.state === 'assigned' ? guide.topic : null;
    const priority = labels(row).filter(label => /^priority:|^p[0-4]$/i.test(label));
    const qualifiers = [...(deferred(key) ? [guide.highlight?.kind === 'later' ? 'Later by owner choice' : 'Deferred'] : []), ...priority];
    return `<article class="work-card" data-key="${key}"><h3>${escape(row.title)}</h3>${badge(key)}${recommendation(key)}<p class="work-meta">Created <time datetime="${escape(row.createdAt)}">${escape(row.createdAt.slice(0,10))}</time> UTC${qualifiers.length ? ' · '+escape(qualifiers.join(' · ')) : ''}</p>${description ? `<p>${escape(description)}</p>` : ''}<p class="work-gate">${escape(gateOf(key))}</p>${guide.workaround ? `<p>Workaround: ${escape(guide.workaround)}</p>` : ''}${owner ? `<a href="#${owner}">${escape(data.titles[owner])} →</a>` : `<p>Added since this guide snapshot; topic assignment pending.</p><a href="${escape(row.url)}" target="_blank" rel="noopener noreferrer">Read the issue →</a>`}</article>`;
  }
  const cards = (keys, descriptions={}) => keys.length ? `<div class="work-grid">${keys.map(key=>card(key,descriptions[key])).join('')}</div>` : '<p class="work-empty">None in this view.</p>';
  function render() {
    const keys = Object.keys(rows).sort((a,b)=>Date.parse(rows[b].createdAt)-Date.parse(rows[a].createdAt)||a.localeCompare(b));
    const priority = key => Math.min(5,...labels(rows[key]).map(label=>label.match(/^(?:priority:)?p([0-4])$/i)).filter(Boolean).map(match=>Number(match[1])));
    const defects = keys.filter(key=>labels(rows[key]).includes('bug')).sort((a,b)=>priority(a)-priority(b)||Date.parse(rows[b].createdAt)-Date.parse(rows[a].createdAt)||a.localeCompare(b));
    const now = Date.now();
    const week = keys.filter(key=>{const asOf=refreshed.has(key[0]) ? now : Date.parse(data.asOf); return Date.parse(rows[key].createdAt)>=asOf-7*86400000 && Date.parse(rows[key].createdAt)<=asOf;});
    const unassigned = keys.filter(key=>guideOf(key).state !== 'assigned');
    const next = keys.filter(key=>guideOf(key).highlight?.kind === 'next step' && !rows[key].blocked && !deferred(key) && !active(key));
    const nextDescriptions = Object.fromEntries(next.map(key=>[key, guideOf(key).highlight.reason]));
    const decisionKeys = keys.filter(key=>guideOf(key).highlight?.kind === 'decision');
    const decisionDescriptions = Object.fromEntries(decisionKeys.map(key=>[key, guideOf(key).highlight.reason]));
    const blockers = keys.filter(key=>!deferred(key)&&(rows[key].blocked||decisionKeys.includes(key)));
    const later = keys.filter(deferred);
    const laterOwned = later.filter(key=>guideOf(key).highlight?.kind === 'later');
    const laterDescriptions = Object.fromEntries(laterOwned.map(key=>[key, guideOf(key).highlight.reason]));
    const new_body = cards(keys.slice(0,8)) + '<details class="overview-more"><summary>Show all open issues created in the last seven days</summary>'+cards(week)+'</details>'+(unassigned.length ? '<details class="overview-more"><summary>Issues awaiting topic assignment</summary>'+cards(unassigned)+'</details>' : '');
    const later_body = cards(laterOwned,laterDescriptions)+'<details class="overview-more"><summary>Browse deferred work</summary>'+cards(later.filter(key=>!laterOwned.includes(key)))+'</details>';
    const contents = {
      'current-work': cards(keys.filter(active)),
      'newly-added': new_body,
      'open-defects': cards(defects),
      'next-steps': cards(next,nextDescriptions),
      'work-blockers': cards([...new Set([...blockers, ...decisionKeys.filter(key=>!deferred(key))])],decisionDescriptions),
      'later-work': later_body,
    };
    for (const [id,content] of Object.entries(contents)) {
      const container = document.querySelector(`#${id} [data-view-content]`);
      const opened = new Set([...container.querySelectorAll('details[open]')].map(detail=>detail.querySelector('summary').textContent));
      container.innerHTML = content;
      container.querySelectorAll('details').forEach(detail=>detail.open=opened.has(detail.querySelector('summary').textContent));
    }
  }

  // --- Topic-guide placement: existing rows patch in place; genuinely new or
  // moved-in rows land in a "Newly added since the snapshot" block, so a
  // tracked topic (Adding devices, Engineering maintenance) never needs a
  // live guess at which curated track a story belongs to. ---------------------
  function guideRow(key) {
    const row = rows[key], guide = guideOf(key);
    const note = guide.state === 'assigned' && guide.note ? escape(guide.note) : '';
    return `<tr><td data-label="Work">${escape(row.title)}</td><td data-label="Issue">${badge(key)}</td><td data-label="Next action or gate">${note}<p>${escape(gateOf(key))}</p>${recommendation(key)}</td></tr>`;
  }
  function renderGuides() {
    for (const topicId of topicIds) {
      const section = document.getElementById(topicId);
      if (!section) continue;
      const body = section.querySelector('.guide-body');
      // Scoped to the row's own Issue-column badge: a Note can embed [[H1]]-style cross-reference
      // badges via render() (build_guide.py), which must never count as that row's own membership.
      const ownBadge = tr => tr.querySelector('td[data-label="Issue"] a.issue[data-issue]');
      const handled = new Set();
      for (const tr of body.querySelectorAll('tbody tr')) {
        if (tr.closest('.delivery-evidence') || tr.closest('.newly-added-since-snapshot')) continue;
        const link = ownBadge(tr);
        const key = link?.dataset.issue;
        if (!key || !refreshed.has(key[0])) continue; // unrefreshed prefixes keep their snapshot row untouched
        const guide = guideOf(key);
        if (!rows[key] || guide.state !== 'assigned' || guide.topic !== topicId) { tr.remove(); continue; }
        handled.add(key);
        tr.querySelector('td:last-child').innerHTML = `${guide.note ? escape(guide.note) : ''}<p>${escape(gateOf(key))}</p>${recommendation(key)}`;
      }
      // "Known" means "already a regular row the patch loop above owns" — the same scope that
      // loop skips (.delivery-evidence, .newly-added-since-snapshot). A row already placed in the
      // "Newly added" bucket is reconciled below by its own present/added diff, not here: counting
      // it as "known" here would exclude it from `added` on the next repository's refresh pass and
      // have the present/added diff remove it, so a live-placed story could flicker out again.
      const known = new Set([...body.querySelectorAll('tbody tr')]
        .filter(tr => !tr.closest('.delivery-evidence') && !tr.closest('.newly-added-since-snapshot'))
        .map(ownBadge).filter(Boolean).map(link => link.dataset.issue));
      const added = Object.keys(rows).filter(key => refreshed.has(key[0]) && !handled.has(key) && !known.has(key) && guideOf(key).state === 'assigned' && guideOf(key).topic === topicId);
      added.sort();
      let newSection = body.querySelector('.newly-added-since-snapshot');
      if (added.length && !newSection) {
        newSection = document.createElement('div');
        newSection.className = 'newly-added-since-snapshot';
        newSection.innerHTML = '<h3 class="work-heading">Newly added since the snapshot</h3><table><caption class="sr-only">Newly added since the snapshot</caption><thead><tr><th scope="col">Work</th><th scope="col">Issue</th><th scope="col">Next action or gate</th></tr></thead><tbody></tbody></table>';
        const evidence = body.querySelector('.delivery-evidence');
        if (evidence) evidence.before(newSection); else body.querySelector('.back-top').before(newSection);
      }
      if (newSection) {
        const tbody = newSection.querySelector('tbody');
        const present = new Set([...tbody.querySelectorAll('tr')].map(ownBadge).filter(Boolean).map(link => link.dataset.issue));
        for (const key of [...present].filter(key => !added.includes(key))) tbody.querySelector(`td[data-label="Issue"] a[data-issue="${key}"]`).closest('tr').remove();
        for (const key of added.filter(key => !present.has(key))) tbody.insertAdjacentHTML('beforeend', guideRow(key));
        if (!tbody.children.length) newSection.remove();
      }
      const openKeys = [...body.querySelectorAll('tbody tr')]
        .filter(tr => !tr.closest('.delivery-evidence')).map(ownBadge).filter(Boolean).map(link => link.dataset.issue);
      const count = openKeys.length;
      section.dataset.count = String(count);
      section.dataset.primary = openKeys.slice().sort().join(' ');
      const countBadge = section.querySelector('summary .guide-count');
      if (countBadge) countBadge.textContent = `${count} open`;
      const navCount = document.querySelector(`nav a[data-guide="${topicId}"] .nav-count`);
      if (navCount) navCount.textContent = String(count).padStart(2,'0');
    }
  }

  // --- Ideas section: snapshot rows patch their reason, Extends and state in place; a story
  // newly marked, or moved to another topic, since the snapshot lands in a "Newly added since the
  // snapshot" block inside its topic group; a story that closes or loses its mark is removed.
  // Repositories whose read failed keep their snapshot rows. Direction's Later ideas follows. ------
  const sortKey = (a, b) => a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1));
  const schedulingLabels = {candidate:'Candidate', active:'Active', blocked:'Blocked', deferred:'Deferred'};
  const liveScheduling = key => rows[key].blocked ? 'blocked' : labels(rows[key]).includes('deferred') ? 'deferred' : active(key) ? 'active' : 'candidate';
  // An Extends key keeps an existing page badge (with its live relabel); an open live story gets a
  // live badge; anything else links to GitHub without a status claim.
  function extendsLink(key) {
    const existing = document.querySelector(`a.issue[data-issue="${key}"]`);
    if (existing) return existing.outerHTML;
    if (rows[key]) return badge(key);
    const [repo, name] = repos[key[0]], label = `${name} #${key.slice(1)}`;
    return `<a class="issue repo-${key[0]}" data-issue="${key}" data-status="unknown" href="https://github.com/jimmie-potts/${repo}/issues/${key.slice(1)}" target="_blank" rel="noopener noreferrer" title="${escape(label)} (status not in this read)" aria-label="${escape(label)} (status not in this read)"><span class="status-symbol" aria-hidden="true">·</span><span class="issue-id">${label}</span><span class="issue-status">See GitHub</span></a>`;
  }
  function ideaMeta(key, guide) {
    const status = liveScheduling(key), extendsHtml = guide.extends.map(extendsLink).join('');
    return `<span class="idea-state" data-state="${status}">${schedulingLabels[status]}</span><span class="idea-extends"${extendsHtml ? '' : ' hidden'}><span class="idea-label">Extends</span>${extendsHtml}</span>`;
  }
  const ideaRow = (key, guide) => `<li class="idea" data-key="${key}" data-topic="${escape(guide.topic)}"><p class="idea-head">${badge(key)}<span class="idea-title">${escape(rows[key].title)}</span></p><p class="idea-reason">${escape(guide.highlight.reason)}</p><p class="idea-meta">${ideaMeta(key, guide)}</p></li>`;
  const liveIdea = key => { const guide = guideOf(key); return rows[key] && guide.state === 'assigned' && guide.highlight?.kind === 'idea' ? guide : null; };
  function renderIdeas() {
    const section = document.getElementById('ideas');
    if (!section) return;
    const groups = section.querySelector('.ideas-groups');
    const topicOrder = [...topicIds];
    const group = topicId => {
      let element = groups.querySelector(`.ideas-topic[data-topic="${topicId}"]`);
      if (element) return element;
      element = document.createElement('section');
      element.className = 'ideas-topic'; element.dataset.topic = topicId; element.setAttribute('aria-labelledby', `ideas-${topicId}`);
      element.innerHTML = `<h3 id="ideas-${escape(topicId)}"><a href="#${escape(topicId)}">${escape(data.titles[topicId])}</a></h3><ul class="ideas-list"></ul>`;
      const later = [...groups.querySelectorAll('.ideas-topic')].find(other => topicOrder.indexOf(other.dataset.topic) > topicOrder.indexOf(topicId));
      groups.insertBefore(element, later || null);
      return element;
    };
    const regular = new Set();
    for (const li of [...groups.querySelectorAll('li.idea')]) {
      const key = li.dataset.key;
      if (!refreshed.has(key[0])) continue; // a failed read keeps the snapshot row untouched
      const guide = liveIdea(key);
      if (li.closest('.newly-added-since-snapshot') || !guide || guide.topic !== li.dataset.topic) { li.remove(); continue; }
      regular.add(key);
      li.querySelector('.idea-reason').textContent = guide.highlight.reason;
      li.querySelector('.idea-meta').innerHTML = ideaMeta(key, guide);
    }
    const added = Object.keys(rows).filter(key => refreshed.has(key[0]) && !regular.has(key) && liveIdea(key)).sort(sortKey);
    for (const key of added) {
      const guide = liveIdea(key), topic = group(guide.topic);
      let block = topic.querySelector('.newly-added-since-snapshot');
      if (!block) {
        block = document.createElement('div');
        block.className = 'newly-added-since-snapshot';
        block.innerHTML = '<h4 class="work-heading">Newly added since the snapshot</h4><ul class="ideas-list"></ul>';
        topic.append(block);
      }
      block.querySelector('ul').insertAdjacentHTML('beforeend', ideaRow(key, guide));
    }
    groups.querySelectorAll('.newly-added-since-snapshot').forEach(block => { if (!block.querySelector('li')) block.remove(); });
    groups.querySelectorAll('.ideas-topic').forEach(topic => { if (!topic.querySelector('li')) topic.remove(); });
    const ideas = [...groups.querySelectorAll('li.idea')];
    section.querySelector('.ideas-empty').hidden = ideas.length > 0;
    section.querySelector('summary [data-ideas-count]').textContent = `${ideas.length} marked`;
    const navCount = document.querySelector('nav a[data-section="ideas"] [data-ideas-count]');
    if (navCount) { navCount.textContent = String(ideas.length).padStart(2, '0'); navCount.setAttribute('aria-label', `${ideas.length} marked ideas`); }
    // Direction's Later ideas: the same stories, compact, in the same order.
    const later = document.querySelector('#direction .direction-ideas');
    if (later) {
      later.innerHTML = ideas.map(li => `<li data-key="${escape(li.dataset.key)}">${li.querySelector('.idea-head a.issue').outerHTML}<span class="direction-idea-title">${escape(li.querySelector('.idea-title').textContent)}</span></li>`).join('');
      document.querySelector('#direction .direction-ideas-empty').hidden = ideas.length > 0;
    }
  }

  window.updateWorkOverview = (prefix, open) => {
    const normalized = {};
    Object.keys(guideState).filter(key=>key.startsWith(prefix)).forEach(key=>delete guideState[key]);
    for (const issue of open) {
      if (issue.state !== 'open' || !Number.isInteger(issue.number) || typeof issue.title !== 'string' || !Number.isFinite(Date.parse(issue.created_at)) || !Array.isArray(issue.labels)) throw new Error('Invalid overview issue');
      const key = prefix + issue.number;
      normalized[key] = {number:issue.number,title:issue.title,createdAt:issue.created_at,state:'OPEN',labels:issue.labels,
        url:`https://github.com/jimmie-potts/${repos[prefix][0]}/issues/${issue.number}`,
        blocked:issue.labels.some(label=>(typeof label==='string'?label:label.name)==='blocked')||Number(issue.issue_dependencies_summary?.blocked_by||0)>0};
      guideState[key] = parseGuideSection(typeof issue.body === 'string' ? issue.body : '');
    }
    Object.keys(rows).filter(key=>key.startsWith(prefix)).forEach(key=>delete rows[key]);
    Object.assign(rows,normalized); refreshed.add(prefix);
    const briefsElement = document.querySelector('#issue-briefs'), briefs = JSON.parse(briefsElement.textContent);
    Object.entries(normalized).forEach(([key,row])=>briefs[key]=[row.url,row.title]);
    briefsElement.textContent = JSON.stringify(briefs);
    render();
    renderGuides();
    renderIdeas();
  };
  window.finishWorkOverview = () => {
    const current = [...refreshed].map(prefix=>repos[prefix][1]);
    const fallback = Object.keys(repos).filter(prefix=>!refreshed.has(prefix)).map(prefix=>repos[prefix][1]);
    document.querySelector('#overview-freshness').textContent = `${current.length ? `Opening lists, topic placement, ideas and counts read from GitHub at ${new Date().toLocaleTimeString()} for ${current.join(', ')}. ` : ''}${fallback.length ? `GitHub unavailable for ${fallback.join(', ')}; those lists, topic counts and ideas retain the ${data.asOf} snapshot. ` : ''}Topic outcomes, next-step boxes, history and the roadmap remain on the dated snapshot. Newly discovered issues link directly to GitHub until assigned a topic.`;
  };
})();
