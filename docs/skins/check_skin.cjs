// Browser checks for the skin contract shared by the work guide and the BUNNY atlas:
// theme and motion controls, decoration that never gets in the way, and both themes
// at phone and desktop widths. Called by each page's own browser check.
const assert = require('assert/strict');
const SKIN = 'neon-geometry-wars', THEME_KEY = 'bunny-design-theme', MOTION_KEY = 'bunny-design-motion';
const OPENING = ['ngw-draw', 'ngw-bracket', 'ngw-fade', 'ngw-trace'], STREAK = 'ngw-streak';

// url: file URL of the page. decorated: hosts of decorative ::before/::after. controls: selectors
// that decoration must never cover. allowRequest: approved remote reads. shot(page, name): saves a screenshot.
async function check(browser, {url, decorated, controls, allowRequest = () => false, shot}) {
  const contexts = [];
  const open = async options => {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, colorScheme: 'dark', ...options});
    contexts.push(context);
    const page = await context.newPage(), requests = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(url);
    return {page, requests, errors};
  };
  const state = page => page.evaluate(([themeKey, motionKey]) => ({
    skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme ?? null, motion: document.documentElement.dataset.motion ?? null,
    storedTheme: localStorage.getItem(themeKey), storedMotion: localStorage.getItem(motionKey),
    themePressed: document.querySelector('#theme-toggle').getAttribute('aria-pressed'), motionPressed: document.querySelector('#motion-toggle').getAttribute('aria-pressed'),
    background: getComputedStyle(document.body).backgroundColor}), [THEME_KEY, MOTION_KEY]);
  const running = page => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName).sort());
  // Chromium commits localStorage to its storage service asynchronously, so a reload right after a toggle can read the
  // previous value on a busy runner. Reload until a fresh document reads the write and applied it (at most 20 tries,
  // 100 ms apart); the assertions after each call still check the full state.
  const reloadUntilStored = async (page, key, attribute, value) => {
    for (let attempt = 1; ; attempt++) {
      await page.reload();
      const settled = await page.evaluate(([key, attribute, value]) => localStorage.getItem(key) === value && (document.documentElement.dataset[attribute] ?? null) === value, [key, attribute, value]);
      if (settled) return;
      // Diagnostics for a hosted runner: what the fresh document actually sees on each retry.
      console.log(JSON.stringify({retry: attempt, key, value, url: page.url(), storage: await page.evaluate(() => Object.entries(localStorage)), attribute: await page.evaluate(a => document.documentElement.dataset[a] ?? null, attribute)}));
      if (attempt >= 20) return;
      await page.waitForTimeout(100);
    }
  };
  try {
    // Motion: the opening and streak run by default, Pause stops every decorative animation and
    // persists, Resume restarts only the streak, and a fresh load replays the opening.
    const {page, requests, errors} = await open({reducedMotion: 'no-preference'});
    let now = await state(page);
    assert.equal(now.skin, SKIN, 'The page names its skin');
    assert.equal(now.motion, null); assert.equal(now.motionPressed, 'false');
    let names = await running(page);
    assert(names.includes(STREAK) && OPENING.some(name => names.includes(name)), `Opening and streak run on a fresh load: ${names}`);
    const targets = await page.evaluate(() => document.getAnimations().map(a => ({pseudo: a.effect.pseudoElement || '', artwork: Boolean(a.effect.target.closest('.hero-art')), rule: a.effect.target.matches('.sidebar-rule')})));
    assert(targets.every(t => t.pseudo || t.artwork || t.rule), 'Animations run only on decorative pseudo-elements, rules and artwork, never on text, badges or edges');
    await page.locator('#motion-toggle').click();
    now = await state(page);
    assert.deepEqual([now.motion, now.motionPressed, now.storedMotion], ['paused', 'true', 'paused'], 'Pause sets and stores the paused state');
    assert.deepEqual(await running(page), [], 'Pause stops every decorative animation');
    await reloadUntilStored(page, MOTION_KEY, 'motion', 'paused');
    now = await state(page);
    assert.deepEqual([now.motion, now.motionPressed], ['paused', 'true'], 'A stored pause applies before first paint');
    assert.deepEqual(await running(page), [], 'A paused page starts without motion');
    await page.locator('#motion-toggle').click();
    now = await state(page);
    assert.deepEqual([now.motion, now.motionPressed, now.storedMotion], ['running', 'false', null], 'Resume clears the stored pause');
    assert.deepEqual(await running(page), [STREAK], 'Resume restarts the streak without replaying the opening');
    await reloadUntilStored(page, MOTION_KEY, 'motion', null);
    now = await state(page);
    assert.equal(now.motion, null, 'Only the paused state is stored');
    assert((await running(page)).some(name => OPENING.includes(name)), 'A fresh load replays the opening');
    // Theme: the toggle switches and persists; without a stored or scripted choice, CSS follows the system.
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme], ['dark', 'false', null], 'A dark system preference starts dark');
    const dark = now.background;
    await page.locator('#theme-toggle').click();
    now = await state(page);
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme], ['light', 'true', 'light'], 'The theme toggle switches to light and stores it');
    const light = now.background;
    assert.notEqual(light, dark, 'Light mode changes the surface');
    await reloadUntilStored(page, THEME_KEY, 'theme', 'light');
    now = await state(page);
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme], ['light', 'true', 'light'], 'The theme persists across reload');
    await page.locator('#theme-toggle').click();
    await reloadUntilStored(page, THEME_KEY, 'theme', 'dark');
    now = await state(page);
    assert.deepEqual([now.theme, now.storedTheme, now.background], ['dark', 'dark', dark], 'Dark mode persists across reload');
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await page.emulateMedia({colorScheme: 'light'});
    assert.equal((await state(page)).background, light, 'Without a theme attribute, CSS follows a light system preference');
    await page.emulateMedia({colorScheme: 'dark'});
    assert.equal((await state(page)).background, dark, 'Without a theme attribute, CSS follows a dark system preference');
    // Print shows no decoration, grid or glow.
    await page.emulateMedia({media: 'print'});
    const printed = await page.evaluate(hosts => ({grid: getComputedStyle(document.body).backgroundImage,
      shown: hosts.flatMap(selector => [...document.querySelectorAll(selector)].slice(0, 3)).flatMap(e => ['::before', '::after'].map(p => getComputedStyle(e, p)))
        .filter(s => s.content !== 'none' && s.display !== 'none').length}), decorated);
    assert.deepEqual(printed, {grid: 'none', shown: 0}, 'Print hides decoration and the grid');
    await page.emulateMedia({media: 'screen'});
    assert.deepEqual(errors, []);
    assert(requests.every(allowRequest), `Only approved requests leave the page: ${requests.filter(r => !allowRequest(r))}`);
    // Reduced motion: no decorative animation in either theme; decoration never covers controls,
    // stays out of the tab order and ignores the pointer; no page overflow; screenshots.
    const reduced = await open({reducedMotion: 'reduce'});
    const layouts = [];
    for (const theme of ['dark', 'light']) {
      if ((await state(reduced.page)).theme !== theme) await reduced.page.locator('#theme-toggle').click();
      assert.deepEqual(await running(reduced.page), [], `Reduced motion runs no decorative animation (${theme})`);
      for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']]) {
        await reduced.page.setViewportSize({width, height});
        assert(await reduced.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px (${theme})`);
        const decoration = await reduced.page.evaluate(hosts => {
          const pseudo = hosts.flatMap(selector => [...document.querySelectorAll(selector)]).flatMap(e => ['::before', '::after'].map(p => getComputedStyle(e, p)))
            .filter(s => s.content !== 'none' && s.display !== 'none');
          const artwork = [...document.querySelectorAll('.hero-art')], rules = [...document.querySelectorAll('.sidebar-rule')];
          return {pseudo: pseudo.length, interactive: pseudo.filter(s => s.pointerEvents !== 'none').length,
            artwork: artwork.filter(e => e.getAttribute('aria-hidden') !== 'true' || getComputedStyle(e).pointerEvents !== 'none').length,
            focusable: [...artwork, ...rules].filter(e => e.hasAttribute('tabindex') || e.querySelector('[tabindex],a,button,input')).length};
        }, decorated);
        assert(decoration.pseudo > 0, 'Decoration is present');
        assert.deepEqual([decoration.interactive, decoration.artwork, decoration.focusable], [0, 0, 0], `Decoration ignores the pointer and stays out of the tab order at ${width}px (${theme})`);
        for (const forced of [false, true]) {
          // Forcing pointer events onto every pseudo-element and the artwork shows whether any of it stacks above a control.
          const probe = forced ? await reduced.page.addStyleTag({content: '*::before,*::after,.hero-art{pointer-events:auto!important}'}) : null;
          for (const selector of controls) {
            const control = reduced.page.locator(selector);
            if (!await control.isVisible()) continue;
            await control.scrollIntoViewIfNeeded();
            const hit = await control.evaluate(e => { const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(top) && (top === e || e.contains(top)); });
            assert(hit, `${selector} is not covered at ${width}px (${theme}${forced ? ', decoration hit-testable' : ''})`);
          }
          if (probe) await probe.evaluate(e => e.remove());
        }
        await reduced.page.evaluate(() => scrollTo(0, 0));
        if (shot) await shot(reduced.page, `${label}-${theme}`);
        layouts.push(`${width}-${theme}`);
      }
      await reduced.page.setViewportSize({width: 1440, height: 1000});
    }
    assert.deepEqual(reduced.errors, []);
    return {skin: SKIN, themeToggleAndPersistence: 'passed', systemPreferenceFallback: 'passed', pauseAndResume: 'passed',
            reducedMotion: 'passed', decorationOutOfTheWay: 'passed', printWithoutDecoration: 'passed', layouts};
  } finally {
    // The contexts stay open until the caller closes the browser. Chromium keeps file:// storage in
    // one shared area, and closing a context can purge it while a later context on the same browser
    // is still writing, which lost a stored theme on a hosted runner.
    void contexts;
  }
}

module.exports = {check, SKIN, THEME_KEY, MOTION_KEY};
