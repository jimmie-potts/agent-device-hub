#!/usr/bin/env node
import {runInstallCli} from '../dist/install/cli.js';
await runInstallCli(process.argv.slice(2));
