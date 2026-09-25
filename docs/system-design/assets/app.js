(() => {
  // The theme toggle comes from docs/skins/skin.py, inlined ahead of this file.
  document.querySelector('#print').addEventListener('click', () => window.print());
  const menu = document.querySelector('#menu-toggle');
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    document.querySelector('#sidebar').classList.toggle('open', open);
  });
  const search = document.querySelector('#search');
  search.addEventListener('input', () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    document.querySelectorAll('[data-search]').forEach(node => {
      node.hidden = !words.every(word => node.dataset.search.toLowerCase().includes(word));
    });
    document.querySelectorAll('.nav-group').forEach(group => {
      group.hidden = !group.querySelector('.nav-item:not([hidden])');
    });
    const count = document.querySelectorAll('.nav-item:not([hidden])').length;
    document.querySelector('#search-count').textContent = `${count} component document${count === 1 ? '' : 's'}`;
    const empty = document.querySelector('#empty');
    if (empty) empty.hidden = count !== 0;
  });
})();
(() => {
  // Deep links into collapsed sections and the map's hidden detail blocks.
  function reveal() {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target) return;
    for (let details = target.closest('details'); details; details = details.parentElement && details.parentElement.closest('details')) details.open = true;
  }
  window.addEventListener('hashchange', reveal);
  reveal();

  // Zoom: the stage scrolls; Fit returns the diagram to the stage width.
  document.querySelectorAll('.atlas-map, .atlas-walk').forEach(wrap => {
    const svg = wrap.querySelector('.atlas-canvas > svg'), level = wrap.querySelector('.zoom-level');
    if (!svg || !level) return;
    let zoom = 1;
    const apply = () => { svg.style.width = zoom === 1 ? '' : `${Math.round(zoom * 100)}%`; level.textContent = `${Math.round(zoom * 100)}%`; };
    wrap.querySelector('.zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom + 0.25); apply(); });
    wrap.querySelector('.zoom-out').addEventListener('click', () => { zoom = Math.max(0.5, zoom - 0.25); apply(); });
    wrap.querySelector('.zoom-fit').addEventListener('click', () => { zoom = 1; apply(); });
  });

  // System map: selecting a box or its list entry shows the responsibility and links.
  const panel = document.querySelector('#map-detail');
  const mapCanvas = document.querySelector('.atlas-canvas[data-diagram^="arch-"]');
  if (panel && mapCanvas) {
    const prefix = mapCanvas.dataset.diagram + '-';
    const nodes = [...mapCanvas.querySelectorAll('[data-node-id]')];
    const buttons = [...document.querySelectorAll('.node-button')];
    const idle = panel.innerHTML;
    const idOf = node => node.dataset.nodeId.slice(prefix.length);
    function select(id, focusPanel) {
      const detail = id && document.getElementById('detail-' + id);
      if (id && !detail) return;
      nodes.forEach(node => { const on = idOf(node) === id; node.setAttribute('aria-pressed', String(on)); node.classList.toggle('is-selected', on); node.classList.toggle('is-dimmed', Boolean(id) && !on); });
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.node === id)));
      mapCanvas.classList.toggle('has-selection', Boolean(id));
      panel.innerHTML = detail ? detail.innerHTML + '<p class="detail-actions"><button type="button" class="detail-clear">Clear selection</button></p>' : idle;
      panel.dataset.node = id || '';
      if (id) panel.scrollIntoView({block: 'nearest'});
      if (focusPanel) panel.focus({preventScroll: true});
    }
    nodes.forEach(node => {
      node.addEventListener('click', () => select(idOf(node), false));
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(idOf(node), true); } });
    });
    buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.node, true)));
    panel.addEventListener('click', event => { if (event.target.closest('.detail-clear')) select(null, false); });
    document.querySelector('#map').addEventListener('keydown', event => { if (event.key === 'Escape') select(null, false); });
    const deepLink = () => { const deep = /^#detail-([A-Za-z0-9_-]+)$/.exec(location.hash); if (deep) { select(deep[1], false); document.querySelector('#map').scrollIntoView(); } };
    window.addEventListener('hashchange', deepLink);
    deepLink();
  }

  // Walkthrough: one open phase at a time; its arrows stay highlighted on the diagram.
  const steps = document.querySelector('#walk-steps');
  const walkCanvas = document.querySelector('.atlas-canvas[data-diagram^="seq-"]');
  if (steps && walkCanvas) {
    const phases = [...steps.querySelectorAll('.walk-phase')];
    const edges = [...walkCanvas.querySelectorAll('[data-edge-key]')];
    // Participants carry no atlas action; keep them out of the tab order.
    walkCanvas.querySelectorAll('[data-node-id]').forEach(node => { node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-pressed'); });
    function open(index) {
      const keys = index === null ? null : new Set(phases[index].dataset.steps.split(',').map(Number));
      phases.forEach((phase, i) => { const on = i === index; phase.classList.toggle('is-open', on); phase.querySelector('.phase-button').setAttribute('aria-expanded', String(on)); phase.querySelector('.phase-body').hidden = !on; });
      edges.forEach(edge => { const on = Boolean(keys) && keys.has(Number(edge.dataset.edgeKey)); edge.classList.toggle('is-active', on); edge.classList.toggle('is-dimmed', Boolean(keys) && !on); });
      walkCanvas.classList.toggle('has-selection', keys !== null);
    }
    phases.forEach((phase, i) => phase.querySelector('.phase-button').addEventListener('click', () => open(phase.classList.contains('is-open') ? null : i)));
    walkCanvas.querySelectorAll('[data-segment-id]').forEach(label => {
      const index = Number(label.dataset.segmentId.split('-').pop());
      if (!phases[index]) return;
      label.setAttribute('tabindex', '0'); label.setAttribute('role', 'button'); label.setAttribute('aria-label', 'Open phase: ' + label.textContent.trim());
      label.addEventListener('click', () => { open(index); phases[index].querySelector('.phase-button').focus(); });
      label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(index); phases[index].querySelector('.phase-button').focus(); } });
    });
    steps.addEventListener('keydown', event => { if (event.key === 'Escape') open(null); });
  }
})();
