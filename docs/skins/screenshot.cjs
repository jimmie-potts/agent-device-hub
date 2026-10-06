// Page screenshots for the work guide and B.U.N.N.Y. atlas browser checks.
// Chromium copies a page screenshot from the compositor's latest frame. Right after a navigation or
// a viewport change, the page may not have rendered that frame yet, and on GitHub-hosted runners
// Page.captureScreenshot then failed with "Unable to capture screenshot" (#875). So the helper waits
// for two animation frames before capturing, and after a failed capture waits one more frame and
// tries once more. Playwright's own screenshot assertions also catch a failed capture and try again,
// waiting for two animation frames before each later attempt. Element screenshots need no helper:
// Playwright waits for the element to stay put across animation frames before taking one.
const FRAME_TIMEOUT_MS = 5000;

// page.evaluate ignores the page's default timeout, so a page that stops rendering would otherwise
// hold the check until the CI job times out.
async function frames(page, count) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`screenshot: the page rendered no animation frame within ${FRAME_TIMEOUT_MS} ms`)), FRAME_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      page.evaluate(remaining => new Promise(resolve => {
        const step = () => (--remaining > 0 ? requestAnimationFrame(step) : resolve());
        requestAnimationFrame(step);
      }), count),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function screenshot(page, options) {
  await frames(page, 2);
  try {
    return await page.screenshot(options);
  } catch (error) {
    // One retry, logged so hosted runs show whether the frame wait alone is enough. A second failure is fatal.
    console.error(`screenshot retry after: ${String(error?.message ?? error).split('\n')[0]}`);
    await frames(page, 1);
    return page.screenshot(options);
  }
}

module.exports = {screenshot};
