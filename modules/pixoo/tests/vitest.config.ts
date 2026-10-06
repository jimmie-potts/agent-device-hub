import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
// Tests resolve built packages relative to modules/pixoo, so `npm run test:pixoo:built` runs from there.
export default defineConfig({test:{root:fileURLToPath(new URL('..',import.meta.url)),include:['tests/unit/**/*.test.ts','tests/integration/**/*.test.ts']}});
