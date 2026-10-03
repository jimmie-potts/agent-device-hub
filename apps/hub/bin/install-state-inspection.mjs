import {captureState} from '../dist/install/state.js';

// Private pipe to the updater; never printed to the operator's terminal.
try {
 const evidence=await captureState(process.argv[2]);
 process.stdout.write(JSON.stringify(evidence));
} catch {
 process.stderr.write('install-state-inspection-failed\n');
 process.exitCode=1;
}
