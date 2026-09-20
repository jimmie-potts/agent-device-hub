(() => {
  const root = document.documentElement;
  const theme = document.querySelector('#theme-toggle');
  function setTheme(value) {
    root.dataset.theme = value === 'light' ? 'light' : 'dark';
    theme.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode';
    try { localStorage.setItem('bunny-design-theme', root.dataset.theme); } catch {}
  }
  try { setTheme(localStorage.getItem('bunny-design-theme') || 'dark'); } catch { setTheme('dark'); }
  theme.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
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
