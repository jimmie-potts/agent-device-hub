// A Node test reporter for hosted CI (#2059). It prints nothing and writes Node's JUnit report for its own process to
// TEST_EVIDENCE_DIR/junit/node-test-<pid>.xml, so a failed job's artifact names each failing test and its duration. The
// workflows load it through NODE_OPTIONS beside the spec reporter, which keeps the log as it was. Without
// TEST_EVIDENCE_DIR it writes nothing.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { junit } from 'node:test/reporters';

// eslint-disable-next-line require-yield -- Node takes a reporter as an async generator; this one prints nothing
export default async function* junitFile(source) {
  const directory = process.env.TEST_EVIDENCE_DIR;
  if (!directory) { for await (const event of source) void event; return; }
  mkdirSync(join(directory, 'junit'), { recursive: true });
  const out = createWriteStream(join(directory, 'junit', `node-test-${process.pid}.xml`));
  for await (const chunk of junit(source)) out.write(chunk);
  await new Promise((resolve, reject) => { out.end(error => (error ? reject(error) : resolve())); });
}
