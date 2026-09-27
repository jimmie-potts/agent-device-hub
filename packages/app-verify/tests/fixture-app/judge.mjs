// Runs one step with runCaptureStep in its own process, so a test can give each
// case its own Playwright environment (PLAYWRIGHT_BROWSERS_PATH is read per process).
import {runCaptureStep} from '@jimmie-potts/app-verify';
import {createPlugin} from './plugin.mjs';

const [root, step, url, outputDir, scenario] = process.argv.slice(2);
const result = await runCaptureStep(createPlugin({root, app: 'avt-judge'}), step, {url, outputDir, scenario});
process.stdout.write(JSON.stringify(result) + '\n');
