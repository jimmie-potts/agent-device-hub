// Boundary checks of a CHOMPI bridge verification run (Hub #853). Each takes the run's boundary report
// (GET /api/harness/boundaries, built by server.mjs) and answers an app-verify check outcome. They are pure, so
// tests prove each one fails on a report from a run that crossed its boundary.

/** The installed services' ports (the core's list) and the installed Hub's: a run never contacts them. */
export const INSTALLED_PORTS = Object.freeze([8788, 8765, 8787, 8791, 41230, 41231]);

const passed = () => ({ outcome: /** @type {const} */ ('passed') });
/** @param {string} reason */
const failed = reason => ({ outcome: /** @type {const} */ ('failed'), reason });

/**
 * No HID device: the bridge ran on the simulator transport, never created the HID transport and never tried to
 * load node-hid.
 * @param {any} report
 */
export function checkNoHid(report) {
  const { hid } = report;
  const problems = [];
  if (!hid.simulated) problems.push('the bridge is not on the simulated controller');
  if (hid.transportsCreated > 0) problems.push(`the HID transport was created ${hid.transportsCreated} time(s)`);
  if (hid.blockedModules.length) problems.push(`refused a load of ${hid.blockedModules.join(', ')}`);
  return problems.length ? failed(problems.join('; ')) : passed();
}

/**
 * No Win32 or UI Automation call: the bridge's OS adapter is the simulated desktop, the platform adapter was never
 * created and nothing tried to load koffi.
 * @param {any} report
 */
export function checkNoDesktopCalls(report) {
  const { desktop } = report;
  const problems = [];
  if (!desktop.simulated) problems.push('the OS adapter is not the simulated desktop');
  if (desktop.platformAdaptersCreated > 0) problems.push(`the platform OS adapter was created ${desktop.platformAdaptersCreated} time(s)`);
  if (desktop.blockedModules.length) problems.push(`refused a load of ${desktop.blockedModules.join(', ')}`);
  return problems.length ? failed(problems.join('; ')) : passed();
}

/**
 * Only the run's own feed: every bridge request went to the run's loopback origin with the run's token, nothing was
 * refused for leaving it, and the single-instance lock lives in the run's private directory, so neither an installed
 * Hub nor an installed bridge is touched.
 * @param {any} report @param {string} url the run's own URL
 */
export function checkOwnFeedOnly(report, url) {
  const { feed } = report;
  const origin = new URL(url).origin;
  const problems = [];
  if (feed.origin !== origin) problems.push(`the bridge was pointed at ${feed.origin}, not the run's ${origin}`);
  const outside = [...new Set([...feed.refused, ...feed.requests.filter(/** @param {any} r */ r => r.origin !== origin).map(/** @param {any} r */ r => r.origin)])];
  if (outside.length) problems.push(`requests outside the run: ${outside.join(', ')}`);
  const installed = outside.filter(o => INSTALLED_PORTS.includes(Number(new URL(o).port)));
  if (installed.length) problems.push(`an installed service's port was targeted: ${installed.join(', ')}`);
  if (feed.unauthorized > 0) problems.push(`${feed.unauthorized} feed request(s) without the run's token`);
  if (!feed.lockInRun) problems.push('the single-instance lock is outside the run\'s private directory');
  return problems.length ? failed(problems.join('; ')) : passed();
}
