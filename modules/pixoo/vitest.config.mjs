// The moved Pixoo tests run with Vitest from the compiled `dist/tests`, so worker and child-process files resolve beside
// the code that starts them. `npm run test:pixoo:built` runs from modules/pixoo after the build.
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({test: {root: fileURLToPath(new URL('.', import.meta.url)), include: ['dist/tests/unit/**/*.test.js', 'dist/tests/integration/**/*.test.js'], exclude: ['**/node_modules/**']}});
