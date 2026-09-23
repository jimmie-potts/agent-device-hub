// Regenerate golden WebP fixtures after an intentional encoder change:
//   npm run build && node controllers/tidbyt/scripts/write-golden.mjs
// Then run npm run test:tidbyt:python, which decodes them independently with Pillow.
import { writeFileSync } from 'node:fs';
import { renderFrame } from '../dist/index.js';
import { goldenFrames, WIDTH, HEIGHT } from '../tests/frames.mjs';

const cases = [];
for (const [id, build] of Object.entries(goldenFrames)) {
  const rgb = build();
  const result = renderFrame({ width: WIDTH, height: HEIGHT, rgb });
  if (!result.ok) throw new Error(`cannot render ${id}`);
  writeFileSync(new URL(`../fixtures/golden/${id}.webp`, import.meta.url), result.webp);
  cases.push({ id, rgb: Buffer.from(rgb).toString('base64') });
}
writeFileSync(new URL('../fixtures/golden.json', import.meta.url), JSON.stringify({ width: WIDTH, height: HEIGHT, cases }, null, 2) + '\n');
