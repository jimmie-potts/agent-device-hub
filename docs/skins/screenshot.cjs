// Page screenshots for the work guide and B.U.N.N.Y. atlas browser checks.
// Chromium copies a page screenshot from the compositor's latest frame. Right after a navigation or
// a viewport change, the page may not have rendered that frame yet, and on GitHub-hosted runners
// Page.captureScreenshot then failed with "Unable to capture screenshot" (#875). Waiting for two
// animation frames means the page has rendered at least once in its current state; Playwright's own
// screenshot assertions wait the same way. Element screenshots need no wait: Playwright already waits
// for the element to stay put across animation frames.
async function screenshot(page, options) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.screenshot(options);
}

module.exports = {screenshot};
