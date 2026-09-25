// Browser checks for the skin contract shared by the work guide and the B.U.N.N.Y. atlas:
// the theme control, one-shot motion, decoration that never gets in the way, and both themes
// at phone and desktop widths. Called by each page's own browser check.
const assert = require('assert/strict');
const SKIN = 'neon-geometry-wars', THEME_KEY = 'bunny-design-theme', RETIRED_MOTION_KEY = 'bunny-design-motion';
const OPENING = ['ngw-draw', 'ngw-bracket', 'ngw-fade', 'ngw-trace'], CIRCUIT = 'ngw-circuit';
// WCAG 2.2.2: motion that starts on load and ends within 5 s needs no pause control.
const MOTION_LIMIT_MS = 5000;

// url: file URL of the page. decorated: hosts of decorative ::before/::after. controls: selectors
// that decoration must never cover. allowRequest: approved remote reads. shot(page, name): saves a screenshot.
async function check(browser, {url, decorated, controls, allowRequest = () => false, shot}) {
  const contexts = [];
  const open = async (options, seed = {}) => {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, colorScheme: 'dark', ...options});
    contexts.push(context);
    // A seeded choice reaches the head script from inside the same document, so the check never
    // depends on Chromium keeping file:// storage across a reload, which a hosted runner did not do.
    if (Object.keys(seed).length) await context.addInitScript(entries => { for (const [key, value] of entries) localStorage.setItem(key, value); }, Object.entries(seed));
    const page = await context.newPage(), requests = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(url);
    return {page, requests, errors};
  };
  const state = page => page.evaluate(([themeKey, retiredKey]) => ({
    skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme ?? null, motion: document.documentElement.dataset.motion ?? null,
    storedTheme: localStorage.getItem(themeKey), storedMotion: localStorage.getItem(retiredKey),
    themePressed: document.querySelector('#theme-toggle').getAttribute('aria-pressed'), motionControl: Boolean(document.querySelector('#motion-toggle')),
    background: getComputedStyle(document.body).backgroundColor}), [THEME_KEY, RETIRED_MOTION_KEY]);
  const running = page => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName).sort());
  try {
    // Motion: every decorative animation plays once on load and ends within 5 s, so the page
    // offers no pause control. The circuit trace runs down the background and rests invisible.
    const {page, requests, errors} = await open({reducedMotion: 'no-preference'});
    let now = await state(page);
    assert.equal(now.skin, SKIN, 'The page names its skin');
    assert.deepEqual([now.motion, now.motionControl], [null, false], 'No pause control and no motion state');
    const names = await running(page);
    assert(names.includes(CIRCUIT) && OPENING.some(name => names.includes(name)), `Opening and circuit trace run on a fresh load: ${names}`);
    const animations = await page.evaluate(() => document.getAnimations().map(a => {
      const t = a.effect.getComputedTiming(), target = a.effect.target;
      return {name: a.animationName, iterations: t.iterations, end: t.endTime, pseudo: a.effect.pseudoElement || '',
              body: target === document.body, artwork: Boolean(target.closest('.hero-art')), rule: target.matches('.sidebar-rule')};
    }));
    assert(animations.every(a => a.pseudo || a.artwork || a.rule), 'Animations run only on decorative pseudo-elements, rules and artwork, never on text, badges or edges');
    const late = animations.filter(a => !Number.isFinite(a.iterations) || !(a.end <= MOTION_LIMIT_MS));
    assert.deepEqual(late, [], `Every animation is finite and ends within ${MOTION_LIMIT_MS} ms`);
    assert(animations.some(a => a.name === CIRCUIT && a.body && a.pseudo === '::after'), 'The circuit trace runs on the body background layer');
    await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
    assert.deepEqual(await running(page), [], 'Nothing runs after the opening and the trace');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::after').opacity), '0', 'The circuit layer rests invisible');
    const retired = await open({reducedMotion: 'no-preference'}, {[RETIRED_MOTION_KEY]: 'paused'});
    now = await state(retired.page);
    assert.deepEqual([now.motion, now.storedMotion], [null, null], 'A pause stored by the retired control is removed and ignored');
    assert((await running(retired.page)).includes(CIRCUIT), 'The trace plays despite a retired stored pause');
    // Theme: the toggle switches and stores the choice, a stored choice applies before first paint
    // over the system preference, and without a stored or scripted choice CSS follows the system.
    now = await state(page);
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme], ['dark', 'false', null], 'A dark system preference starts dark');
    const dark = now.background;
    await page.locator('#theme-toggle').click();
    now = await state(page);
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme], ['light', 'true', 'light'], 'The theme toggle switches to light and stores it');
    const light = now.background;
    assert.notEqual(light, dark, 'Light mode changes the surface');
    await page.locator('#theme-toggle').click();
    now = await state(page);
    assert.deepEqual([now.theme, now.themePressed, now.storedTheme, now.background], ['dark', 'false', 'dark', dark], 'The theme toggle switches back to dark and stores it');
    const storedLight = await open({reducedMotion: 'no-preference'}, {[THEME_KEY]: 'light'});
    now = await state(storedLight.page);
    assert.deepEqual([now.theme, now.themePressed, now.background], ['light', 'true', light], 'A stored light theme applies before first paint over a dark system preference');
    const storedDark = await open({reducedMotion: 'no-preference', colorScheme: 'light'}, {[THEME_KEY]: 'dark'});
    now = await state(storedDark.page);
    assert.deepEqual([now.theme, now.themePressed, now.background], ['dark', 'false', dark], 'A stored dark theme applies before first paint over a light system preference');
    const system = await open({reducedMotion: 'no-preference', colorScheme: 'light'});
    now = await state(system.page);
    assert.deepEqual([now.theme, now.storedTheme, now.background], ['light', null, light], 'Without a stored choice the head script follows a light system preference');
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await page.emulateMedia({colorScheme: 'light'});
    assert.equal((await state(page)).background, light, 'Without a theme attribute, CSS follows a light system preference');
    await page.emulateMedia({colorScheme: 'dark'});
    assert.equal((await state(page)).background, dark, 'Without a theme attribute, CSS follows a dark system preference');
    for (const extra of [retired, storedLight, storedDark, system]) { assert.deepEqual(extra.errors, []); assert(extra.requests.every(allowRequest), 'Seeded pages make only approved requests'); }
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
    return {skin: SKIN, themeToggleAndPersistence: 'passed', systemPreferenceFallback: 'passed', oneShotMotion: 'passed',
            reducedMotion: 'passed', decorationOutOfTheWay: 'passed', printWithoutDecoration: 'passed', layouts};
  } finally {
    for (const context of contexts) await context.close();
  }
}

module.exports = {check, SKIN, THEME_KEY};
