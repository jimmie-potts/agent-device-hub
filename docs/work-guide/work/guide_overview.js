// Opening lists are rebuilt per successfully read repository. Other repositories
// retain their complete snapshot, including membership and status.
(() => {
  const data = JSON.parse(document.querySelector('#overview-data').textContent);
  const repos = {H:['agent-device-hub','Hub'],N:['codex-nanoleaf','Nanoleaf'],P:['divoom-app-upgrade','Pixoo']};
  const rows = {...data.issues}, refreshed = new Set();
  const labels = row => row.labels.map(label => typeof label === 'string' ? label : label.name);
  const deferred = key => labels(rows[key]).includes('deferred') || key in data.later;
  const active = key => labels(rows[key]).some(label => ['status:in-progress','status:review'].includes(label));
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function badge(key) {
    const row = rows[key], names = labels(row);
    const status = names.includes('status:review') ? 'review' : names.includes('status:in-progress') ? 'in-progress' : row.blocked ? 'blocked' : 'open';
    const [symbol,text] = {review:['◐','In review'],'in-progress':['◐','In progress'],blocked:['⊘','Blocked'],open:['○','Open']}[status];
    const state = text + (row.blocked && ['review','in-progress'].includes(status) ? ' · blocked' : '');
    const label = `${repos[key[0]][1]} #${row.number}`, title = `${label}: ${row.title} (${state}; opens a task brief)`;
    return `<a class="issue repo-${key[0]}" data-issue="${key}" data-state="OPEN" data-status="${status}" href="${escape(row.url)}" target="_blank" rel="noopener noreferrer" title="${escape(title)}" aria-label="${escape(title)}"><span class="status-symbol" aria-hidden="true">${symbol}</span><span class="issue-id">${label}</span><span class="issue-status">${state}</span></a>`;
  }
  function card(key, description) {
    const row = rows[key], owner = data.owners[key];
    const priority = labels(row).filter(label => /^priority:|^p[0-4]$/i.test(label));
    const qualifiers = [...(deferred(key) ? [key in data.later ? 'Later by owner choice' : 'Deferred'] : []), ...priority];
    const gate = data.later[key] || (refreshed.has(key[0]) ? row.blocked ? 'Blocked in the current GitHub record. Read the issue for the prerequisite or decision.' : deferred(key) ? 'Deferred. Select and refine its scope before scheduling.' : active(key) ? 'Work is underway. Coordinate with the current owner.' : 'No recorded open prerequisite. Confirm the scope and owner before starting.' : row.gate);
    return `<article class="work-card" data-key="${key}"><h3>${escape(row.title)}</h3>${badge(key)}<p class="work-meta">Created <time datetime="${escape(row.createdAt)}">${escape(row.createdAt.slice(0,10))}</time> UTC${qualifiers.length ? ' · '+escape(qualifiers.join(' · ')) : ''}</p>${description ? `<p>${escape(description)}</p>` : ''}<p class="work-gate">${escape(gate)}</p>${data.workarounds[key] ? `<p>Workaround: ${escape(data.workarounds[key])}</p>` : ''}${owner ? `<a href="#${owner}">${escape(data.titles[owner])} →</a>` : `<p>Added since this guide snapshot; topic assignment pending.</p><a href="${escape(row.url)}" target="_blank" rel="noopener noreferrer">Read the issue →</a>`}</article>`;
  }
  const cards = (keys, descriptions={}) => keys.length ? `<div class="work-grid">${keys.map(key=>card(key,descriptions[key])).join('')}</div>` : '<p class="work-empty">None in this view.</p>';
  function render() {
    const keys = Object.keys(rows).sort((a,b)=>Date.parse(rows[b].createdAt)-Date.parse(rows[a].createdAt)||a.localeCompare(b));
    const priority = key => Math.min(5,...labels(rows[key]).map(label=>label.match(/^(?:priority:)?p([0-4])$/i)).filter(Boolean).map(match=>Number(match[1])));
    const defects = keys.filter(key=>labels(rows[key]).includes('bug')).sort((a,b)=>priority(a)-priority(b)||Date.parse(rows[b].createdAt)-Date.parse(rows[a].createdAt)||a.localeCompare(b));
    const now = Date.now();
    const week = keys.filter(key=>Date.parse(rows[key].createdAt)>=now-7*86400000 && Date.parse(rows[key].createdAt)<=now);
    const next = Object.keys(data.nextSteps).filter(key=>rows[key]&&!rows[key].blocked&&!deferred(key)&&!active(key));
    const blockers = keys.filter(key=>!deferred(key)&&(rows[key].blocked||key in data.decisions));
    const later = keys.filter(deferred);
    const contents = {
      'current-work': cards(keys.filter(active)),
      'newly-added': cards(keys.slice(0,8)) + '<details class="overview-more"><summary>Show all open issues created in the last seven days</summary>'+cards(week)+'</details>',
      'open-defects': cards(defects),
      'next-steps': cards(next,data.nextSteps),
      'work-blockers': cards(blockers,data.decisions),
      'later-work': cards(later.filter(key=>key in data.later),data.later)+'<details class="overview-more"><summary>Browse deferred work</summary>'+cards(later.filter(key=>!(key in data.later)))+'</details>',
    };
    for (const [id,content] of Object.entries(contents)) {
      const container = document.querySelector(`#${id} [data-view-content]`);
      const opened = container.querySelector('details')?.open;
      container.innerHTML = content;
      if (opened && container.querySelector('details')) container.querySelector('details').open = true;
    }
  }
  window.updateWorkOverview = (prefix, open) => {
    const normalized = {};
    for (const issue of open) {
      if (issue.state !== 'open' || !Number.isInteger(issue.number) || typeof issue.title !== 'string' || !Number.isFinite(Date.parse(issue.created_at)) || !Array.isArray(issue.labels)) throw new Error('Invalid overview issue');
      const key = prefix + issue.number;
      normalized[key] = {number:issue.number,title:issue.title,createdAt:issue.created_at,state:'OPEN',labels:issue.labels,
        url:`https://github.com/jimmie-potts/${repos[prefix][0]}/issues/${issue.number}`,
        blocked:issue.labels.some(label=>(typeof label==='string'?label:label.name)==='blocked')||Number(issue.issue_dependencies_summary?.blocked_by||0)>0};
    }
    Object.keys(rows).filter(key=>key.startsWith(prefix)).forEach(key=>delete rows[key]);
    Object.assign(rows,normalized); refreshed.add(prefix);
    const briefsElement = document.querySelector('#issue-briefs'), briefs = JSON.parse(briefsElement.textContent);
    Object.entries(normalized).forEach(([key,row])=>briefs[key]=[row.url,row.title]);
    briefsElement.textContent = JSON.stringify(briefs);
    render();
  };
  window.finishWorkOverview = () => {
    const current = [...refreshed].map(prefix=>repos[prefix][1]);
    const fallback = Object.keys(repos).filter(prefix=>!refreshed.has(prefix)).map(prefix=>repos[prefix][1]);
    document.querySelector('#overview-freshness').textContent = `${current.length ? `Opening lists read from GitHub at ${new Date().toLocaleTimeString()} for ${current.join(', ')}. ` : ''}${fallback.length ? `GitHub unavailable for ${fallback.join(', ')}; those lists retain the ${data.asOf} snapshot. ` : ''}Topic assignments, guide text and totals remain on the dated snapshot. Newly discovered issues link directly to GitHub until assigned.`;
  };
})();
