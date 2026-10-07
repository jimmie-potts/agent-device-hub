// Takes one bulb's writer lease in a process of its own and holds it until the process is killed (Hub #928), so a test
// can show that another process cannot take it: `node hold-lease.js <lease folder> <address>`. It writes `held` or the
// refusal's reason on one line.
import {acquireLease} from '../../src/lease.js';

const [folder = '', address = ''] = process.argv.slice(2);
const taken = acquireLease(folder, address);
process.stdout.write(`${taken.status === 'held' ? 'held' : taken.reason}\n`);
// Holding the lease means staying alive, and keeping the lease reachable: a lease the garbage collector takes closes its
// database and drops its lock. The test kills the process, as a crash would end it.
if (taken.status === 'held') setInterval(() => taken, 60_000);
