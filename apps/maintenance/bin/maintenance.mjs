#!/usr/bin/env node
import {main} from '../dist/cli.js';
process.umask(0o077);
process.stdout.write(JSON.stringify(await main(process.argv.slice(2),process.stdin))+'\n');
